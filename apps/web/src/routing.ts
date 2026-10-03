export type WorkspaceView = "chat" | "search" | "inbox" | "saved" | "devices" | "topology" | "workspace" | "invitations" | "settings";
export type WorkspaceSettingsTab = "profile" | "security" | "channels" | "notifications" | "developer" | "workspace";
export type WorkspaceUiStyle = "classic";

export const WORKSPACE_UI_STYLE_OPTIONS: Array<{ id: WorkspaceUiStyle; label: string }> = [
  { id: "classic", label: "Classic" }
];

export type WorkspaceRouteState = {
  view: WorkspaceView;
  settingsTab: WorkspaceSettingsTab;
  selectedChannelId?: string;
  selectedAgentId?: string;
  selectedHumanId?: string;
  selectedMachineId?: string;
  selectedServerId?: string;
  selectedDeviceId?: string;
  threadChannelId?: string;
  focusMessageId?: string;
  conversationId?: string;
  approvalId?: string;
  legacyRedirectPath?: string;
};

const SETTINGS_TABS = new Set<WorkspaceSettingsTab>(["profile", "security", "channels", "notifications", "developer", "workspace"]);
const LEGACY_SETTINGS_PATHS: Record<string, WorkspaceSettingsTab> = {
  account: "profile",
  browser: "notifications",
  server: "workspace"
};

function decodeSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function routeStateFromPath(pathname: string, search = ""): WorkspaceRouteState {
  const [root, section, id] = pathname.replace(/^\/+|\/+$/g, "").split("/");
  const params = new URLSearchParams(search);
  const focusMessageId = params.get("message") ?? undefined;
  const conversationId = params.get("conversation") ?? undefined;
  const approvalId = params.get("approval") ?? undefined;

  if (root === "chat") {
    if (section === "search") return { view: "search", settingsTab: "profile" };
    if (section === "inbox") return { view: "inbox", settingsTab: "profile" };
    if (section === "saved") return { view: "saved", settingsTab: "profile" };
    if (section === "channels") {
      // 历史群聊深链统一退回拓扑首页，不再暴露频道是否仍保留在数据库中。
      return { view: "topology", settingsTab: "profile", legacyRedirectPath: "/topology" };
    }
    if (section === "dms") {
      const state: WorkspaceRouteState = { view: "chat", selectedChannelId: decodeSegment(id), settingsTab: "profile" };
      if (focusMessageId) state.focusMessageId = focusMessageId;
      if (approvalId) state.approvalId = approvalId;
      if (conversationId) state.conversationId = conversationId;
      return state;
    }
    if (section === "threads") {
      const state: WorkspaceRouteState = { view: "chat", threadChannelId: decodeSegment(id), settingsTab: "profile" };
      if (focusMessageId) state.focusMessageId = focusMessageId;
      if (approvalId) state.approvalId = approvalId;
      if (conversationId) state.conversationId = conversationId;
      return state;
    }
    return { view: "chat", settingsTab: "profile" };
  }

  if (root === "tasks") {
    // Task workflow 已退出产品面；历史数据只作为普通消息/thread 保留，旧深链统一回到实时 Topology。
    return { view: "topology", settingsTab: "profile", legacyRedirectPath: "/topology" };
  }
  if (root === "workspace") return { view: "workspace", settingsTab: "profile" };
  if (root === "topology") {
    if (section === "workspaces") return { view: "topology", selectedServerId: decodeSegment(id), settingsTab: "profile" };
    if (section === "humans") return { view: "topology", selectedHumanId: decodeSegment(id), settingsTab: "profile" };
    if (section === "agents") return { view: "topology", selectedAgentId: decodeSegment(id), settingsTab: "profile" };
    if (section === "computers") return { view: "topology", selectedMachineId: decodeSegment(id), settingsTab: "profile" };
    if (section === "channels") return { view: "topology", settingsTab: "profile", legacyRedirectPath: "/topology" };
    if (section === "devices") return { view: "topology", selectedDeviceId: decodeSegment(id), settingsTab: "profile" };
    return { view: "topology", settingsTab: "profile" };
  }
  if (root === "members") {
    if (section === "humans") {
      const selectedHumanId = decodeSegment(id);
      return { view: "topology", selectedHumanId, settingsTab: "profile", legacyRedirectPath: selectedHumanId ? `/topology/humans/${encodeURIComponent(selectedHumanId)}` : "/topology" };
    }
    if (section === "agents") {
      const selectedAgentId = decodeSegment(id);
      return { view: "topology", selectedAgentId, settingsTab: "profile", legacyRedirectPath: selectedAgentId ? `/topology/agents/${encodeURIComponent(selectedAgentId)}` : "/topology" };
    }
    return { view: "topology", settingsTab: "profile", legacyRedirectPath: "/topology" };
  }
  if (root === "computers") {
    const selectedMachineId = decodeSegment(section);
    return { view: "topology", selectedMachineId, settingsTab: "profile", legacyRedirectPath: selectedMachineId ? `/topology/computers/${encodeURIComponent(selectedMachineId)}` : "/topology" };
  }
  if (root === "invitations") return { view: "invitations", settingsTab: "profile" };
  if (root === "devices") return { view: "devices", settingsTab: "profile" };
  if (root === "settings") {
    const legacyTab = section ? LEGACY_SETTINGS_PATHS[section] : undefined;
    if (legacyTab) {
      // 旧设置深链保持可用，但统一跳转到按功能域拆分后的稳定路径。
      return { view: "settings", settingsTab: legacyTab, legacyRedirectPath: `/settings/${legacyTab}` };
    }
    const tab = SETTINGS_TABS.has(section as WorkspaceSettingsTab) ? section as WorkspaceSettingsTab : "profile";
    return { view: "settings", settingsTab: tab };
  }

  // Topology 是新版 workspace 的默认入口；未知保护路径回到拓扑总览，避免落到隐藏的 Chat 主菜单。
  return { view: "topology", settingsTab: "profile" };
}

export function uiStyleFromSearch(search = ""): WorkspaceUiStyle {
  return "classic";
}

export function pathWithUiStyle(path: string, style: WorkspaceUiStyle): string {
  const [pathname, rawSearch = ""] = path.split("?");
  const params = new URLSearchParams(rawSearch);
  if (style === "classic") params.delete("ui");
  else params.set("ui", style);
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

function chatMessageSearch(messageId?: string, conversationId?: string, approvalId?: string): string {
  const params: string[] = [];
  if (messageId) params.push(`message=${encodeURIComponent(messageId)}`);
  if (conversationId) params.push(`conversation=${encodeURIComponent(conversationId)}`);
  if (approvalId) params.push(`approval=${encodeURIComponent(approvalId)}`);
  return params.length ? `?${params.join("&")}` : "";
}

export function chatPathForChannel(channel: { id: string; type?: string }, messageId?: string, conversationId?: string, approvalId?: string): string {
  const segment = channel.type === "thread" ? "threads" : channel.type === "dm" ? "dms" : "channels";
  const search = chatMessageSearch(messageId, channel.type === "dm" || channel.type === "thread" ? conversationId : undefined, approvalId);
  return `/chat/${segment}/${encodeURIComponent(channel.id)}${search}`;
}
