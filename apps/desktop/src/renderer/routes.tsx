// apps/desktop/src/renderer/routes.tsx
import { Switch, Route, Redirect } from 'wouter';
import { ChatPage } from './features/chat/ChatPage';
import { CoworkPage } from './features/cowork/CoworkPage';
import { NewTaskDialog } from './features/cowork/NewTaskDialog';
import { TasksPage } from './features/cowork/TasksPage';
import { CodePage } from './features/code/CodePage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { ProfilesManager } from './features/profiles/ProfilesManager';
import { SkillsPage, MemoryPage, CronPage, KanbanPage, InsightsPage } from './features/hermes/HermesSurfaces';

export function Routes() {
  return (
    <Switch>
      <Route path="/chat"><ChatPage /></Route>
      <Route path="/cowork"><CoworkPage /></Route>
      <Route path="/cowork/new"><NewTaskDialog /></Route>
      <Route path="/cowork/tasks"><TasksPage /></Route>
      <Route path="/cowork/projects"><ProjectsPage /></Route>
      <Route path="/profiles"><ProfilesManager /></Route>
      <Route path="/code"><CodePage /></Route>
      <Route path="/kanban"><KanbanPage /></Route>
      <Route path="/memory"><MemoryPage /></Route>
      <Route path="/skills"><SkillsPage /></Route>
      <Route path="/cron"><CronPage /></Route>
      <Route path="/insights"><InsightsPage /></Route>
      <Route path="/"><Redirect to="/chat" /></Route>
      <Route><div className="p-6 text-muted">Not found</div></Route>
    </Switch>
  );
}
