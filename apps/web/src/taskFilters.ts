import type { ChannelRecord, TaskRecord, TaskStatus } from "@tyr-ai/contracts";
import { channelDisplayLabelFromFields } from "./resourceAccess";

type TaskSummaryChannel = Pick<ChannelRecord, "id" | "type" | "name" | "displayName" | "archivedAt">;

export type TaskFilterState = {
  statusIds: TaskStatus[];
  channelIds: string[];
  creatorIds: string[];
  assigneeIds: string[];
};

export type TaskChannelSummary = {
  id: string;
  label: string;
  kind: "all" | "channel" | "dm";
  total: number;
  open: number;
  done: number;
  unread: number;
  archived: boolean;
};

export function emptyTaskFilters(): TaskFilterState {
  return { statusIds: [], channelIds: [], creatorIds: [], assigneeIds: [] };
}

export function normalizeTaskFilters(filters?: TaskFilterState): TaskFilterState {
  return filters ? {
    statusIds: [...(filters.statusIds ?? [])],
    channelIds: [...(filters.channelIds ?? [])],
    creatorIds: [...(filters.creatorIds ?? [])],
    assigneeIds: [...(filters.assigneeIds ?? [])]
  } : emptyTaskFilters();
}

export function taskFilterCount(filters: TaskFilterState): number {
  return filters.statusIds.length + filters.channelIds.length + filters.creatorIds.length + filters.assigneeIds.length;
}

export function taskMatchesFilters(task: TaskRecord, filters: TaskFilterState): boolean {
  const statusOk = filters.statusIds.length === 0 || filters.statusIds.includes(task.status);
  const channelOk = filters.channelIds.length === 0 || filters.channelIds.includes(task.channelId);
  const creatorOk = filters.creatorIds.length === 0 || filters.creatorIds.includes(task.createdById);
  const assigneeOk = filters.assigneeIds.length === 0 || (task.assigneeAgentId ? filters.assigneeIds.includes(task.assigneeAgentId) : false);
  return statusOk && channelOk && creatorOk && assigneeOk;
}

export function sortTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort(compareRecentTasks);
}

export function toggleFilterValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function uniqueTaskOptions(tasks: TaskRecord[], id: (task: TaskRecord) => string | undefined, label: (task: TaskRecord) => string | undefined): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const task of tasks) {
    const optionId = id(task);
    if (!optionId || seen.has(optionId)) continue;
    seen.set(optionId, label(task) || optionId);
  }
  return [...seen.entries()].map(([optionId, optionLabel]) => ({ id: optionId, label: optionLabel })).sort((a, b) => a.label.localeCompare(b.label));
}

function compareRecentTasks(a: TaskRecord, b: TaskRecord): number {
  return b.taskNumber - a.taskNumber || b.updatedAt.localeCompare(a.updatedAt);
}

export function taskChannelSummaries(channels: TaskSummaryChannel[], tasks: TaskRecord[], unreadCounts: Record<string, number> = {}): { all: TaskChannelSummary; channels: TaskChannelSummary[]; dms: TaskChannelSummary[] } {
  const isDone = (task: TaskRecord) => task.status === "done" || task.status === "closed";
  const countForChannel = (channelId: string) => {
    const channelTasks = tasks.filter((task) => task.channelId === channelId);
    const done = channelTasks.filter(isDone).length;
    // Task 的 unread 实际挂在线程 channel 上，左侧按父 channel 汇总，方便判断哪个任务区需要跟进。
    const unread = channelTasks.reduce((total, task) => total + (task.threadChannelId ? unreadCounts[task.threadChannelId] ?? 0 : 0), 0);
    // 左侧导航只区分仍需处理和已结束任务，便于快速判断哪个 channel 需要跟进。
    return { total: channelTasks.length, open: channelTasks.length - done, done, unread };
  };
  const summarize = (channel: TaskSummaryChannel): TaskChannelSummary => ({
    id: channel.id,
    label: channelDisplayLabelFromFields({ type: channel.type, name: channel.name, displayName: channel.displayName }),
    kind: channel.type === "dm" ? "dm" : "channel",
    archived: Boolean(channel.archivedAt),
    ...countForChannel(channel.id)
  });
  const done = tasks.filter(isDone).length;
  const unread = tasks.reduce((total, task) => total + (task.threadChannelId ? unreadCounts[task.threadChannelId] ?? 0 : 0), 0);
  return {
    all: { id: "", label: "All tasks", kind: "all", total: tasks.length, open: tasks.length - done, done, unread, archived: false },
    channels: channels.filter((channel) => channel.type === "channel").map(summarize),
    dms: channels.filter((channel) => channel.type === "dm").map(summarize)
  };
}
