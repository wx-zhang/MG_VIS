import type { AppSnapshot, TaskRecord } from '@tyr-ai/contracts';
import { channelDisplayLabel, channelDisplayLabelFromFields } from '../../resourceAccess';
import { TASK_STATUSES } from './taskConstants';

export function taskStatusTitle(status: TaskRecord['status']): string {
  return TASK_STATUSES.find(([value]) => value === status)?.[1] ?? status.toUpperCase();
}

export function taskStatusMenuLabel(status: TaskRecord['status']): string {
  return status.split('_').map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

export function taskChannelLabel(snapshot: AppSnapshot, task: TaskRecord): string {
  const channel = snapshot.channels.find((item) => item.id === task.channelId);
  if (channel) return channelDisplayLabel(channel, snapshot.agents);
  return channelDisplayLabelFromFields({ type: task.channelType ?? "channel", name: task.channelName ?? "all", displayName: task.channelDisplayName });
}
