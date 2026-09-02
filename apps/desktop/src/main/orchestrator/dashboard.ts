// apps/desktop/src/main/orchestrator/dashboard.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

export type DashboardState =
  | { kind: 'unknown' }
  | { kind: 'starting'; pid: number }
  // `child` is set only when *we* spawned the dashboard; the caller owns its
  // lifecycle. A reused external dashboard has child === null and must not be
  // killed by us.
  | { kind: 'ready'; port: number; pid: number | null; child: ChildProcess | null }
  | { kind: 'crashed'; lastError: string };

export type DashboardOptions = {
  binaryPath: string;
  hermesHome: string;
  port?: number;
};

const DEFAULT_PORT = 9119;

export async function fetchDashboardToken(port: number): Promise<string | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/window\.__HERMES_SESSION_TOKEN__="([^"]+)"/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function probeDashboard(port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 750);
    const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return false;
    const body = (await r.json()) as { version?: string };
    return typeof body.version === 'string';
  } catch {
    return false;
  }
}

/** Resolve to `port` if we can bind it on loopback, else an OS-assigned free port. */
async function usablePort(port: number): Promise<number> {
  const tryListen = (p: number): Promise<number | null> =>
    new Promise((resolve) => {
      const srv = createServer();
      srv.once('error', () => resolve(null));
      srv.listen(p, '127.0.0.1', () => {
        const chosen = (srv.address() as AddressInfo).port;
        srv.close(() => resolve(chosen));
      });
    });
  // ponytail: small TOCTOU window between close() and the dashboard binding —
  // acceptable for a single-user desktop app; the 20s readiness probe catches
  // a lost race.
  return (await tryListen(port)) ?? (await tryListen(0)) ?? port;
}

export async function ensureDashboard(opts: DashboardOptions): Promise<DashboardState> {
  const preferred = opts.port ?? DEFAULT_PORT;

  // Reuse an already-running Hermes dashboard — do not take ownership of it.
  if (await probeDashboard(preferred)) {
    return { kind: 'ready', port: preferred, pid: null, child: null };
  }

  const port = await usablePort(preferred);

  const child = spawn(
    opts.binaryPath,
    ['dashboard', '--no-open', '--port', String(port), '--host', '127.0.0.1'],
    {
      env: { ...process.env, HERMES_HOME: opts.hermesHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.on('error', (err) => {
    console.error('[dashboard] spawn error', err);
  });

  // Wait until /api/status responds, with a 20s ceiling.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await probeDashboard(port)) {
      return { kind: 'ready', port, pid: child.pid ?? null, child };
    }
    await sleep(400);
  }

  child.kill('SIGTERM');
  return { kind: 'crashed', lastError: `dashboard did not become ready on port ${port} in 20s` };
}
