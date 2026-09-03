// apps/desktop/src/main/ipc/handlers.ts
import { app, ipcMain, BrowserWindow, dialog, Notification } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { IpcChannel } from './channels';
import { AcpSupervisor } from '../orchestrator/acp-supervisor';
import { AcpBridge } from '../orchestrator/acp-bridge';
import type { AcpServerMessage, AcpClientMessage } from '../../shared/types';
import { findHermesBinary, verifyHermesVersion, MIN_HERMES_VERSION } from '../orchestrator/hermes-runtime';
import { profileHome, isValidProfileName } from '../orchestrator/hermes-home';
import { isExistingDir } from '../security/paths';
import { ProjectStore } from '../store/project-store';
import { TaskStore } from '../store/task-store';
import { ChatSessionStore } from '../store/chat-session-store';
import { contextFiles, listDir, readFilePreview, snapshotFile, revertFile } from '../fs/project-fs';
import type { CoworkTask, TaskStatus } from '../../shared/types';

type Context = {
  hermesBinary: string;
  dashboardPort: number;
  dashboardToken: string | null;
  /** Global Hermes home — the directory that contains `profiles/`. */
  globalHermesHome: string;
  /** Profile HERMES_HOME was scoped to at launch, or null. */
  envProfile: string | null;
  win: () => BrowserWindow | null;
};

