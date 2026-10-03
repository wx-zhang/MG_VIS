import type { WorkspaceRouteState } from "../routing";

export const WORKSPACE_PAGE_LIMIT = 50;

export type WorkspaceDataRequirements = {
  devices: boolean;
};

export type WorkspacePageDataLoaded = {
  serverId: string | null;
  devices: boolean;
  deviceQueryKey: string;
};

export type WorkspacePageDataError = {
  devices: string;
};

export type WorkspaceNavigationLoadStatus = "idle" | "loading" | "ready" | "error";

export type WorkspaceNavigationLoadState = {
  serverId: string | null;
  status: WorkspaceNavigationLoadStatus;
};

export const emptyWorkspacePageDataLoaded: WorkspacePageDataLoaded = {
  serverId: null,
  devices: false,
  deviceQueryKey: ""
};

export const emptyWorkspacePageDataError: WorkspacePageDataError = { devices: "" };

export const emptyWorkspaceNavigationLoadState: WorkspaceNavigationLoadState = {
  serverId: null,
  status: "idle"
};

export function workspaceNavigationStatusForServer(state: WorkspaceNavigationLoadState, serverId: string | null): Exclude<WorkspaceNavigationLoadStatus, "idle"> {
  // 没有与当前 Server 匹配的完整导航数据时，不能把空数组解释成真实空拓扑。
  if (!serverId || state.serverId !== serverId || state.status === "idle") return "loading";
  return state.status;
}

export function workspaceDataRequirements(routeState: WorkspaceRouteState): WorkspaceDataRequirements {
  // 分页列表不进入 bootstrap，仅由真正展示 Device 的页面按需拉取。
  return {
    devices: routeState.view === "devices" || routeState.view === "topology" || routeState.view === "workspace" || routeState.view === "chat"
  };
}

export function workspaceDevicePagePath(options: { cursor?: string | null } = {}): string {
  const params = new URLSearchParams();
  params.set("limit", String(WORKSPACE_PAGE_LIMIT));
  if (options.cursor) params.append("cursor", options.cursor);
  return `/api/devices?${params.toString()}`;
}

export function workspaceDeviceQueryKey(): string {
  return workspaceDevicePagePath();
}

export function mergeWorkspacePageItems<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
