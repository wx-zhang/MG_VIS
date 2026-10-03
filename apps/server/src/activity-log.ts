type ActivityStore = {
  listActivity(agentId: string): Array<{ at: string; kind: string; text: string }>;
};

export type ActivityLogItem = {
  timestamp: number;
  entry: {
    kind: string;
    activity?: string;
    detail?: string;
    text?: string;
  };
};

export type ActivityLogResponse = {
  items: ActivityLogItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export function formatActivityLogResponse(store: ActivityStore, agentId: string, input: { limit?: number; offset?: number } = {}): ActivityLogResponse {
  const limit = clampInteger(input.limit ?? 50, 1, 200);
  const offset = Math.max(0, Math.trunc(Number.isFinite(input.offset) ? input.offset! : 0));
  const activity = store.listActivity(agentId);
  const page = activity.slice(offset, offset + limit);
  return {
    items: page.map(formatActivityLogItem),
    total: activity.length,
    limit,
    offset,
    hasMore: offset + limit < activity.length
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function formatActivityLogItem(item: { at: string; kind: string; text: string }): ActivityLogItem {
  const timestamp = new Date(item.at).getTime();
  if (item.kind === "thinking" || item.kind === "working" || item.kind === "online" || item.kind === "offline" || item.kind === "error") {
    return { timestamp, entry: { kind: "status", activity: item.kind, detail: item.text } };
  }
  if (item.kind === "session") return { timestamp, entry: { kind: "text", text: item.text } };
  return { timestamp, entry: { kind: item.kind, text: item.text } };
}
