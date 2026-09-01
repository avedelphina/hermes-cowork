// apps/desktop/src/main/ipc/handlers.ts
import { ipcMain, BrowserWindow, dialog } from 'electron';
import { IpcChannel } from './channels';
import { AcpSupervisor } from '../orchestrator/acp-supervisor';
import { AcpBridge } from '../orchestrator/acp-bridge';
import type { AcpServerMessage, ProfileSummary, StatusSnapshot, AcpClientMessage } from '../../shared/types';
import { findHermesBinary, verifyHermesVersion, MIN_HERMES_VERSION } from '../orchestrator/hermes-runtime';
import { profileHome } from '../orchestrator/hermes-home';
import { isExistingDir } from '../security/paths';

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

  ipcMain.handle(IpcChannel.RuntimeStatus, async (): Promise<StatusSnapshot> => {
    const r = await fetch(`${base}/api/status`, { headers: authHeader() });
    if (!r.ok) throw new Error(`status fetch failed: ${r.status}`);
    // Hermes 0.20.6 shape: flat gateway_running + gateway_platforms map.
    const body = (await r.json()) as {
      version: string;
      gateway_running?: boolean;
      gateway_platforms?: Record<string, { state?: string }>;
    };
    const platforms = Object.entries(body.gateway_platforms ?? {})
      .filter(([, v]) => v?.state === 'connected')
      .map(([k]) => k);
    return {
      hermesVersion: body.version,
      dashboardPort: ctx.dashboardPort,
      gateway: { running: body.gateway_running ?? false, platforms },
    };
  });

  // ── profiles ──
  // Hermes 0.20.6: GET /api/profiles -> { profiles: [{ name, path, model, provider, ... }] };
  // the active profile is a separate GET /api/profiles/active -> { active, current }.
  ipcMain.handle(IpcChannel.ProfileList, async (): Promise<ProfileSummary[]> => {
    const [pRes, aRes] = await Promise.all([
      fetch(`${base}/api/profiles`, { headers: authHeader() }),
      fetch(`${base}/api/profiles/active`, { headers: authHeader() }),
    ]);
    if (!pRes.ok) throw new Error(`profiles fetch failed: ${pRes.status}`);
    const { profiles } = (await pRes.json()) as {
      profiles: Array<{ name: string; path: string; model?: string | null; provider?: string | null }>;
    };
    const active = aRes.ok ? ((await aRes.json()) as { active?: string }).active ?? null : null;
    return profiles.map((p) => ({
      name: p.name,
      active: p.name === active,
      hermesHome: p.path,
      model: p.model ?? null,
      provider: p.provider ?? null,
    }));
  });

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

  ipcMain.handle(IpcChannel.AcpStart, async (_e, opts: { profile: string; cwd: string }) => {
    // Folder scope is the trust boundary: a task only ever runs against an
    // explicit, existing directory the user picked. See docs/security-model.md.
    if (!isExistingDir(opts.cwd)) {
      throw new Error(`Refusing to start: "${opts.cwd}" is not an existing directory.`);
    }
    return bridge.startSession({
      profile: opts.profile,
      cwd: opts.cwd,
      binaryPath: ctx.hermesBinary,
      hermesHome: profileHome(ctx.globalHermesHome, opts.profile),
    });
  });

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
}
