import { app, BrowserWindow, session, shell } from 'electron';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { isAppUrl, type AppUrlConfig } from './security/app-url';
import { findHermesBinary, verifyHermesVersion } from './orchestrator/hermes-runtime';
import { resolveHermesHomes } from './orchestrator/hermes-home';
import { ensureDashboard, fetchDashboardToken } from './orchestrator/dashboard';
import { AcpSupervisor } from './orchestrator/acp-supervisor';
import { registerIpcHandlers } from './ipc/handlers';
// KanbanWsPump is intentionally not started — see note below.

let win: BrowserWindow | null = null;
const appUrl: AppUrlConfig = {
  devUrl: process.env['ELECTRON_RENDERER_URL'],
  indexHtml: join(__dirname, '../renderer/index.html'),
};
// Set only when we spawned the dashboard ourselves — a reused external one is
// left alone.
let dashboardChild: ChildProcess | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only hand real web links to the OS — never file:, mailto:, or custom
    // app schemes.
    try {
      const scheme = new URL(url).protocol;
      if (scheme === 'https:' || scheme === 'http:') void shell.openExternal(url);
    } catch {
      // not a valid URL — ignore
    }
    return { action: 'deny' };
  });
  // Block any real navigation away from the app itself (routing is pushState).
  // Block every real navigation (and redirect) off the app's own document.
  // Routing is hash-based, so in-app moves never trigger these at all.
  const guard = (e: { preventDefault: () => void }, url: string) => {
    if (!isAppUrl(url, appUrl)) e.preventDefault();
  };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);

  if (appUrl.devUrl) {
    win.loadURL(appUrl.devUrl);
  } else {
    win.loadFile(appUrl.indexHtml);
  }
}

const supervisor = new AcpSupervisor();

void app.whenReady().then(async () => {
  // The app needs no camera, mic, geolocation, notifications-via-web, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  const found = findHermesBinary();
  const homes = resolveHermesHomes();
  let hermesBinary = '';
  let dashboardPort = 0;
  let dashboardToken: string | null = null;

  if (found.kind === 'found') {
    const versionCheck = await verifyHermesVersion(found.path);
    if (versionCheck.kind === 'ok') {
      hermesBinary = found.path;
      // The dashboard enumerates every profile, so it must run against the
      // global home — never a profile-scoped one.
      const dashboard = await ensureDashboard({ binaryPath: found.path, hermesHome: homes.global });
      if (dashboard.kind === 'ready') {
        dashboardPort = dashboard.port;
        dashboardChild = dashboard.child;
        dashboardToken = await fetchDashboardToken(dashboard.port);
      }
    }
    console.log(
      `[startup] hermes ${found.path} · dashboard ${dashboardPort || 'DOWN'} · token ${dashboardToken ? 'ok' : 'none'}`,
    );
  }

  registerIpcHandlers(
    {
      hermesBinary,
      dashboardPort,
      dashboardToken,
      globalHermesHome: homes.global,
      envProfile: homes.envProfile,
      win: () => win,
      appUrl,
    },
    supervisor,
  );

  // NOTE: the kanban events WebSocket (orchestrator/kanban-ws.ts) needs a
  // per-connection auth ticket (POST /api/auth/ws-ticket) we do not yet mint,
  // so it 403s and reconnect-loops. Re-enable once Cowork needs live kanban.

  createWindow();
});

function stopOwnedChildren() {
  supervisor.shutdownAll();
  if (dashboardChild && dashboardChild.exitCode === null) {
    dashboardChild.kill('SIGTERM');
    dashboardChild = null;
  }
}

app.on('window-all-closed', () => {
  stopOwnedChildren();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopOwnedChildren);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
