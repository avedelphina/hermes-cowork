import { create } from 'zustand';
import type { Project } from '@shared/types';

type ProjectStore = {
  projects: Project[];
  activeId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  update: (id: string, patch: { name?: string; profile?: string; archived?: boolean }) => Promise<void>;
};

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  activeId: null,
  loaded: false,
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
  update: async (id, patch) => {
    await window.hermes.projects.update(id, patch);
    const snap = await window.hermes.projects.list();
    set({ projects: snap.projects, activeId: snap.activeId });
  },
}));

export function activeProject(): Project | null {
  const { projects, activeId } = useProjectStore.getState();
  return projects.find((p) => p.id === activeId) ?? null;
}
