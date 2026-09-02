import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { TitleBar } from './shell/TitleBar';
import { ModeTabs } from './shell/ModeTabs';
import { Sidebar } from './shell/Sidebar';
import { StatusBar } from './shell/StatusBar';
import { Routes } from './routes';
import { RuntimeError } from './shell/RuntimeError';
import { useProjectStore } from './features/projects/project.store';

type Probe = Awaited<ReturnType<typeof window.hermes.runtime.probe>>;

const MODE_KEYS: Record<string, string> = { '1': '/chat', '2': '/cowork', '3': '/code' };

export function App() {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [, navigate] = useLocation();
  const loadProjects = useProjectStore((s) => s.load);
  useEffect(() => {
    void window.hermes.runtime.probe().then(setProbe);
    void loadProjects();
  }, [loadProjects]);

  // ⌘1 / ⌘2 / ⌘3 switch modes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && MODE_KEYS[e.key]) {
        e.preventDefault();
        navigate(MODE_KEYS[e.key]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (probe === null) {
    return <main className="flex h-screen items-center justify-center text-muted">Connecting to Hermes…</main>;
  }
  if (probe.kind !== 'ok') {
    return <RuntimeError error={probe} />;
  }

  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <ModeTabs />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden bg-bg">
          <Routes />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
