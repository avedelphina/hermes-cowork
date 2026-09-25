#!/usr/bin/env python3
"""cowork-pipe: keep an ACP agent running when its client goes away.

    cowork-pipe attach <run-id> <offset> [-- <agent argv...>]
    cowork-pipe stop <run-id>

`attach` starts the agent under a small detached daemon when the run has none
yet, then relays stdin -> agent and agent stdout -> stdout. The client may die
at any moment (hub restart, dropped ssh, app quit): the agent keeps running
and everything it prints is appended to <dir>/<run-id>/frames. A later attach
passes <offset>, the number of output bytes it has already processed (always
at a line end), and gets the rest followed by the live stream. Frames are
NDJSON lines (apps/desktop/src/main/orchestrator/jsonrpc.ts).

A run id is one agent process, ever: attaching to a run whose agent is gone
replays what is left and exits; it never starts a second agent. The newest
attach wins (the previous client is detached), so the agent has one writer,
and a frame a client only half-sent before it died never reaches the agent.

Client exit status: the agent's own (128+N if killed by signal N) once it
has exited; 75 when the run ended without a record (host reboot, daemon
killed); 0 when detached while the agent still runs (stdin closed, a newer
attach took over, or this client fell too far behind): attach again.

<dir> is $COWORK_PIPE_DIR, default ~/.cowork/runs. Standard library only:
every Hermes host already has Python. Design: docs/cloud-hub.md.
"""
import os
import selectors
import signal
import socket
import subprocess
import sys
import threading
import time

USAGE = 'usage: cowork-pipe attach <run-id> <offset> [-- <agent argv...>] | cowork-pipe stop <run-id>'
EX_INTERRUPTED = 75
# ponytail: a client this far behind is dropped; it re-attaches and replays from disk.
MAX_BACKLOG = 64 << 20
RUN_ID_CHARS = frozenset('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-')
EVENT_RW = selectors.EVENT_READ | selectors.EVENT_WRITE


def die(msg, code=2):
    sys.stderr.write('cowork-pipe: %s\n' % msg)
    sys.exit(code)


def base_dir():
    return os.path.abspath(os.environ.get('COWORK_PIPE_DIR') or os.path.expanduser('~/.cowork/runs'))


def run_dir(run_id):
    if not (0 < len(run_id) <= 128) or run_id[0] in '.-' or not set(run_id) <= RUN_ID_CHARS:
        die('invalid run id %r' % run_id)
    return os.path.join(base_dir(), run_id)


def write_all(fd, data):
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view):]


def read_exit():
    try:
        with open('exit') as f:
            return int(f.read())
    except (OSError, ValueError):
        return None


def connect(retry):
    """Connect to the run's daemon. `retry` while a daemon we just started comes up."""
    deadline = time.monotonic() + 10
    while True:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            # Relative: sun_path holds ~104 bytes and the run dir can be longer.
            s.connect('sock')
            return s
        except OSError:
            s.close()
        if not retry or os.path.exists('exit') or time.monotonic() > deadline:
            return None
        time.sleep(0.02)


# ── client ──────────────────────────────────────────────────────────────────

def attach(run_id, offset, argv):
    rdir = run_dir(run_id)
    os.makedirs(base_dir(), mode=0o700, exist_ok=True)
    try:
        os.mkdir(rdir, 0o700)  # the lock: exactly one attach starts the agent for a run
        fresh = True
    except FileExistsError:
        fresh = False
    if fresh:
        if not argv:
            os.rmdir(rdir)
            die('a new run needs the agent command after --')
        with open(os.path.join(rdir, 'stderr'), 'ab') as err:
            # Own session: the daemon outlives this client, its ssh session and its terminal.
            subprocess.Popen([sys.executable, os.path.abspath(__file__), '_daemon', rdir, '--'] + argv,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=err,
                             start_new_session=True)
    os.chdir(rdir)

    sock = connect(retry=fresh)
    forwarded = 0
    if sock:
        detached = threading.Event()

        def pump_stdin():
            while True:
                try:
                    data = os.read(0, 65536)
                except OSError:
                    data = b''
                if not data:
                    break
                try:
                    sock.sendall(data)
                except OSError:
                    return
            detached.set()  # our stdin closed: the hub let go, the agent keeps running
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        sock.sendall(b'attach %d\n' % offset)
        threading.Thread(target=pump_stdin, daemon=True).start()
        while True:
            try:
                data = sock.recv(65536)
            except OSError:
                data = b''
            if not data:
                break
            try:
                write_all(1, data)
            except OSError:
                return 0  # our stdout is gone: same as a detach
            forwarded += len(data)
        sock.close()
        if detached.is_set():
            return 0

    code = read_exit()
    if code is None and sock is not None:
        if alive():
            return 0  # the daemon is fine: a newer attach took over and relays from here
        code = read_exit()  # a daemon that was just finishing has written it by now
    # The agent is gone. The daemon does not flush clients on the way out, so
    # send whatever this client has not seen yet straight from the record.
    try:
        with open('frames', 'rb') as f:
            f.seek(offset + forwarded)
            for chunk in iter(lambda: f.read(1 << 20), b''):
                write_all(1, chunk)
    except OSError:
        pass
    return EX_INTERRUPTED if code is None else code


