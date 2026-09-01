// apps/desktop/src/main/ipc/handlers.ts
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { IpcChannel } from './channels';
import { AcpSupervisor } from '../orchestrator/acp-supervisor';
import { AcpBridge } from '../orchestrator/acp-bridge';
import type { AcpServerMessage, AcpClientMessage } from '../../shared/types';
import { findHermesBinary, verifyHermesVersion, MIN_HERMES_VERSION } from '../orchestrator/hermes-runtime';
import { profileHome } from '../orchestrator/hermes-home';
import { isExistingDir } from '../security/paths';
import { ProjectStore } from '../store/project-store';

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
      // task always passes an explicit folder the user picked, which must exist
      // (the trust boundary — see docs/security-model.md).
      const cwd = opts.cwd || homedir();
      if (!isExistingDir(cwd)) {
        throw new Error(`Refusing to start: "${cwd}" is not an existing directory.`);
      }
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

  ipcMain.handle(
    IpcChannel.AcpLoad,
    async (_e, opts: { sessionId: string; profile?: string; cwd?: string }) => {
      const profile = opts.profile ?? 'default';
      const cwd = opts.cwd && isExistingDir(opts.cwd) ? opts.cwd : homedir();
      return bridge.loadSession({
        sessionId: opts.sessionId,
        profile,
        cwd,
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
  ipcMain.handle(IpcChannel.RestGet, async (_e, path: string) => {
    const r = await fetch(`http://127.0.0.1:${ctx.dashboardPort}${path}`, { headers: authHeader() });
    if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
    return r.json();
  });

  ipcMain.handle(IpcChannel.RestPost, async (_e, path: string, body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${ctx.dashboardPort}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${path}: ${r.status}`);
    return r.json().catch(() => null);
  });

  ipcMain.handle(IpcChannel.RestPatch, async (_e, path: string, body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${ctx.dashboardPort}${path}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`PATCH ${path}: ${r.status}`);
    return r.json().catch(() => null);
  });

  // ── kanban WS ──
  ipcMain.handle(IpcChannel.KanbanWsSubscribe, (_e, _boardSlug: string | null) => undefined);

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
    (_e, input: { name: string; folderPath: string; profile: string }) => {
      if (!isExistingDir(input.folderPath)) {
        throw new Error(`"${input.folderPath}" is not an existing directory.`);
      }
      const name = input.name.trim() || input.folderPath.split('/').filter(Boolean).pop() || 'Project';
      return projects.create({ name, folderPath: input.folderPath, profile: input.profile });
    },
  );

  ipcMain.handle(
    IpcChannel.ProjectUpdate,
    (_e, id: string, patch: { name?: string; profile?: string; folderPath?: string }) => {
      if (patch.folderPath !== undefined && !isExistingDir(patch.folderPath)) {
        throw new Error(`"${patch.folderPath}" is not an existing directory.`);
      }
      return projects.update(id, patch);
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
}
