import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import type { AppSnapshot } from "@tyr-ai/contracts";
import { ApiError, api } from "../lib/api";
import type { ActivityLogItem, ReminderUi } from "../app/workspaceTypes";

export const ACTIVITY_PAGE_SIZE = 20;
const COMPACT_ACTIVITY_PAGE_SIZE = 10;

export type ActivityLogResponse = {
  items: ActivityLogItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type AgentActivityTimelineItem = {
  id: string;
  type: "message" | "delegation_received" | "delegation_sent" | "execution" | "approval" | "runtime_event" | "runtime_activity";
  typeLabel: string;
  title: string;
  preview: string;
  at: string;
  source?: string;
  channelId?: string;
  messageId?: string;
  executionId?: string;
  approvalId?: string;
  rootMessageId?: string;
  sourceExecutionId?: string;
  status?: string;
  statusLabel?: string;
  jumpTarget?: {
    type: "message" | "execution";
    channelId?: string;
    messageId?: string;
    executionId?: string;
  };
};

export type AgentActivityTimelineResponse = {
  agentId: string;
  items: AgentActivityTimelineItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

type ReminderApiItem = {
  reminderId?: string;
  id?: string;
  title: string;
  status: string;
  fireAt: string;
  repeat?: string | null;
  fireCount?: number;
};

type AgentHistoryFilter = "all" | "messages" | "delegations" | "executions" | "approvals" | "runtime";

const AGENT_HISTORY_FILTERS: Array<{ value: AgentHistoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "messages", label: "Messages" },
  { value: "delegations", label: "Delegations" },
  { value: "executions", label: "Executions" },
  { value: "approvals", label: "Approvals" },
  { value: "runtime", label: "Runtime" }
];

export function activityTitle(entry: ActivityLogItem["entry"]): string {
  if (entry.kind === "status") {
    if (entry.activity === "thinking") return "Thinking";
    if (entry.activity === "working") return "Working";
    if (entry.activity === "online") return "Idle";
    if (entry.activity === "offline") return "Offline";
    if (entry.activity === "error") return "Error";
    return entry.activity ?? "Status";
  }
  if (entry.kind === "tool_start") return `Running command`;
  if (entry.kind === "text") return "Output";
  return entry.kind.replaceAll("_", " ");
}

export function activityText(entry: ActivityLogItem["entry"]): string {
  return entry.toolInput ?? entry.text ?? entry.detail ?? "";
}

export function activityClass(entry: ActivityLogItem["entry"]): string {
  if (entry.kind === "text") return "cyan";
  if (entry.activity === "online") return "green";
  if (entry.activity === "error") return "red";
  return "yellow";
}

export function ActivityList({ activity, className = "activity-list" }: { activity: ActivityLogItem[]; className?: string }) {
  return (
    <div className={className}>
      {activity.length === 0 && <div className="empty-box">No activity yet.</div>}
      {activity.map((item, index) => (
        <div key={`${item.timestamp}-${index}`} className="activity-log-row">
          <time>{new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
          <span className={`dot ${activityClass(item.entry)}`} />
          <b>{activityTitle(item.entry)}</b>
          <p>{activityText(item.entry)}</p>
        </div>
      ))}
    </div>
  );
}

export function useAgentActivityLog(agentId?: string) {
  const [activity, setActivity] = useState<ActivityLogItem[]>([]);
  useEffect(() => {
    if (!agentId) {
      setActivity([]);
      return;
    }
    let active = true;
    let pollingEnabled = true;
    let warned = false;
    let timer: number | null = null;
    const stopPolling = () => {
      pollingEnabled = false;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const scheduleNextLoad = () => {
      if (!active || !pollingEnabled) return;
      timer = window.setTimeout(() => {
        timer = null;
        void load();
      }, 1500);
    };
    async function load() {
      try {
        const data = await api<ActivityLogResponse | ActivityLogItem[]>(`/api/agents/${agentId}/activity-log?limit=50&offset=0`);
        if (active) setActivity(Array.isArray(data) ? data : data.items);
      } catch (error) {
        if (!active) return;
        // 后台状态刷新不能冒泡成全局 Action failed；权限或身份变化后停止轮询，等待页面快照重载。
        if (
          error instanceof ApiError &&
          (error.code === "stale_auth_context" || [401, 403, 404].includes(error.status))
        ) {
          stopPolling();
          return;
        }
        if (!warned) {
          warned = true;
          console.warn("[web] agent activity refresh failed", error);
        }
      } finally {
        scheduleNextLoad();
      }
    }
    void load();
    return () => {
      active = false;
      stopPolling();
    };
  }, [agentId]);
  return activity;
}

export function PaginatedActivityList({ agentId, variant = "full", pageSize }: { agentId: string; variant?: "full" | "compact"; pageSize?: number }) {
  const [page, setPage] = useState(0);
  const resolvedPageSize = pageSize ?? (variant === "compact" ? COMPACT_ACTIVITY_PAGE_SIZE : ACTIVITY_PAGE_SIZE);
  const [response, setResponse] = useState<ActivityLogResponse>({ items: [], total: 0, limit: resolvedPageSize, offset: 0, hasMore: false });

  useEffect(() => {
    setPage(0);
  }, [agentId]);

  useEffect(() => {
    let active = true;
    async function load() {
      const data = await api<ActivityLogResponse>(`/api/agents/${agentId}/activity-log?limit=${resolvedPageSize}&offset=${page * resolvedPageSize}`);
      if (active) setResponse(data);
    }
    void load();
    if (page !== 0) {
      return () => {
        active = false;
      };
    }
    const timer = window.setInterval(() => void load(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [agentId, page, resolvedPageSize]);

  const firstVisible = response.total === 0 ? 0 : response.offset + 1;
  const lastVisible = response.offset + response.items.length;
  return (
    <div className={`activity-panel ${variant}`}>
      <ActivityList activity={response.items} className={variant === "compact" ? "activity-list activity-page-list inspector-activity-list" : "activity-list activity-page-list"} />
      <div className="activity-pager">
        <span>{response.total === 0 ? "No activity" : `${firstVisible}-${lastVisible} of ${response.total}`}</span>
        <button className="btn small" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
        <button className="btn small" disabled={!response.hasMore} onClick={() => setPage((current) => current + 1)}>Next</button>
      </div>
    </div>
  );
}

function agentTimelineClass(item: AgentActivityTimelineItem): string {
  if (item.type === "message") return "cyan";
  if (item.type === "execution") {
    if (item.status === "failed" || item.status === "cancelled") return "red";
    if (item.status === "completed") return "green";
    return "yellow";
  }
  if (item.type === "approval") return item.status === "approved" ? "green" : item.status === "rejected" ? "red" : "yellow";
  if (item.type === "delegation_received" || item.type === "delegation_sent") return "green";
  if (item.type === "runtime_event") return item.status === "failed" ? "red" : "yellow";
  return "cyan";
}

function agentTimelineTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function agentTimelinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function AgentActivityTimelineList({ items, className = "activity-list", onOpenItem }: { items: AgentActivityTimelineItem[]; className?: string; onOpenItem?: (item: AgentActivityTimelineItem) => void }) {
  return (
    <div className={className}>
      {items.length === 0 && <div className="empty-box">No agent history yet.</div>}
      {items.map((item) => {
        const content = (
          <>
            <span className="agent-timeline-rail">
              <time>{agentTimelineTime(item.at)}</time>
              <span className={`dot ${agentTimelineClass(item)}`} />
            </span>
            <span className="agent-timeline-main">
              <span className="agent-timeline-summary">
                <b className="agent-timeline-title">{item.title}</b>
                <p className="agent-timeline-preview">{agentTimelinePreview(item.preview)}</p>
              </span>
              <span className="agent-timeline-meta">
                <span className="agent-timeline-chip type">{item.typeLabel}</span>
                {item.source && <span className="agent-timeline-chip source">{item.source}</span>}
                {item.statusLabel && <span className="agent-timeline-chip status">{item.statusLabel}</span>}
              </span>
            </span>
          </>
        );
        if (!onOpenItem || !item.jumpTarget) {
          return <div key={item.id} className="activity-log-row agent-timeline-row">{content}</div>;
        }
        return (
          <button
            key={item.id}
            className="activity-log-row agent-timeline-row clickable"
            type="button"
            aria-label={`Open history item: ${item.title}`}
            onClick={() => onOpenItem(item)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

export function PaginatedAgentActivityTimeline({ agentId, variant = "full", pageSize, onOpenItem }: { agentId: string; variant?: "full" | "compact"; pageSize?: number; onOpenItem?: (item: AgentActivityTimelineItem) => void }) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<AgentHistoryFilter>("all");
  const [search, setSearch] = useState("");
  const resolvedPageSize = pageSize ?? (variant === "compact" ? COMPACT_ACTIVITY_PAGE_SIZE : ACTIVITY_PAGE_SIZE);
  const [response, setResponse] = useState<AgentActivityTimelineResponse>({ agentId, items: [], total: 0, limit: resolvedPageSize, offset: 0, hasMore: false });

  useEffect(() => {
    setPage(0);
  }, [agentId, filter, search]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const controller = new AbortController();
    async function load() {
      try {
        const data = await api<AgentActivityTimelineResponse>(`/api/agents/${agentId}/activity-timeline?limit=${resolvedPageSize}&offset=${page * resolvedPageSize}${filter === "all" ? "" : `&type=${encodeURIComponent(filter)}`}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`, {
          signal: controller.signal
        });
        if (active) setResponse(data);
      } catch (error) {
        if (active) console.warn("[web] agent activity timeline refresh failed", error);
      } finally {
        // Schedule from completion so a slow response cannot accumulate overlapping timeline requests.
        if (active && page === 0) timer = window.setTimeout(() => void load(), 1500);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [agentId, page, resolvedPageSize, filter, search]);

  const firstVisible = response.total === 0 ? 0 : response.offset + 1;
  const lastVisible = response.offset + response.items.length;
  return (
    <div className={`activity-panel ${variant}`}>
      <div className="agent-history-toolbar">
        <select
          className="inspector-control"
          aria-label="Filter agent history"
          value={filter}
          onChange={(event) => setFilter(event.target.value as AgentHistoryFilter)}
        >
          {AGENT_HISTORY_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <input
          className="inspector-control"
          type="search"
          aria-label="Search agent history"
          placeholder="Search history"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <AgentActivityTimelineList items={response.items} onOpenItem={onOpenItem} className={variant === "compact" ? "activity-list activity-page-list inspector-activity-list" : "activity-list activity-page-list"} />
      <div className="activity-pager">
        <span>{response.total === 0 ? "No history" : `${firstVisible}-${lastVisible} of ${response.total}`}</span>
        <button className="btn small" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
        <button className="btn small" disabled={!response.hasMore} onClick={() => setPage((current) => current + 1)}>Next</button>
      </div>
    </div>
  );
}

export function ReminderList({ snapshot, agentId, className = "reminders-view" }: { snapshot: AppSnapshot; agentId: string; className?: string }) {
  const [reminders, setReminders] = useState<ReminderUi[]>(
    snapshot.reminders
      .filter((item) => item.ownerAgentId === agentId)
      .map((item) => ({ id: item.id, title: item.title, status: item.status, fireAt: item.fireAt, repeat: item.repeat ?? null, fireCount: item.fireCount ?? 0 }))
  );
  useEffect(() => {
    let active = true;
    async function load() {
      const data = await api<{ reminders: ReminderApiItem[] }>(`/api/reminders?ownerAgentId=${agentId}&status=scheduled`);
      if (active) {
        setReminders(data.reminders.map((item) => ({
          id: item.reminderId ?? item.id ?? item.title,
          title: item.title,
          status: item.status,
          fireAt: item.fireAt,
          repeat: item.repeat ?? null,
          fireCount: item.fireCount ?? 0
        })));
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [agentId, snapshot.reminders]);
  const nextReminder = reminders[0];
  return (
    <div className={className}>
      {reminders.length === 0 && (
        <div className="reminder-empty">
          <Bell size={42} />
          <b>No pending reminders.</b>
          <p>This agent hasn't scheduled anything. Reminders appear here in real time as soon as the agent schedules them.</p>
        </div>
      )}
      {reminders.length > 0 && (
        <>
          <div className="reminder-summary">
            <span>
              <b>Scheduled reminders</b>
              <small>{reminders.length} pending for this agent</small>
            </span>
            {nextReminder && (
              <span className="reminder-next">
                <small>Next reminder</small>
                <b>{new Date(nextReminder.fireAt).toLocaleString()}</b>
              </span>
            )}
          </div>
          <div className="reminder-list">
            {reminders.map((reminder) => (
              <div key={reminder.id} className="activity-item reminder-card">
                <span className="task-tag todo">{reminder.status}</span>
                <p>{reminder.title}</p>
                <div className="reminder-meta">
                  <time>{new Date(reminder.fireAt).toLocaleString()}</time>
                  {reminder.repeat && <span>Repeats {reminder.repeat}</span>}
                  {Number(reminder.fireCount ?? 0) > 0 && <span>Fired {reminder.fireCount} times</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
