// apps/desktop/src/main/update/updater.ts
import { app, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IpcChannel } from '../ipc/channels';
import type { UpdateStatus } from '../../shared/types';

export type UpdaterController = {
  check: () => Promise<void>;
  download: () => Promise<void>;
  /** Quits and installs the already-downloaded update. No-op otherwise. */
  install: () => void;
  /** Last known status — lets a renderer that mounts after a check ran (e.g.
   * the startup auto-check) catch up without waiting for the next event. */
  getStatus: () => UpdateStatus;
};

/**
 * Wraps electron-updater. Feed config (GitHub owner/repo) comes from
 * `publish:` in electron-builder.yml, baked into app-update.yml at build
 * time — nothing to configure here.
 */
export function createUpdater(win: () => BrowserWindow | null): UpdaterController {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  let current: UpdateStatus = { state: 'idle' };
  const emit = (s: UpdateStatus) => {
    current = s;
    win()?.webContents.send(IpcChannel.UpdateEvent, s);
  };

  autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => emit({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => emit({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => emit({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => emit({ state: 'error', message: err.message }));

  // Unpackaged (dev) runs have no code signature and no feed to hit —
  // electron-updater throws immediately, so every entry point checks first.
  const packaged = () => app.isPackaged;

  return {
    check: async () => {
      if (!packaged()) return;
      await autoUpdater.checkForUpdates();
    },
    download: async () => {
      if (!packaged()) return;
      await autoUpdater.downloadUpdate();
    },
    install: () => {
      if (!packaged()) return;
      autoUpdater.quitAndInstall();
    },
    getStatus: () => current,
  };
}
