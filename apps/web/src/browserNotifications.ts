import type { AppSnapshot, ChannelRecord, MessageRecord } from "@tyr-ai/contracts";
import { channelDisplayLabel } from "./resourceAccess";

export type BrowserNotificationSettings = {
  enabled: boolean;
};

export type BrowserNotificationCapability = {
  supported: boolean;
  secureContext: boolean;
  permission: NotificationPermission | "unsupported";
};

export type BrowserNotificationStatus = {
  label: "ENABLED" | "DISABLED" | "BLOCKED" | "ASK REQUIRED" | "UNSUPPORTED";
  active: boolean;
  canEnable: boolean;
  canRequest: boolean;
  canSendTest: boolean;
  reason: string;
};

export type BrowserNotificationPayload = {
  title: string;
  body: string;
  tag: string;
};

export type BrowserNotificationViewState = {
  activeChannelId?: string;
  documentVisible: boolean;
  windowFocused: boolean;
};

export const BROWSER_NOTIFICATION_STORAGE_KEY = "tyr-browser-notifications";

export function defaultBrowserNotificationSettings(): BrowserNotificationSettings {
  return { enabled: false };
}

export function normalizeBrowserNotificationSettings(raw: unknown): BrowserNotificationSettings {
  if (!raw || typeof raw !== "object") return defaultBrowserNotificationSettings();
  const value = raw as Partial<BrowserNotificationSettings>;
  return {
    // Legacy mutedServerIds was a browser-local per-server toggle; it is intentionally ignored now.
    enabled: value.enabled === true
  };
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function loadBrowserNotificationSettings(storage: Pick<Storage, "getItem"> | null = browserStorage()): BrowserNotificationSettings {
  if (!storage) return defaultBrowserNotificationSettings();
  try {
    return normalizeBrowserNotificationSettings(JSON.parse(storage.getItem(BROWSER_NOTIFICATION_STORAGE_KEY) ?? "null"));
  } catch {
    return defaultBrowserNotificationSettings();
  }
}

export function saveBrowserNotificationSettings(settings: BrowserNotificationSettings, storage: Pick<Storage, "setItem"> | null = browserStorage()): BrowserNotificationSettings {
  const normalized = normalizeBrowserNotificationSettings(settings);
  try {
    storage?.setItem(BROWSER_NOTIFICATION_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // localStorage 可能被浏览器策略禁用；内存态仍用于当前页面交互，避免设置页直接崩溃。
  }
  return normalized;
}

export function browserNotificationCapability(
  notificationApi: typeof Notification | undefined = typeof Notification === "undefined" ? undefined : Notification,
  secureContext: boolean = typeof window === "undefined" ? true : window.isSecureContext
): BrowserNotificationCapability {
  // 浏览器通知只能运行在安全上下文；局域网 HTTP 不能误报成用户手动阻止权限。
  if (!secureContext) return { supported: false, secureContext: false, permission: "unsupported" };
  if (!notificationApi) return { supported: false, secureContext: true, permission: "unsupported" };
  return { supported: true, secureContext: true, permission: notificationApi.permission };
}

export function browserNotificationStatus(settings: BrowserNotificationSettings, capability: BrowserNotificationCapability): BrowserNotificationStatus {
  if (!capability.secureContext) {
    return { label: "UNSUPPORTED", active: false, canEnable: false, canRequest: false, canSendTest: false, reason: "Browser notifications require HTTPS or localhost." };
  }
  if (!capability.supported || capability.permission === "unsupported") {
    return { label: "UNSUPPORTED", active: false, canEnable: false, canRequest: false, canSendTest: false, reason: "This browser does not support notifications." };
  }
  if (capability.permission === "denied") {
    return { label: "BLOCKED", active: false, canEnable: false, canRequest: false, canSendTest: false, reason: "Notifications are blocked in browser site settings." };
  }
  if (!settings.enabled) {
    return { label: "DISABLED", active: false, canEnable: true, canRequest: capability.permission === "default", canSendTest: false, reason: "Browser notifications are disabled for this browser." };
  }
  if (capability.permission === "default") {
    return { label: "ASK REQUIRED", active: false, canEnable: true, canRequest: true, canSendTest: false, reason: "Browser permission is required before notifications can be delivered." };
  }
  return { label: "ENABLED", active: true, canEnable: false, canRequest: false, canSendTest: true, reason: "DMs, direct mentions, DM thread replies, and Reminder DMs can notify this browser while TYR is open." };
}

function channelForMessage(snapshot: Pick<AppSnapshot, "channels">, message: MessageRecord): ChannelRecord | undefined {
  return snapshot.channels.find((channel) => channel.id === message.channelId);
}

function parentChannel(snapshot: Pick<AppSnapshot, "channels">, channel: ChannelRecord | undefined): ChannelRecord | undefined {
  return channel?.parentChannelId ? snapshot.channels.find((item) => item.id === channel.parentChannelId) : undefined;
}

function channelLabel(channel: ChannelRecord | undefined): string {
  if (!channel) return "channel";
  return channelDisplayLabel(channel);
}

function directMentioned(snapshot: Pick<AppSnapshot, "currentUser">, content: string): boolean {
  const normalizedContent = content.toLowerCase();
  const candidates = [snapshot.currentUser.name, snapshot.currentUser.displayName]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return candidates.some((name) => normalizedContent.includes(`@${name}`));
}

function previewBody(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function reminderBody(content: string): string | null {
  const prefix = "Reminder fired:";
  if (!content.startsWith(prefix)) return null;
  const body = content.slice(prefix.length).trim();
  return body || "Reminder fired.";
}

function isSystemReminderMessage(message: MessageRecord): boolean {
  // Server-side reminders are delivered as system DMs, so they need a distinct browser notification label.
  return message.senderType === "system" && message.senderId === "system" && reminderBody(message.content) !== null;
}

export function browserNotificationForMessage(
  snapshot: Pick<AppSnapshot, "currentUser" | "currentServer" | "channels">,
  message: MessageRecord,
  viewState?: BrowserNotificationViewState
): BrowserNotificationPayload | null {
  if (message.senderType === "human" && message.senderId === snapshot.currentUser.id) return null;
  const channel = channelForMessage(snapshot, message);
  const parent = parentChannel(snapshot, channel);
  const body = previewBody(message.content);
  const reminderMessage = isSystemReminderMessage(message);
  // 用户正在查看同一个 DM/thread 时由页面本身承接普通消息；定时 Reminder 仍保持提醒语义。
  if (!reminderMessage && viewState?.documentVisible && viewState.windowFocused && viewState.activeChannelId === message.channelId) return null;
  if (channel?.type === "dm") {
    if (reminderMessage) {
      return { title: "Reminder from TYR", body: reminderBody(message.content) ?? body, tag: `tyr-reminder-${message.id}` };
    }
    return { title: `DM from ${message.senderName}`, body, tag: `tyr-dm-${channel.id}` };
  }
  if (channel?.type !== "thread" || parent?.type !== "dm") return null;
  if (directMentioned(snapshot, message.content)) {
    return { title: `Mention in ${channelLabel(parent)}`, body, tag: `tyr-mention-${message.id}` };
  }
  return { title: `Thread reply in ${channelLabel(parent)}`, body, tag: `tyr-thread-${channel.id}` };
}

export function sendBrowserNotification(payload: BrowserNotificationPayload, notificationApi: typeof Notification | undefined = typeof Notification === "undefined" ? undefined : Notification): boolean {
  if (!notificationApi || notificationApi.permission !== "granted") return false;
  // Notification API 是浏览器原生权限面；这里不落服务端，避免把本地浏览器开关误当成全局账号配置。
  try {
    new notificationApi(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/favicon.ico"
    });
    return true;
  } catch {
    // 系统通知失败不能中断 WebSocket 消息处理或影响聊天内容落到页面。
    return false;
  }
}
