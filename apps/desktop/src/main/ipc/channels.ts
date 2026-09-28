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
  AcpDrain: 'acp:drain',
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

  // auto-update
  UpdateCheck: 'update:check',
  UpdateDownload: 'update:download',
  UpdateInstall: 'update:install',   // quits and installs the downloaded update
  UpdateStatus: 'update:status',     // last known UpdateStatus, for late mounts
  UpdateEvent: 'update:event',       // main → renderer push (UpdateStatus)

  // projects
  ProjectList: 'project:list',
  ProjectCreate: 'project:create',
  ProjectUpdate: 'project:update',
  ProjectSetActive: 'project:set-active',
  ProjectRemove: 'project:remove',
  ProjectContextFiles: 'project:context-files', // which context files exist in a folder

  // contexts (durable groups of related projects)
  ContextList: 'context:list',
  ContextCreate: 'context:create',
  ContextUpdate: 'context:update',
  ContextArchive: 'context:archive',

  // local app settings
  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',

  // cowork tasks
  TaskList: 'task:list',
  TaskCreate: 'task:create',
  TaskGitPrepare: 'task:git-prepare',
  TaskStart: 'task:start',
  /** Attach this desktop main process to an existing durable local task run. */
  TaskAttach: 'task:attach',
  TaskStop: 'task:stop',
  TaskApproveDesign: 'task:approve-design',
  TaskRearmPlan: 'task:rearm-plan',
  TaskApproveVerification: 'task:approve-verification',
  TaskComplete: 'task:complete',
  TaskUpdate: 'task:update',
  TaskRemove: 'task:remove',

  // chat sessions (plain chatbot conversations, folderless)
  ChatList: 'chat:list',
  ChatCreate: 'chat:create',
  ChatBind: 'chat:bind',
  ChatUpdate: 'chat:update',
  ChatRemove: 'chat:remove',

  // remote agents (Hermes profiles on other machines, over SSH)
  RemoteList: 'remote:list',
  RemoteCreate: 'remote:create',
  RemoteUpdate: 'remote:update',
  RemoteRemove: 'remote:remove',
  RemoteProfiles: 'remote:profiles', // list the profiles on a remote host (ssh, no Hermes)

  // task filesystem (read-only, scoped to a task's working folder)
  FsList: 'fs:list',
  FsRead: 'fs:read',
  FsCheckpoint: 'fs:checkpoint', // pre-edit text held in main (taken once per task+file)
  FsSnapshot: 'fs:snapshot',     // current text of a task file (for the diff)
  FsRevert: 'fs:revert',         // restore the main-held checkpoint (guarded write)
} as const;

export type IpcChannelKey = (typeof IpcChannel)[keyof typeof IpcChannel];
