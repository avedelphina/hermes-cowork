// apps/desktop/src/main/ipc/handlers.ts
import { app, ipcMain, BrowserWindow, dialog, Notification, type IpcMainInvokeEvent } from 'electron';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { IpcChannel } from './channels';
import { AcpSupervisor } from '../orchestrator/acp-supervisor';
import { AcpBridge } from '../orchestrator/acp-bridge';
import type { AcpServerMessage, AcpClientMessage } from '../../shared/types';
import { findHermesBinary, verifyHermesVersion, MIN_HERMES_VERSION } from '../orchestrator/hermes-runtime';
import { profileHome, isValidProfileName } from '../orchestrator/hermes-home';
import { isValidSshTarget, isValidRemoteCwd } from '../orchestrator/spawn-spec';
import { listRemoteProfiles } from '../orchestrator/remote-profiles';
import { isExistingDir, resolveWithinRoot } from '../security/paths';
import { isAppUrl, type AppUrlConfig } from '../security/app-url';
import { ProjectStore } from '../store/project-store';
import { TaskStore } from '../store/task-store';
import { ChatSessionStore } from '../store/chat-session-store';
import { RemoteAgentStore, toOrigin } from '../store/remote-agent-store';
import { contextFiles, listDir, readFilePreview, snapshotFile, revertFile } from '../fs/project-fs';
import type { UpdaterController } from '../update/updater';
import type { TaskStatus, RemoteOrigin, RemoteAgent } from '../../shared/types';

type Context = {
  hermesBinary: string;
  dashboardPort: number;
  dashboardToken: string | null;
  /** Global Hermes home — the directory that contains `profiles/`. */
  globalHermesHome: string;
  /** Profile HERMES_HOME was scoped to at launch, or null. */
  envProfile: string | null;
  win: () => BrowserWindow | null;
  /** What counts as the app's own renderer document (see security/app-url). */
  appUrl: AppUrlConfig;
  updater: UpdaterController;
};

// ── IPC input guards ──
// The renderer is untrusted: every argument is checked here, at the boundary.
// (Hand-rolled rather than zod — main's externalized deps are not packaged.)
function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length > 10_000) throw new Error(`invalid ${what}`);
  return v;
}
function strOrNull(v: unknown, what: string): string | null {
  return v === null || v === undefined ? null : str(v, what);
}
function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`invalid ${what}`);
  return v as Record<string, unknown>;
}
const TASK_STATUSES: readonly TaskStatus[] = [
  'planning', 'awaiting_approval', 'executing', 'done', 'failed', 'stopped', 'interrupted',
];

/**
 * Validate a renderer-supplied remote origin. Null/undefined → null (local
 * task). Anything else must be a well-formed RemoteOrigin: a strict SSH
 * target (no whitespace/metachars — see spawn-spec.isValidSshTarget) and
 * optional string overrides. The renderer is untrusted; this is the boundary.
 */
function parseRemote(raw: unknown): RemoteOrigin | null {
  if (raw === null || raw === undefined) return null;
  const o = obj(raw, 'remote');
  const sshTarget = str(o['sshTarget'], 'remote.sshTarget');
  if (!isValidSshTarget(sshTarget)) throw new Error(`invalid SSH target: ${JSON.stringify(sshTarget)}`);
  const hermesHome = strOrNull(o['hermesHome'], 'remote.hermesHome');
  const binaryPath = strOrNull(o['binaryPath'], 'remote.binaryPath');
  return { sshTarget, hermesHome, binaryPath };
}

/** A remote task's cwd is a path on the *remote* host — it must be absolute
 * there (no `~`, no `..`), and local existence checks do not apply. */
function assertRemoteCwd(cwd: string): void {
  if (!isValidRemoteCwd(cwd)) {
    throw new Error(`Remote working folder must be an absolute path on the remote host (no ~ or ..), got: ${JSON.stringify(cwd)}`);
  }
}

