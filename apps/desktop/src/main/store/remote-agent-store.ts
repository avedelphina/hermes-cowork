// apps/desktop/src/main/store/remote-agent-store.ts
//
// Remote agents: a named Hermes profile on another machine, reached over SSH.
// Deliberately separate from Projects — a project is a local folder to work in;
// a remote agent is someone to talk to. Chat uses them; Cowork stays local.
// Stored as plain JSON under userData, like the other stores.

import { readJson, writeJsonAtomic, pick } from './json-file';
import { randomUUID } from 'node:crypto';
import type { RemoteAgent, RemoteOrigin } from '../../shared/types';

type Data = { agents: RemoteAgent[] };
type CreateInput = Omit<RemoteAgent, 'id' | 'createdAt'>;
type UpdatePatch = Partial<CreateInput>;

/** Fields that describe how to reach and launch the agent (everything but name/profile). */
const ORIGIN_KEYS = ['sshTarget', 'hermesHome', 'binaryPath', 'port', 'identityFile', 'proxyJump', 'runAs', 'container', 'command'] as const;

/** The connection part of an agent — what the ACP spawn needs. */
export function toOrigin(a: RemoteAgent): RemoteOrigin {
  return {
    sshTarget: a.sshTarget, hermesHome: a.hermesHome, binaryPath: a.binaryPath, port: a.port,
    identityFile: a.identityFile, proxyJump: a.proxyJump, runAs: a.runAs, container: a.container, command: a.command,
  };
}

export class RemoteAgentStore {
  private data: Data = { agents: [] };

  constructor(private readonly filePath: string) {
    const parsed = (readJson(filePath) ?? {}) as Partial<Data>;
    // Older records predate the launch options — fill them in as "not set".
    this.data = {
      agents: (Array.isArray(parsed.agents) ? parsed.agents : []).map((a) => ({
        ...a,
        port: a.port ?? null, identityFile: a.identityFile ?? null, proxyJump: a.proxyJump ?? null,
        runAs: a.runAs ?? null, container: a.container ?? null, command: a.command ?? null,
      })),
    };
  }

  private write(): void {
    writeJsonAtomic(this.filePath, this.data);
  }

  list(): RemoteAgent[] {
    return [...this.data.agents];
  }

  get(id: string): RemoteAgent | null {
    return this.data.agents.find((a) => a.id === id) ?? null;
  }

  create(input: CreateInput): RemoteAgent {
    const agent: RemoteAgent = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.data.agents.push(agent);
    this.write();
    return agent;
  }

  update(id: string, patch: UpdatePatch): RemoteAgent | null {
    const agent = this.get(id);
    if (!agent) return null;
    Object.assign(agent, pick(patch, ['name', 'profile', ...ORIGIN_KEYS] as const));
    this.write();
    return agent;
  }

  remove(id: string): void {
    this.data.agents = this.data.agents.filter((a) => a.id !== id);
    this.write();
  }
}
