export function threadReplyPayload(threadChannelId: string, content: string, attachmentIds: string[], quoteMessageId?: string) {
  return {
    channelId: threadChannelId,
    content: content.trim(),
    attachmentIds,
    ...(quoteMessageId ? { quoteMessageId } : {})
  };
}

export function canSendThreadReply(content: string, attachmentIds: string[], archived: boolean, threadChannelId?: string): boolean {
  if (!threadChannelId || archived) return false;
  return Boolean(content.trim());
}
