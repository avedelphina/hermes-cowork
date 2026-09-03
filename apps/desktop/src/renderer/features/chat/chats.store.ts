import { create } from 'zustand';
import type { ChatSession } from '@shared/types';

type ChatsStore = {
  chats: ChatSession[];
  loaded: boolean;
  reload: () => Promise<void>;
};

/** The persisted list of Chat conversations (chats.json), shared by the
 *  SessionList and the surface that creates/renames them. */
export const useChatsStore = create<ChatsStore>((set) => ({
  chats: [],
  loaded: false,
  reload: async () => {
    try {
      const chats = await window.hermes.chats.list();
      set({ chats, loaded: true });
    } catch {
      set({ chats: [], loaded: true });
    }
  },
}));
