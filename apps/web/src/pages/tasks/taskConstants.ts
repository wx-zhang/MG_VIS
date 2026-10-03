import type { TaskRecord } from '@tyr-ai/contracts';

export const TASK_STATUSES: Array<[TaskRecord['status'], string]> = [
  ['todo', 'TODO'],
  ['in_progress', 'IN PROGRESS'],
  ['in_review', 'IN REVIEW'],
  ['done', 'DONE'],
  ['closed', 'CLOSED']
];
