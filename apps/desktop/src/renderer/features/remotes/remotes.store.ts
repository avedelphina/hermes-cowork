import { create } from 'zustand';
import type { RemoteAgent } from '@shared/types';

type RemotesStore = {
  remotes: RemoteAgent[];
  loaded: boolean;
  reload: () => Promise<void>;
};

/** Remote agents (Hermes profiles on other machines) — shared by Chat and the manager page. */
export const useRemotesStore = create<RemotesStore>((set) => ({
  remotes: [],
  loaded: false,
  reload: async () => {
    try {
      set({ remotes: await window.hermes.remotes.list(), loaded: true });
    } catch {
      set({ remotes: [], loaded: true });
    }
  },
}));
