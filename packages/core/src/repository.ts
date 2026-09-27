import type { TaskWorkflowSnapshot } from './types';

export interface TaskWorkflowRepository {
  read(): TaskWorkflowSnapshot;
  write(snapshot: TaskWorkflowSnapshot): void;
}

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  uuid(): string;
}
