import type { MessageDeviceRef } from "@tyr-ai/contracts";
import { composerDeviceRefs, composerPlainText, type ComposerPart } from "./inlineComposerModel";

export function shouldRemoveTrailingDeviceRef(input: {
  key: string;
  content: string;
  caretIndex: number;
  selectionStart?: number;
  selectionEnd?: number;
  deviceRefCount: number;
}): boolean {
  const selectionStart = input.selectionStart ?? input.caretIndex;
  const selectionEnd = input.selectionEnd ?? input.caretIndex;
  return (
    (input.key === "Backspace" || input.key === "Delete") &&
    input.content.length === 0 &&
    input.caretIndex === 0 &&
    selectionStart === selectionEnd &&
    input.deviceRefCount > 0
  );
}

export function chatMessagePayload(input: {
  channelId?: string;
  conversationId?: string;
  content: string;
  attachmentIds: string[];
  quoteMessageId?: string;
  deviceRefs?: MessageDeviceRef[];
}) {
  return {
    channelId: input.channelId,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    content: input.content,
    attachmentIds: input.attachmentIds,
    ...(input.quoteMessageId ? { quoteMessageId: input.quoteMessageId } : {}),
    ...(input.deviceRefs?.length ? { deviceRefs: input.deviceRefs } : {})
  };
}

export function chatMessagePayloadFromComposerParts(input: {
  channelId?: string;
  conversationId?: string;
  parts: ComposerPart[];
  attachmentIds: string[];
  quoteMessageId?: string;
}) {
  return chatMessagePayload({
    channelId: input.channelId,
    conversationId: input.conversationId,
    content: composerPlainText(input.parts),
    attachmentIds: input.attachmentIds,
    quoteMessageId: input.quoteMessageId,
    deviceRefs: composerDeviceRefs(input.parts)
  });
}

export function shouldRemoveInlineTokenBeforeCaret(input: {
  key: string;
  previousPartType: "text" | "device-method" | null;
  selectionCollapsed: boolean;
}): boolean {
  return input.key === "Backspace" && input.selectionCollapsed && input.previousPartType === "device-method";
}
