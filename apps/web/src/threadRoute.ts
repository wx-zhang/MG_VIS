import type { AppSnapshot, MessageThreadContextPayload } from "@tyr-ai/contracts";
import { publicConversationToRecord, publicMessageToRecord } from "./app/workspaceUtils";

export type MessageThreadRouteLoadState = "loading" | "resolved" | "not_found" | "error";

export function shouldLoadMessageThreadContext(input: {
  threadChannelId?: string;
  hasContext: boolean;
}): boolean {
  return Boolean(input.threadChannelId && !input.hasContext);
}

function upsertById<T extends { id: string }>(items: T[], additions: T[], mergeExisting = false): T[] {
  const result = [...items];
  const indexById = new Map(result.map((item, index) => [item.id, index]));
  for (const addition of additions) {
    const index = indexById.get(addition.id);
    if (index === undefined) {
      indexById.set(addition.id, result.length);
      result.push(addition);
    } else {
      result[index] = mergeExisting ? { ...result[index], ...addition } : addition;
    }
  }
  return result;
}

export function messageThreadContextFromPublic(value: unknown): MessageThreadContextPayload {
  const raw = value && typeof value === "object" ? value as Record<string, any> : {};
  if (!raw.channel?.id || raw.channel.type !== "thread" || !raw.parentChannel?.id || raw.parentChannel.type !== "dm" || !raw.parentMessage?.id) {
    throw new Error("invalid_thread_context");
  }
  return {
    channel: {
      ...raw.channel,
      // Older deployments omitted this field from the public channel serializer.
      // The separately authorized parent channel is the canonical fallback.
      parentChannelId: raw.channel.parentChannelId ?? raw.parentChannel.id
    },
    parentChannel: raw.parentChannel,
    parentMessage: publicMessageToRecord(raw.parentMessage),
    conversation: raw.conversation ? publicConversationToRecord(raw.conversation) : null
  };
}

export function mergeMessageThreadContexts(
  snapshot: AppSnapshot,
  contexts: MessageThreadContextPayload[]
): AppSnapshot {
  if (contexts.length === 0) return snapshot;
  return {
    ...snapshot,
    // Thread context is intentionally compact. Preserve richer DM navigation fields
    // already present in the workspace cache when the same channel is hydrated.
    channels: upsertById(snapshot.channels, contexts.flatMap((context) => [context.parentChannel, context.channel]), true),
    messages: upsertById(snapshot.messages, contexts.map((context) => context.parentMessage)),
    conversations: upsertById(snapshot.conversations, contexts.flatMap((context) => context.conversation ? [context.conversation] : []))
  };
}

export function shouldRedirectMissingMessageThread(input: {
  threadChannelId?: string;
  threadResolved: boolean;
  loadState?: MessageThreadRouteLoadState;
}): boolean {
  return Boolean(input.threadChannelId && !input.threadResolved && input.loadState === "not_found");
}
