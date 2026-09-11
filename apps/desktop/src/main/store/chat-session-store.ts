// apps/desktop/src/main/store/chat-session-store.ts
//
// Persistent Chat conversations. Like TaskStore, a record is only the metadata
// around one ACP session — the conversation lives in Hermes and is replayed on
// resume via session/load. Unlike a task, a chat has no working folder, so
// there is nothing here to path-validate. Stored as plain JSON under userData.

import { readJson, writeJsonAtomic, pick } from './json-file';
import { randomUUID } from 'node:crypto';
import type { ChatSession } from '../../shared/types';
export type { ChatSession };

type Data = { chats: ChatSession[] };
type CreateInput = { acpSessionId: string; projectId: string | null; title: string | null; profile: string | null };

export class ChatSessionStore {
  private data: Data = { chats: [] };

  constructor(private readonly filePath: string) {
    this.data = this.read();
  }

  private read(): Data {
    const parsed = (readJson(this.filePath) ?? {}) as Partial<Data>;
    const chats = (Array.isArray(parsed.chats) ? parsed.chats : []).map((c) => ({
      ...c,
      title: c.title ?? null,
      projectId: c.projectId ?? null,
      profile: c.profile ?? null,
    }));
    return { chats };
  }

  private write(): void {
    writeJsonAtomic(this.filePath, this.data);
  }

  /** Most-recent first. */
  list(): ChatSession[] {
    return [...this.data.chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): ChatSession | null {
    return this.data.chats.find((c) => c.id === id) ?? null;
  }

  create(input: CreateInput): ChatSession {
    const now = new Date().toISOString();
    const chat: ChatSession = {
      id: randomUUID(),
      acpSessionId: input.acpSessionId,
      title: input.title,
      projectId: input.projectId,
      profile: input.profile,
      createdAt: now,
      updatedAt: now,
    };
    this.data.chats.push(chat);
    this.write();
    return chat;
  }

  update(id: string, patch: Partial<Pick<ChatSession, 'title' | 'projectId'>>): ChatSession | null {
    const chat = this.get(id);
    if (!chat) return null;
    Object.assign(chat, pick(patch, ['title', 'projectId'] as const), { updatedAt: new Date().toISOString() });
    this.write();
    return chat;
  }

  remove(id: string): void {
    this.data.chats = this.data.chats.filter((c) => c.id !== id);
    this.write();
  }
}
