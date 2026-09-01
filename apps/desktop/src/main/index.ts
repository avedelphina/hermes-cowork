import { app, BrowserWindow, shell } from 'electron';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { findHermesBinary, verifyHermesVersion } from './orchestrator/hermes-runtime';
import { resolveHermesHomes } from './orchestrator/hermes-home';
import { ensureDashboard, fetchDashboardToken } from './orchestrator/dashboard';
import { AcpSupervisor } from './orchestrator/acp-supervisor';
import { registerIpcHandlers } from './ipc/handlers';
import { KanbanWsPump } from './orchestrator/kanban-ws';

let win: BrowserWindow | null = null;
let pump: KanbanWsPump | null = null;
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
      sandbox: false,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

const supervisor = new AcpSupervisor();

void app.whenReady().then(async () => {
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
    },
    supervisor,
  );

  if (dashboardPort > 0) {
    pump = new KanbanWsPump({ port: dashboardPort, win: () => win });
    await pump.start();
  }

  createWindow();
});

function stopOwnedChildren() {
  pump?.stop();
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
