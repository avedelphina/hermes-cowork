// apps/desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '../main/ipc/channels';
import type {
  AcpClientMessage, AcpServerMessage, Project, ProjectSnapshot, DirListing, FilePreview,
} from '../shared/types';

const api = {
  runtime: {
    probe: () => ipcRenderer.invoke(IpcChannel.RuntimeProbe),
  },
  profile: {
    switch: (name: string): Promise<void> => ipcRenderer.invoke(IpcChannel.ProfileSwitch, name),
    env: (): Promise<{ globalHermesHome: string; envProfile: string | null }> =>
      ipcRenderer.invoke(IpcChannel.ProfileEnv),
  },
  acp: {
    start: (opts: { profile: string; cwd?: string; isolate?: boolean }): Promise<{ sessionId: string }> =>
      ipcRenderer.invoke(IpcChannel.AcpStart, opts),
    load: (opts: { sessionId: string; profile?: string; cwd?: string }): Promise<{ sessionId: string }> =>
      ipcRenderer.invoke(IpcChannel.AcpLoad, opts),
    send: (msg: AcpClientMessage): Promise<void> => ipcRenderer.invoke(IpcChannel.AcpSend, msg),
    setMode: (opts: { sessionId: string; modeId: string }): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.AcpSetMode, opts),
    stop: (sessionId: string): Promise<void> => ipcRenderer.invoke(IpcChannel.AcpStop, sessionId),
    onEvent: (cb: (msg: AcpServerMessage) => void) => {
      const listener = (_e: unknown, msg: AcpServerMessage) => cb(msg);
      ipcRenderer.on(IpcChannel.AcpEvent, listener);
      return () => ipcRenderer.removeListener(IpcChannel.AcpEvent, listener);
    },
  },
  rest: {
    get: <T>(path: string): Promise<T> => ipcRenderer.invoke(IpcChannel.RestGet, path),
    post: <T>(path: string, body: unknown): Promise<T> => ipcRenderer.invoke(IpcChannel.RestPost, path, body),
    patch: <T>(path: string, body: unknown): Promise<T> => ipcRenderer.invoke(IpcChannel.RestPatch, path, body),
  },
  kanbanWs: {
    subscribe: (boardSlug: string | null): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.KanbanWsSubscribe, boardSlug),
    onEvent: (cb: (event: unknown) => void) => {
      const listener = (_e: unknown, ev: unknown) => cb(ev);
      ipcRenderer.on(IpcChannel.KanbanWsEvent, listener);
      return () => ipcRenderer.removeListener(IpcChannel.KanbanWsEvent, listener);
    },
  },
  dialog: {
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IpcChannel.ShowFolderPicker),
  },
  projects: {
    list: (): Promise<ProjectSnapshot> => ipcRenderer.invoke(IpcChannel.ProjectList),
    create: (input: { name: string; folderPath: string; profile: string }): Promise<Project> =>
      ipcRenderer.invoke(IpcChannel.ProjectCreate, input),
    update: (id: string, patch: { name?: string; profile?: string; folderPath?: string }): Promise<Project | null> =>
      ipcRenderer.invoke(IpcChannel.ProjectUpdate, id, patch),
    setActive: (id: string): Promise<ProjectSnapshot> => ipcRenderer.invoke(IpcChannel.ProjectSetActive, id),
    remove: (id: string): Promise<ProjectSnapshot> => ipcRenderer.invoke(IpcChannel.ProjectRemove, id),
    contextFiles: (id: string): Promise<string[]> => ipcRenderer.invoke(IpcChannel.ProjectContextFiles, id),
  },
  fs: {
    list: (id: string, rel?: string): Promise<DirListing> => ipcRenderer.invoke(IpcChannel.FsList, id, rel),
    read: (id: string, rel: string): Promise<FilePreview> => ipcRenderer.invoke(IpcChannel.FsRead, id, rel),
  },
};

contextBridge.exposeInMainWorld('hermes', api);
export type HermesApi = typeof api;