export function registerIpcHandlers(ctx: Context, sup: AcpSupervisor): void {
  // Every privileged channel is registered through this wrapper, never
  // ipcMain directly (a unit test enforces it). A call is served only when it
  // comes from our window's top-level frame while that frame shows the app's
  // own document — a page that somehow got navigated in, or any subframe,
  // gets nothing even though the preload bridge is present.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (e, ...args) => {
      const frame = e.senderFrame;
      const win = ctx.win();
      if (!win || e.sender !== win.webContents || !frame || frame.parent !== null || !isAppUrl(frame.url, ctx.appUrl)) {
        throw new Error(`IPC ${channel} refused: untrusted sender ${frame?.url ?? '(gone)'}`);
      }
      return fn(e, ...args);
    });
  };

  const authHeader = (): Record<string, string> =>
    ctx.dashboardToken ? { Authorization: `Bearer ${ctx.dashboardToken}` } : {};
  const base = `http://127.0.0.1:${ctx.dashboardPort}`;

  // Reject a renderer-supplied profile that is not one Hermes actually knows.
  // Cached briefly so a task start is not gated on a network round-trip.
  let profileCache: { names: Set<string>; at: number } | null = null;
  const assertKnownProfile = async (name: string): Promise<void> => {
    if (name === 'default') return;
    if (!isValidProfileName(name)) throw new Error(`invalid profile name: ${JSON.stringify(name)}`);
    if (!profileCache || Date.now() - profileCache.at > 10_000) {
      // Fail closed on a dashboard error, but do not cache it — a blip must
      // not reject every profile for the next 10s.
      profileCache = null;
      try {
        const r = await fetch(`${base}/api/profiles`, { headers: authHeader() });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { profiles?: Array<{ name?: string }> };
        profileCache = {
          names: new Set((body.profiles ?? []).map((p) => p.name).filter((n): n is string => !!n)),
          at: Date.now(),
        };
      } catch (err) {
        throw new Error(`cannot verify profile ${JSON.stringify(name)}: dashboard unreachable (${String(err)})`);
      }
    }
    if (!profileCache.names.has(name)) throw new Error(`unknown profile: ${name}`);
  };

  // ── runtime ──
  handle(IpcChannel.RuntimeProbe, async () => {
    const found = findHermesBinary();
    if (found.kind === 'not-found') return { kind: 'not-found' as const, searched: found.searched };
    const v = await verifyHermesVersion(found.path);
    if (v.kind === 'too-old') return { kind: 'too-old' as const, version: v.version, min: v.min };
    if (v.kind === 'version-failed') return { kind: 'version-failed' as const, stderr: v.stderr };
    if (v.kind !== 'ok') return { kind: 'not-found' as const, searched: [] };
    return { kind: 'ok' as const, path: found.path, version: v.version, min: MIN_HERMES_VERSION };
  });

  // Status and the profile list are read directly from the dashboard by the
  // renderer through the REST proxy (see api/rest-client.ts) — no bespoke
  // handlers here.

  // ── profiles ──
  handle(IpcChannel.ProfileEnv, async (): Promise<{ globalHermesHome: string; envProfile: string | null }> => ({
    globalHermesHome: ctx.globalHermesHome,
    envProfile: ctx.envProfile,
  }));

  const bridge = new AcpBridge(sup);

  handle(IpcChannel.ProfileSwitch, async (_e, rawName: unknown): Promise<void> => {
    const name = str(rawName, 'profile');
    if (name !== 'default' && !isValidProfileName(name)) throw new Error(`invalid profile name: ${JSON.stringify(name)}`);
    const r = await fetch(`${base}/api/profiles/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) throw new Error(`profile switch failed: ${r.status}`);
    bridge.stopAll();
  });

  // ── ACP ──
  bridge.on('event', (semantic: AcpServerMessage) => {
    // Checkpoint before forwarding: this runs in the same tick the tool-call
    // frame arrived on stdout — as early as the client can see it.
    if (semantic.kind === 'tool-call' && ['edit', 'delete', 'move'].includes(semantic.op)) {
      autoCheckpoint(semantic);
    }
    ctx.win()?.webContents.send(IpcChannel.AcpEvent, semantic);
  });

  handle(
    IpcChannel.AcpStart,
    async (_e, raw: unknown) => {
      const o = obj(raw, 'acp:start options');
      // Where the agent runs is decided by stored records, never by a
      // renderer-supplied host: the renderer only names a remote agent (chat)
      // or a project.
      const agent = remoteAgentFor(strOrNull(o['remoteId'], 'remoteId'));
      const opts = {
        profile: agent ? agent.profile : str(o['profile'], 'profile'),
        cwd: strOrNull(o['cwd'], 'cwd') ?? undefined,
        isolate: o['isolate'] === true,
        remote: agent ? toOrigin(agent) : projectRemote(strOrNull(o['projectId'], 'projectId')),
      };
      // Chat is not folder-scoped — it defaults to the home directory (on a
      // remote agent: the remote login directory, "." over there). A Cowork
      // task always passes an explicit folder the user picked. An explicit cwd
      // that does not exist fails closed (never a silent widening to $HOME).
      const cwd = opts.cwd ? opts.cwd : opts.remote ? '.' : homedir();
      if (opts.remote) {
        // The path lives on the remote host; local existence checks don't
        // apply, and neither does the local dashboard's profile list.
        if (opts.cwd) assertRemoteCwd(opts.cwd);
        if (opts.profile !== 'default' && !isValidProfileName(opts.profile)) {
          throw new Error(`invalid profile name: ${JSON.stringify(opts.profile)}`);
        }
      } else {
        if (!isExistingDir(cwd)) {
          throw new Error(`Refusing to start: "${cwd}" is not an existing directory.`);
        }
        await assertKnownProfile(opts.profile);
      }
      return bridge.startSession({
        profile: opts.profile,
        cwd,
        isolate: !!opts.isolate,
        binaryPath: ctx.hermesBinary,
        hermesHome: profileHome(ctx.globalHermesHome, opts.profile),
        remote: opts.remote,
      });
    },
  );

  handle(IpcChannel.AcpSetMode, async (_e, raw: unknown) => {
    const o = obj(raw, 'acp:set-mode options');
    await bridge.setMode(str(o['sessionId'], 'sessionId'), str(o['modeId'], 'modeId'));
  });

  handle(IpcChannel.AcpSetModel, async (_e, raw: unknown) => {
    const o = obj(raw, 'acp:set-model options');
    await bridge.setModel(str(o['sessionId'], 'sessionId'), str(o['modelId'], 'modelId'));
  });

  handle(IpcChannel.AcpModels, (_e, sessionId: unknown) => bridge.getModels(str(sessionId, 'sessionId')));

  handle(
    IpcChannel.AcpLoad,
    async (_e, raw: unknown) => {
      const o = obj(raw, 'acp:load options');
      const opts = {
        sessionId: str(o['sessionId'], 'sessionId'),
        cwd: strOrNull(o['cwd'], 'cwd') ?? undefined,
        isolate: o['isolate'] === true,
        // Resuming: the chat's remote agent or the task's own stored origin,
        // never one sent by the renderer.
        remote: null as RemoteOrigin | null,
      };
      const chatId = strOrNull(o['chatId'], 'chatId');
      const agent = chatRemoteAgent(chatId);
      opts.remote = agent ? toOrigin(agent) : taskRemote(strOrNull(o['taskId'], 'taskId'));
      // A session lives in the profile it was created under, so a chat keeps
      // that profile even if its agent was edited to a different one since.
      const profile = agent
        ? (chats.get(chatId!)?.profile ?? agent.profile)
        : (strOrNull(o['profile'], 'profile') ?? 'default');
      // An explicit cwd must exist — a moved/deleted project folder must fail,
      // not silently widen the task's scope to $HOME. Remote cwds live on the
      // remote host, so they get a shape check instead of an existence check.
      if (opts.remote) {
        if (opts.cwd) assertRemoteCwd(opts.cwd);
        if (profile !== 'default' && !isValidProfileName(profile)) {
          throw new Error(`invalid profile name: ${JSON.stringify(profile)}`);
        }
      } else {
        if (opts.cwd && !isExistingDir(opts.cwd)) {
          throw new Error(`Cannot resume: "${opts.cwd}" is not an existing directory.`);
        }
        await assertKnownProfile(profile);
      }
      const cwd = opts.cwd ? opts.cwd : opts.remote ? '.' : homedir();
      return bridge.loadSession({
        sessionId: opts.sessionId,
        profile,
        cwd,
        isolate: !!opts.isolate,
        binaryPath: ctx.hermesBinary,
        hermesHome: profileHome(ctx.globalHermesHome, profile),
        remote: opts.remote,
      });
    },
  );

  handle(IpcChannel.AcpSend, async (_e, raw: unknown) => {
    const msg = obj(raw, 'acp:send message') as AcpClientMessage;
    const sessionId = str(msg.sessionId, 'sessionId');
    if (msg.kind === 'prompt') {
      await bridge.sendPrompt(sessionId, str(msg.text, 'prompt'));
    } else if (msg.kind === 'approve') {
      bridge.respondToPermission(sessionId, str(msg.toolCallId, 'toolCallId'), msg.allow === true);
    } else {
      throw new Error('invalid acp:send kind');
    }
  });

  handle(IpcChannel.AcpStop, async (_e, sessionId: unknown) => {
    bridge.stopSession(str(sessionId, 'sessionId'));
  });

  // ── REST proxy ──
  // The renderer may only reach the exact dashboard routes the UI uses. The
  // proxy carries the dashboard bearer token, so an open path is an open door.
  const PROFILE_SEG = '[A-Za-z0-9][A-Za-z0-9._-]*';
  const ALLOW: Record<'GET' | 'POST' | 'PATCH' | 'DELETE', RegExp[]> = {
    GET: [
      /^\/api\/status$/,
      /^\/api\/profiles$/,
      /^\/api\/profiles\/active$/,
      /^\/api\/sessions(\?limit=\d+)?$/,
      /^\/api\/sessions\/stats$/,
      /^\/api\/cron\/jobs$/,
      /^\/api\/memory$/,
      /^\/api\/skills$/,
      /^\/api\/plugins\/kanban\/board$/,
    ],
    POST: [
      /^\/api\/profiles$/,
      /^\/api\/gateway\/(start|stop|restart)$/,
    ],
    PATCH: [/^\/api\/skills\/toggle$/],
    DELETE: [new RegExp(`^/api/profiles/${PROFILE_SEG}$`)],
  };
  const check = (method: keyof typeof ALLOW, path: string) => {
    if (!ALLOW[method].some((re) => re.test(path))) {
      throw new Error(`dashboard route not allowed: ${method} ${path}`);
    }
  };
  const proxy = async (method: keyof typeof ALLOW, path: string, body?: unknown) => {
    check(method, path);
    const init: RequestInit = { method, headers: authHeader() };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json', ...authHeader() };
      init.body = JSON.stringify(body);
    }
    const r = await fetch(`${base}${path}`, init);
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`);
    return r.json().catch(() => null);
  };

  handle(IpcChannel.RestGet, (_e, path: unknown) => proxy('GET', str(path, 'path')));
  handle(IpcChannel.RestPost, (_e, path: unknown, body: unknown) => proxy('POST', str(path, 'path'), body ?? {}));
  handle(IpcChannel.RestPatch, (_e, path: unknown, body: unknown) => proxy('PATCH', str(path, 'path'), body ?? {}));
  handle(IpcChannel.RestDelete, (_e, path: unknown) => proxy('DELETE', str(path, 'path')));

  // ── kanban WS ──
  handle(IpcChannel.KanbanWsSubscribe, (_e, _boardSlug: string | null) => undefined);

  // ── app ──
  handle(IpcChannel.Notify, (_e, raw: unknown) => {
    const o = obj(raw, 'notification');
    const title = str(o['title'], 'title').slice(0, 200);
    const body = str(o['body'], 'body').slice(0, 500);
    const w = ctx.win();
    if (w && !w.isFocused() && Notification.isSupported()) {
      const n = new Notification({ title, body });
      n.on('click', () => { w.show(); w.focus(); });
      n.show();
    }
  });

  // ── auto-update ──
  handle(IpcChannel.UpdateCheck, () => ctx.updater.check());
  handle(IpcChannel.UpdateDownload, () => ctx.updater.download());
  handle(IpcChannel.UpdateInstall, () => ctx.updater.install());
  handle(IpcChannel.UpdateStatus, () => ctx.updater.getStatus());

  // ── dialog ──
  handle(IpcChannel.ShowFolderPicker, async () => {
    const w = ctx.win();
    if (!w) return null;
    const result = await dialog.showOpenDialog(w, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // ── projects ──
  // HERMES_COWORK_USERDATA lets e2e tests point the store at a scratch dir.
  const userData = process.env['HERMES_COWORK_USERDATA'] || app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  const projects = new ProjectStore(join(userData, 'projects.json'));

  handle(IpcChannel.ProjectList, () => projects.snapshot());

  handle(
    IpcChannel.ProjectCreate,
    (_e, raw: unknown) => {
      const o = obj(raw, 'project');
      const input = {
        name: str(o['name'] ?? '', 'name'),
        folderPath: strOrNull(o['folderPath'], 'folderPath'),
        profile: str(o['profile'], 'profile'),
        remote: parseRemote(o['remote']),
      };
      // A folder is optional (chat-only projects). If given, it must exist —
      // locally, or on the remote host for a remote project (shape-checked
      // only; we cannot stat another machine's filesystem).
      const folderPath = input.folderPath?.trim() ? input.folderPath : null;
      if (folderPath !== null) {
        if (input.remote) assertRemoteCwd(folderPath);
        else if (!isExistingDir(folderPath)) {
          throw new Error(`"${folderPath}" is not an existing directory.`);
        }
      }
      const name =
        input.name.trim() ||
        folderPath?.split('/').filter(Boolean).pop() ||
        'Project';
      return projects.create({ name, folderPath, profile: input.profile, remote: input.remote });
    },
  );

  handle(
    IpcChannel.ProjectUpdate,
    (_e, id: unknown, raw: unknown) => {
      const patch = obj(raw, 'project patch');
      const next: { name?: string; profile?: string; folderPath?: string | null; archived?: boolean; remote?: RemoteOrigin | null } = {};
      if (patch['name'] !== undefined) next.name = str(patch['name'], 'name');
      if (patch['profile'] !== undefined) next.profile = str(patch['profile'], 'profile');
      if (patch['archived'] !== undefined) next.archived = patch['archived'] === true;
      if (patch['remote'] !== undefined) next.remote = parseRemote(patch['remote']);
      if (patch['folderPath'] !== undefined) {
        const fp = strOrNull(patch['folderPath'], 'folderPath');
        next.folderPath = fp?.trim() ? fp : null;
        if (next.folderPath !== null) {
          // Remote-aware: existence is only checkable for local folders. The
          // effective remote is the patch's if given, else the stored one.
          const remote = next.remote !== undefined ? next.remote : (projects.get(str(id, 'id'))?.remote ?? null);
          if (remote) assertRemoteCwd(next.folderPath);
          else if (!isExistingDir(next.folderPath)) {
            throw new Error(`"${next.folderPath}" is not an existing directory.`);
          }
        }
      }
      return projects.update(str(id, 'id'), next);
    },
  );

  handle(IpcChannel.ProjectSetActive, (_e, id: unknown) => {
    projects.setActive(str(id, 'id'));
    return projects.snapshot();
  });

  handle(IpcChannel.ProjectRemove, (_e, id: unknown) => {
    projects.remove(str(id, 'id'));
    return projects.snapshot();
  });

  const projectRoot = (id: unknown): string => {
    const p = projects.get(str(id, 'id'));
    if (!p) throw new Error(`unknown project ${id}`);
    if (!p.folderPath) throw new Error(`project ${id} has no folder`);
    if (p.remote) throw new Error('context files live on the remote host — not readable locally');
    return p.folderPath;
  };

  handle(IpcChannel.ProjectContextFiles, (_e, id: unknown) => contextFiles(projectRoot(id)));

  // ── cowork tasks ──
  const tasks = new TaskStore(join(userData, 'tasks.json'));
  const remoteAgents = new RemoteAgentStore(join(userData, 'remote-agents.json'));
  // Hoisted: the acp:* handlers above resolve a remote origin through these.
  function projectRemote(projectId: string | null): RemoteOrigin | null {
    return (projectId ? projects.get(projectId)?.remote : null) ?? null;
  }
  function taskRemote(taskId: string | null): RemoteOrigin | null {
    return (taskId ? tasks.get(taskId)?.remote : null) ?? null;
  }
  /** null → no remote agent; an id that no longer exists is an error, not a silent local fallback. */
  function remoteAgentFor(id: string | null): RemoteAgent | null {
    if (!id) return null;
    const a = remoteAgents.get(id);
    if (!a) throw new Error('This remote agent no longer exists.');
    return a;
  }
  function chatRemoteAgent(chatId: string | null): RemoteAgent | null {
    return remoteAgentFor((chatId ? chats.get(chatId)?.remoteId : null) ?? null);
  }
  handle(IpcChannel.TaskList, () => tasks.list());
  handle(IpcChannel.TaskCreate, (_e, raw: unknown) => {
    const o = obj(raw, 'task');
    const input = {
      goal: str(o['goal'], 'goal'),
      cwd: str(o['cwd'], 'cwd'),
      profile: str(o['profile'], 'profile'),
      acpSessionId: str(o['acpSessionId'], 'acpSessionId'),
      projectId: strOrNull(o['projectId'], 'projectId'),
      parentTaskId: strOrNull(o['parentTaskId'], 'parentTaskId'),
      // Denormalised from the project so resume survives later project edits.
      remote: projectRemote(strOrNull(o['projectId'], 'projectId')),
    };
    // The stored cwd is the trust root for this task's checkpoint IPC, so it
    // must be a real directory (same bar as acp:start) — locally. For a
    // remote task the root lives on the other machine and the local
    // filesystem channels refuse it entirely (see taskRoot).
    if (input.remote) assertRemoteCwd(input.cwd);
    else if (!isExistingDir(input.cwd)) throw new Error(`Refusing to record a task in "${input.cwd}" — not an existing directory.`);
    return tasks.create(input);
  });
  handle(IpcChannel.TaskUpdate, (_e, id: unknown, raw: unknown) => {
    const o = obj(raw, 'task patch');
    const patch: { status?: TaskStatus; approved?: boolean } = {};
    if (o['status'] !== undefined) {
      if (!TASK_STATUSES.includes(o['status'] as TaskStatus)) throw new Error('invalid status');
      patch.status = o['status'] as TaskStatus;
    }
    if (o['approved'] !== undefined) patch.approved = o['approved'] === true;
    return tasks.update(str(id, 'id'), patch);
  });
  handle(IpcChannel.TaskRemove, (_e, id: unknown) => tasks.remove(str(id, 'id')));

  // ── chat sessions ──
  const chats = new ChatSessionStore(join(userData, 'chats.json'));
  handle(IpcChannel.ChatList, () => chats.list());
  handle(
    IpcChannel.ChatCreate,
    (_e, raw: unknown) => {
      const o = obj(raw, 'chat');
      return chats.create({
        acpSessionId: str(o['acpSessionId'], 'acpSessionId'),
        projectId: strOrNull(o['projectId'], 'projectId'),
        title: strOrNull(o['title'], 'title'),
        profile: strOrNull(o['profile'], 'profile'),
        remoteId: remoteAgentFor(strOrNull(o['remoteId'], 'remoteId'))?.id ?? null,
      });
    },
  );
  handle(IpcChannel.ChatUpdate, (_e, id: unknown, raw: unknown) => {
    const o = obj(raw, 'chat patch');
    const patch: { title?: string | null; projectId?: string | null } = {};
    if (o['title'] !== undefined) patch.title = strOrNull(o['title'], 'title');
    if (o['projectId'] !== undefined) patch.projectId = strOrNull(o['projectId'], 'projectId');
    return chats.update(str(id, 'id'), patch);
  });
  handle(IpcChannel.ChatRemove, (_e, id: unknown) => chats.remove(str(id, 'id')));

  // Checkpoints are scoped to a task's working folder and held here, in main.
  // The renderer only ever sends a taskId + relative path — never the root and
  // never the content to write back, so it cannot turn revert into an
  // arbitrary write.
  const taskRoot = (taskId: unknown): string => {
    const t = tasks.get(str(taskId, 'taskId'));
    if (!t) throw new Error(`unknown task ${String(taskId)}`);
    // Folder scope is the trust boundary — and it is enforced against the
    // *local* filesystem. A remote task's files live on the other machine;
    // none of this code may reach them, so refuse rather than risk reading
    // or writing a same-named local path.
    if (t.remote) throw new Error('remote task — file browsing and checkpoints are local-only');
    if (!isExistingDir(t.cwd)) throw new Error('invalid task root');
    return t.cwd;
  };
  // ── remote agents (Hermes profiles on other machines, over SSH) ──
  /** Validate the fields present in a renderer-supplied agent (all required on create). */
  function parseAgentFields(o: Record<string, unknown>, requireAll: boolean) {
    const out: Partial<Pick<RemoteAgent, 'name' | 'sshTarget' | 'hermesHome' | 'binaryPath' | 'profile'>> = {};
    if (requireAll || o['name'] !== undefined) {
      const name = str(o['name'], 'name').trim();
      if (!name || name.length > 60) throw new Error('Name must be 1–60 characters.');
      out.name = name;
    }
    if (requireAll || o['sshTarget'] !== undefined) {
      const t = str(o['sshTarget'], 'sshTarget').trim();
      if (!isValidSshTarget(t)) throw new Error(`invalid SSH target: ${JSON.stringify(t)}`);
      out.sshTarget = t;
    }
    if (requireAll || o['profile'] !== undefined) {
      const profile = (strOrNull(o['profile'], 'profile') ?? '').trim() || 'default';
      if (profile !== 'default' && !isValidProfileName(profile)) throw new Error(`invalid profile name: ${JSON.stringify(profile)}`);
      out.profile = profile;
    }
    for (const k of ['hermesHome', 'binaryPath'] as const) {
      if (requireAll || o[k] !== undefined) out[k] = strOrNull(o[k], k)?.trim() || null;
    }
    return out;
  }
  handle(IpcChannel.RemoteList, () => remoteAgents.list());
  handle(IpcChannel.RemoteCreate, (_e, raw: unknown) => {
    const f = parseAgentFields(obj(raw, 'remote agent'), true);
    return remoteAgents.create({
      name: f.name!, sshTarget: f.sshTarget!, profile: f.profile!,
      hermesHome: f.hermesHome ?? null, binaryPath: f.binaryPath ?? null,
    });
  });
  handle(IpcChannel.RemoteUpdate, (_e, id: unknown, raw: unknown) =>
    remoteAgents.update(str(id, 'id'), parseAgentFields(obj(raw, 'remote agent patch'), false)),
  );
  handle(IpcChannel.RemoteRemove, (_e, id: unknown) => remoteAgents.remove(str(id, 'id')));
  // Either a stored agent (`{ id }`) or a draft being filled in (`{ sshTarget, … }`):
  // the draft is validated like a create, and only ever runs a fixed `ls`-style script.
  handle(IpcChannel.RemoteProfiles, (_e, raw: unknown) => {
    const o = obj(raw, 'remote profiles request');
    const id = strOrNull(o['id'], 'id');
    if (id) {
      const a = remoteAgents.get(id);
      if (!a) throw new Error('This remote agent no longer exists.');
      return listRemoteProfiles(toOrigin(a));
    }
    const remote = parseRemote(o);
    if (!remote) throw new Error('sshTarget is required');
    return listRemoteProfiles(remote);
  });

  // Read-only browsing of the task's own working folder (not the active
  // project's — a task can run in any folder).
  handle(IpcChannel.FsList, (_e, taskId: unknown, rel?: unknown) => listDir(taskRoot(taskId), strOrNull(rel, 'path') ?? ''));
  handle(IpcChannel.FsRead, (_e, taskId: unknown, rel: unknown) => readFilePreview(taskRoot(taskId), str(rel, 'path')));
  // ponytail: in memory — checkpoints do not survive an app restart; persist
  // under userData if revert-after-restart is needed.
  const checkpoints = new Map<string, string | null>(); // `${taskId}\0${rel}` → pre-edit text
  const takeCheckpoint = (taskId: string, rel: string): string | null => {
    const key = `${taskId}\0${rel}`;
    if (!checkpoints.has(key)) checkpoints.set(key, snapshotFile(taskRoot(taskId), rel));
    return checkpoints.get(key) ?? null;
  };
  function autoCheckpoint(ev: Extract<AcpServerMessage, { kind: 'tool-call' }>): void {
    const task = tasks.list().find((t) => t.acpSessionId === ev.sessionId);
    if (!task || task.remote) return; // remote edits are out of local reach
    const args = (ev.args ?? {}) as { path?: unknown; file_path?: unknown; target?: unknown };
    const path = [ev.paths[0], args.path, args.file_path, args.target].find((p): p is string => typeof p === 'string');
    if (!path) return;
    const abs = resolveWithinRoot(task.cwd, isAbsolute(path) ? path : resolve(task.cwd, path));
    if (!abs) return;
    try {
      takeCheckpoint(task.id, relative(task.cwd, abs));
    } catch (err) {
      console.error('[checkpoint]', path, String(err));
    }
  }
  handle(IpcChannel.FsCheckpoint, (_e, taskId: unknown, rel: unknown) =>
    takeCheckpoint(str(taskId, 'taskId'), str(rel, 'path')),
  );
  handle(IpcChannel.FsSnapshot, (_e, taskId: unknown, rel: unknown) => snapshotFile(taskRoot(taskId), str(rel, 'path')));
  handle(IpcChannel.FsRevert, (_e, taskId: unknown, rel: unknown) => {
    const key = `${str(taskId, 'taskId')}\0${str(rel, 'path')}`;
    if (!checkpoints.has(key)) throw new Error('no checkpoint for this file');
    revertFile(taskRoot(taskId), rel as string, checkpoints.get(key) ?? null);
    checkpoints.delete(key);
  });
}
