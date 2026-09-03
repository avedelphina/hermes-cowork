export const IpcChannel = {
  // status / runtime
  RuntimeProbe: 'runtime:probe',

  // profiles — list/status come straight from the dashboard via the REST proxy
  ProfileSwitch: 'profile:switch',
  ProfileEnv: 'profile:env',  // resolved global home + HERMES_HOME profile hint

  // ACP
  AcpStart: 'acp:start',
  AcpLoad: 'acp:load',
  AcpSend: 'acp:send',
  AcpSetMode: 'acp:set-mode',
  AcpSetModel: 'acp:set-model',
  AcpModels: 'acp:models',  // read cached available/current models for a session
  AcpStop: 'acp:stop',
  AcpEvent: 'acp:event',  // main → renderer push

  // dashboard REST proxy (so renderer never touches network)
  RestGet: 'rest:get',
  RestPost: 'rest:post',
  RestPatch: 'rest:patch',
  RestDelete: 'rest:delete',

  // kanban WebSocket pump
  KanbanWsSubscribe: 'kanban-ws:subscribe',
  KanbanWsEvent: 'kanban-ws:event',

  // dialog
  ShowFolderPicker: 'dialog:folder',

  // app
  Notify: 'app:notify', // desktop notification when the window is unfocused

  // projects
  ProjectList: 'project:list',
  ProjectCreate: 'project:create',
  ProjectUpdate: 'project:update',
  ProjectSetActive: 'project:set-active',
  ProjectRemove: 'project:remove',
  ProjectContextFiles: 'project:context-files', // which context files exist in a folder

  // cowork tasks
  TaskList: 'task:list',
  TaskCreate: 'task:create',
  TaskUpdate: 'task:update',
  TaskRemove: 'task:remove',

  // chat sessions (plain chatbot conversations, folderless)
  ChatList: 'chat:list',
  ChatCreate: 'chat:create',
  ChatUpdate: 'chat:update',
  ChatRemove: 'chat:remove',

  // project filesystem (scoped to a project root)
  FsList: 'fs:list',
  FsRead: 'fs:read',
  FsSnapshot: 'fs:snapshot', // capture current text for a checkpoint
  FsRevert: 'fs:revert',     // restore checkpointed text (guarded write)
} as const;

export type IpcChannelKey = (typeof IpcChannel)[keyof typeof IpcChannel];