def alive():
    """Whether the run's daemon answers. A dying daemon's listener can still accept a
    connection (the kernel may close it after the client sockets), so connecting is not enough."""
    sock = connect(retry=False)
    if not sock:
        return False
    try:
        sock.settimeout(5)
        sock.sendall(b'ping\n')
        return sock.recv(16) == b'ok\n'
    except OSError:
        return False
    finally:
        sock.close()


def stop(run_id):
    """Stop the run's agent and return once it is gone (≤5 s). Idempotent."""
    try:
        os.chdir(run_dir(run_id))
    except (FileNotFoundError, NotADirectoryError):
        return 0
    sock = connect(retry=False)
    if not sock:
        return 0
    sock.sendall(b'stop\n')
    while True:
        try:
            if not sock.recv(4096):
                break
        except OSError:
            break
    return 0


# ── daemon ──────────────────────────────────────────────────────────────────

class Client:
    def __init__(self, sock):
        self.sock = sock
        self.inbuf = bytearray()
        self.outbuf = bytearray()


class Daemon:
    """Owns one agent: records its output, relays to the current client, feeds it complete lines."""

    def __init__(self, agent, listener):
        self.agent = agent
        self.frames = os.open('frames', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        self.out_fd = agent.stdout.fileno()
        self.in_fd = agent.stdin.fileno()
        os.set_blocking(self.out_fd, False)
        os.set_blocking(self.in_fd, False)
        self.sel = selectors.DefaultSelector()
        self.sel.register(listener, selectors.EVENT_READ, self.on_accept)
        self.sel.register(self.out_fd, selectors.EVENT_READ, self.on_agent_output)
        self.sockets = {listener}
        self.pending = {}         # socket -> bytes received before its command line
        self.waiters = []         # `stop` callers, answered when the agent is gone
        self.client = None
        self.to_agent = bytearray()
        self.feeding = False      # in_fd registered for EVENT_WRITE
        self.stdin_open = True
        self.signals = []         # (monotonic time, signal) scheduled by stop
        self.eof = False

    def run(self):
        while not self.eof:
            timeout = 1.0  # also polls the agent: a grandchild can hold its stdout open
            if self.signals:
                timeout = max(0.0, min(timeout, self.signals[0][0] - time.monotonic()))
            for key, mask in self.sel.select(timeout):
                key.data(key.fileobj, mask)
            if not os.path.exists('sock'):
                self.stop()  # the run dir was removed: nobody can reach or stop this run any more
            while self.signals and self.signals[0][0] <= time.monotonic():
                sig = self.signals.pop(0)[1]
                if self.agent.poll() is None:
                    self.agent.send_signal(sig)
            if self.agent.poll() is not None:
                self.drain()
                break
        try:
            code = self.agent.wait(timeout=5)
        except subprocess.TimeoutExpired:  # it closed stdout but kept running
            self.agent.kill()
            code = self.agent.wait()
        try:
            write_exit(code if code >= 0 else 128 - code)
            # The record is complete before any client sees EOF; clients top up from it.
            os.unlink('sock')
        except OSError:
            pass  # the run dir was removed
        for s in self.sockets:
            s.close()

    # agent → record → client
    def on_agent_output(self, fd, mask):
        try:
            data = os.read(fd, 65536)
        except BlockingIOError:
            return
        if data:
            self.record(data)
        else:
            self.eof = True

    def drain(self):
        while True:
            try:
                data = os.read(self.out_fd, 65536)
            except (BlockingIOError, OSError):
                return
            if not data:
                return
            self.record(data)

    def record(self, data):
        # ponytail: no fsync. The record only has to outlive the client and the hub;
        # a power cut kills the agent too.
        write_all(self.frames, data)
        c = self.client
        if c:
            if not c.outbuf:
                self.sel.modify(c.sock, EVENT_RW, self.on_client)
            c.outbuf += data
            if len(c.outbuf) > MAX_BACKLOG:
                self.drop(c)

    # connections
    def on_accept(self, listener, mask):
        try:
            sock, _ = listener.accept()
        except OSError:
            return
        sock.setblocking(False)
        self.sockets.add(sock)
        self.pending[sock] = bytearray()
        self.sel.register(sock, selectors.EVENT_READ, self.on_command)

    def on_command(self, sock, mask):
        buf = self.pending.get(sock)
        if buf is None:
            return
        data = self.recv(sock)
        if data is None:
            return
        buf += data
        nl = buf.find(b'\n')
        if not data or (nl < 0 and len(buf) > 256):
            return self.close(sock)
        if nl < 0:
            return
        del self.pending[sock]
        cmd, rest = bytes(buf[:nl]).split(), bytes(buf[nl + 1:])
        if len(cmd) == 2 and cmd[0] == b'attach' and cmd[1].isdigit():
            self.attach(sock, int(cmd[1]), rest)
        elif cmd == [b'stop']:
            self.waiters.append(sock)
            self.sel.modify(sock, selectors.EVENT_READ, self.on_waiter)
            self.stop()
        else:
            if cmd == [b'ping']:
                try:
                    sock.send(b'ok\n')
                except OSError:
                    pass
            self.close(sock)

    def attach(self, sock, offset, rest):
        if self.client:
            self.drop(self.client)  # newest attach wins
        c = self.client = Client(sock)
        # ponytail: the replay is read into memory whole (MAX_BACKLOG caps it).
        with open('frames', 'rb') as f:
            f.seek(offset)
            c.outbuf += f.read()
        self.sel.modify(sock, EVENT_RW if c.outbuf else selectors.EVENT_READ, self.on_client)
        if rest:
            self.from_client(c, rest)

    def on_client(self, sock, mask):
        c = self.client
        if c is None or c.sock is not sock:
            return
        if mask & selectors.EVENT_READ:
            data = self.recv(sock)
            if data == b'':
                return self.drop(c)
            if data:
                self.from_client(c, data)
        if mask & selectors.EVENT_WRITE and c.outbuf:
            try:
                n = sock.send(c.outbuf)
            except BlockingIOError:
                n = 0
            except OSError:
                return self.drop(c)
            del c.outbuf[:n]
            if not c.outbuf:
                self.sel.modify(sock, selectors.EVENT_READ, self.on_client)

    def on_waiter(self, sock, mask):
        if sock in self.waiters and self.recv(sock) == b'':
            self.waiters.remove(sock)
            self.close(sock)

    @staticmethod
    def recv(sock):
        """Bytes, b'' when the peer is gone, None when nothing is ready."""
        try:
            return sock.recv(65536)
        except BlockingIOError:
            return None
        except OSError:
            return b''

    def drop(self, c):
        if self.client is c:
            self.client = None
        self.close(c.sock)  # its half-sent frame (c.inbuf) dies with it

    def close(self, sock):
        self.pending.pop(sock, None)
        self.sockets.discard(sock)
        try:
            self.sel.unregister(sock)
        except (KeyError, ValueError):
            pass
        sock.close()

    # client → agent: complete lines only
    def from_client(self, c, data):
        c.inbuf += data
        nl = c.inbuf.rfind(b'\n')
        if nl < 0:
            return
        if self.stdin_open:
            self.to_agent += c.inbuf[:nl + 1]
            self.feed()
        del c.inbuf[:nl + 1]

    def feed(self, *_):
        try:
            while self.to_agent:
                del self.to_agent[:os.write(self.in_fd, self.to_agent)]
        except BlockingIOError:
            pass
        except OSError:  # the agent closed its stdin
            self.to_agent.clear()
        if bool(self.to_agent) != self.feeding:
            if self.to_agent:
                self.sel.register(self.in_fd, selectors.EVENT_WRITE, self.feed)
            else:
                self.sel.unregister(self.in_fd)
            self.feeding = bool(self.to_agent)

    def stop(self):
        if not self.stdin_open:
            return
        self.stdin_open = False
        self.to_agent.clear()
        if self.feeding:
            self.sel.unregister(self.in_fd)
            self.feeding = False
        self.agent.stdin.close()  # EOF first, then escalate: same as AcpSupervisor.shutdown
        now = time.monotonic()
        self.signals = [(now + 1, signal.SIGTERM), (now + 5, signal.SIGKILL)]


def write_exit(code):
    with open('exit.tmp', 'w') as f:
        f.write(str(code))
    os.replace('exit.tmp', 'exit')


def run_daemon(rdir, argv):
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    try:
        agent = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE)  # cwd: the caller's
    except OSError as e:
        os.chdir(rdir)
        sys.stderr.write('cowork-pipe: cannot start %s: %s\n' % (argv[0], e))
        write_exit(127)
        return 0
    os.chdir(rdir)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind('sock')
    listener.listen(8)
    listener.setblocking(False)
    with open('pid', 'w') as f:
        f.write(str(os.getpid()))
    Daemon(agent, listener).run()
    return 0


def main(args):
    if len(args) >= 3 and args[0] == 'attach' and (len(args) == 3 or args[3] == '--'):
        offset = args[2]
        if not (offset.isascii() and offset.isdigit()):
            die('offset must be a whole number of bytes')
        return attach(args[1], int(offset), args[4:])
    if len(args) == 2 and args[0] == 'stop':
        return stop(args[1])
    if len(args) >= 4 and args[0] == '_daemon' and args[2] == '--':
        return run_daemon(args[1], args[3:])
    die(USAGE)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
