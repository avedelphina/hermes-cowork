import { create } from 'zustand';
import type { Project, ProjectSnapshot } from '@shared/types';

type ProjectStore = {
  projects: Project[];
  activeId: string | null;
  loaded: boolean;
  apply: (snap: ProjectSnapshot) => void;
  load: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  activeId: null,
  loaded: false,
  apply: (snap) => set({ projects: snap.projects, activeId: snap.activeId, loaded: true }),
  load: async () => {
    const snap = await window.hermes.projects.list();
    set({ projects: snap.projects, activeId: snap.activeId, loaded: true });
  },
  setActive: async (id) => {
    const snap = await window.hermes.projects.setActive(id);
    set({ projects: snap.projects, activeId: snap.activeId });
  },
  remove: async (id) => {
    const snap = await window.hermes.projects.remove(id);
    set({ projects: snap.projects, activeId: snap.activeId });
  },
}));

export function activeProject(): Project | null {
  const { projects, activeId } = useProjectStore.getState();
  return projects.find((p) => p.id === activeId) ?? null;
}