export function registerIpcHandlers(ctx: Context, sup: AcpSupervisor): void {
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
      try {
        const r = await fetch(`${base}/api/profiles`, { headers: authHeader() });
        const body = (await r.json()) as { profiles?: Array<{ name?: string }> };
        profileCache = {
          names: new Set((body.profiles ?? []).map((p) => p.name).filter((n): n is string => !!n)),
          at: Date.now(),
        };
      } catch {
        profileCache = { names: new Set(), at: Date.now() };
      }
    }
    if (!profileCache.names.has(name)) throw new Error(`unknown profile: ${name}`);
  };

  // ── runtime ──
  ipcMain.handle(IpcChannel.RuntimeProbe, async () => {
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
  ipcMain.handle(IpcChannel.ProfileEnv, async (): Promise<{ globalHermesHome: string; envProfile: string | null }> => ({
    globalHermesHome: ctx.globalHermesHome,
    envProfile: ctx.envProfile,
  }));

  const bridge = new AcpBridge(sup);

  ipcMain.handle(IpcChannel.ProfileSwitch, async (_e, name: string): Promise<void> => {
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
    ctx.win()?.webContents.send(IpcChannel.AcpEvent, semantic);
  });

  ipcMain.handle(
    IpcChannel.AcpStart,
    async (_e, opts: { profile: string; cwd?: string; isolate?: boolean }) => {
      // Chat is not folder-scoped — it defaults to the home directory. A Cowork
      // task always passes an explicit folder the user picked. An explicit cwd
      // that does not exist fails closed (never a silent widening to $HOME).
      const cwd = opts.cwd ? opts.cwd : homedir();
      if (!isExistingDir(cwd)) {
        throw new Error(`Refusing to start: "${cwd}" is not an existing directory.`);
      }
      await assertKnownProfile(opts.profile);
      return bridge.startSession({
        profile: opts.profile,
        cwd,
        isolate: !!opts.isolate,
        binaryPath: ctx.hermesBinary,
        hermesHome: profileHome(ctx.globalHermesHome, opts.profile),
      });
    },
  );

  ipcMain.handle(IpcChannel.AcpSetMode, async (_e, opts: { sessionId: string; modeId: string }) => {
    await bridge.setMode(opts.sessionId, opts.modeId);
  });

  ipcMain.handle(IpcChannel.AcpSetModel, async (_e, opts: { sessionId: string; modelId: string }) => {
    await bridge.setModel(opts.sessionId, opts.modelId);
  });

  ipcMain.handle(IpcChannel.AcpModels, (_e, sessionId: string) => bridge.getModels(sessionId));

  ipcMain.handle(
    IpcChannel.AcpLoad,
    async (_e, opts: { sessionId: string; profile?: string; cwd?: string; isolate?: boolean }) => {
      const profile = opts.profile ?? 'default';
      // An explicit cwd must exist — a moved/deleted project folder must fail,
      // not silently widen the task's scope to $HOME.
      if (opts.cwd && !isExistingDir(opts.cwd)) {
        throw new Error(`Cannot resume: "${opts.cwd}" is not an existing directory.`);
      }
      const cwd = opts.cwd ? opts.cwd : homedir();
      await assertKnownProfile(profile);
      return bridge.loadSession({
        sessionId: opts.sessionId,
        profile,
        cwd,
        isolate: !!opts.isolate,
        binaryPath: ctx.hermesBinary,
        hermesHome: profileHome(ctx.globalHermesHome, profile),
      });
    },
  );

  ipcMain.handle(IpcChannel.AcpSend, async (_e, msg: AcpClientMessage) => {
    if (msg.kind === 'prompt') {
      await bridge.sendPrompt(msg.sessionId, msg.text);
    } else {
      bridge.respondToPermission(msg.toolCallId, msg.allow);
    }
  });

  ipcMain.handle(IpcChannel.AcpStop, async (_e, sessionId: string) => {
    bridge.stopSession(sessionId);
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

  ipcMain.handle(IpcChannel.RestGet, (_e, path: string) => proxy('GET', path));
  ipcMain.handle(IpcChannel.RestPost, (_e, path: string, body: unknown) => proxy('POST', path, body ?? {}));
  ipcMain.handle(IpcChannel.RestPatch, (_e, path: string, body: unknown) => proxy('PATCH', path, body ?? {}));
  ipcMain.handle(IpcChannel.RestDelete, (_e, path: string) => proxy('DELETE', path));

  // ── kanban WS ──
  ipcMain.handle(IpcChannel.KanbanWsSubscribe, (_e, _boardSlug: string | null) => undefined);

  // ── app ──
  ipcMain.handle(IpcChannel.Notify, (_e, opts: { title: string; body: string }) => {
    const w = ctx.win();
    if (w && !w.isFocused() && Notification.isSupported()) {
      const n = new Notification({ title: opts.title, body: opts.body });
      n.on('click', () => { w.show(); w.focus(); });
      n.show();
    }
  });

  // ── dialog ──
  ipcMain.handle(IpcChannel.ShowFolderPicker, async () => {
    const w = ctx.win();
    if (!w) return null;
    const result = await dialog.showOpenDialog(w, { properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // ── projects ──
  // HERMES_COWORK_USERDATA lets e2e tests point the store at a scratch dir.
  const userData = process.env['HERMES_COWORK_USERDATA'] || app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  const projects = new ProjectStore(join(userData, 'projects.json'));

  ipcMain.handle(IpcChannel.ProjectList, () => projects.snapshot());

  ipcMain.handle(
    IpcChannel.ProjectCreate,
    (_e, input: { name: string; folderPath: string | null; profile: string }) => {
      // A folder is optional (chat-only projects). If given, it must exist.
      const folderPath = input.folderPath?.trim() ? input.folderPath : null;
      if (folderPath !== null && !isExistingDir(folderPath)) {
        throw new Error(`"${folderPath}" is not an existing directory.`);
      }
      const name =
        input.name.trim() ||
        folderPath?.split('/').filter(Boolean).pop() ||
        'Project';
      return projects.create({ name, folderPath, profile: input.profile });
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectUpdate,
    (_e, id: string, patch: { name?: string; profile?: string; folderPath?: string | null }) => {
      const next = { ...patch };
      if (patch.folderPath !== undefined) {
        next.folderPath = patch.folderPath?.trim() ? patch.folderPath : null;
        if (next.folderPath !== null && !isExistingDir(next.folderPath)) {
          throw new Error(`"${next.folderPath}" is not an existing directory.`);
        }
      }
      return projects.update(id, next);
    },
  );

  ipcMain.handle(IpcChannel.ProjectSetActive, (_e, id: string) => {
    projects.setActive(id);
    return projects.snapshot();
  });

  ipcMain.handle(IpcChannel.ProjectRemove, (_e, id: string) => {
    projects.remove(id);
    return projects.snapshot();
  });

  const projectRoot = (id: string): string => {
    const p = projects.get(id);
    if (!p) throw new Error(`unknown project ${id}`);
    if (!p.folderPath) throw new Error(`project ${id} has no folder`);
    return p.folderPath;
  };

  ipcMain.handle(IpcChannel.ProjectContextFiles, (_e, id: string) => contextFiles(projectRoot(id)));

  // ── cowork tasks ──
  const tasks = new TaskStore(join(userData, 'tasks.json'));
  ipcMain.handle(IpcChannel.TaskList, () => tasks.list());
  ipcMain.handle(IpcChannel.TaskCreate, (_e, input: Omit<CoworkTask, 'id' | 'status' | 'approved' | 'createdAt' | 'updatedAt'>) => {
    // The stored cwd is the trust root for this task's checkpoint IPC, so it
    // must be a real directory (same bar as acp:start).
    if (!isExistingDir(input.cwd)) throw new Error(`Refusing to record a task in "${input.cwd}" — not an existing directory.`);
    return tasks.create(input);
  });
  ipcMain.handle(IpcChannel.TaskUpdate, (_e, id: string, patch: { status?: TaskStatus; approved?: boolean }) =>
    tasks.update(id, patch),
  );
  ipcMain.handle(IpcChannel.TaskRemove, (_e, id: string) => tasks.remove(id));

  // ── chat sessions ──
  const chats = new ChatSessionStore(join(userData, 'chats.json'));
  ipcMain.handle(IpcChannel.ChatList, () => chats.list());
  ipcMain.handle(
    IpcChannel.ChatCreate,
    (_e, input: { acpSessionId: string; projectId: string | null; title: string | null }) =>
      chats.create(input),
  );
  ipcMain.handle(
    IpcChannel.ChatUpdate,
    (_e, id: string, patch: { title?: string | null; projectId?: string | null }) => chats.update(id, patch),
  );
  ipcMain.handle(IpcChannel.ChatRemove, (_e, id: string) => chats.remove(id));

  // ── project filesystem (read-only, scoped to the project root) ──
  ipcMain.handle(IpcChannel.FsList, (_e, id: string, rel?: string) => listDir(projectRoot(id), rel ?? ''));
  ipcMain.handle(IpcChannel.FsRead, (_e, id: string, rel: string) => readFilePreview(projectRoot(id), rel));

  // Checkpoints are scoped to a task's working folder. The renderer only ever
  // sends a taskId — the root is resolved here from the task registry, never
  // trusted from the renderer.
  const taskRoot = (taskId: string): string => {
    const t = tasks.get(taskId);
    if (!t) throw new Error(`unknown task ${taskId}`);
    return t.cwd;
  };
  ipcMain.handle(IpcChannel.FsSnapshot, (_e, taskId: string, rel: string) => {
    const root = taskRoot(taskId);
    return isExistingDir(root) ? snapshotFile(root, rel) : null;
  });
  ipcMain.handle(IpcChannel.FsRevert, (_e, taskId: string, rel: string, content: string | null) => {
    const root = taskRoot(taskId);
    if (!isExistingDir(root)) throw new Error('invalid task root');
    revertFile(root, rel, content);
  });
}
