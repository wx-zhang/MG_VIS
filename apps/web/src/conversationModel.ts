import type { ConversationRecord } from '@tyr-ai/contracts';

export type ConversationViewMode = 'active' | 'history';
export type ConversationMenuView = 'active' | 'archived';
export type ConversationTitleUpdate = {
  channelId: string;
  conversationId: string;
  title: string;
};

export type ConversationRenameValidation = {
  title: string;
  error: 'required' | 'too_long' | null;
};

export type CurrentConversationSyncAction = 'none' | 'follow' | 'wait_for_draft' | 'notify';

export const CONVERSATION_TITLE_MAX_LENGTH = 72;

export function currentConversationSyncAction(input: {
  previousActiveId?: string;
  nextActiveId: string;
  selectedId?: string;
  hasDraft: boolean;
}): CurrentConversationSyncAction {
  if (!input.previousActiveId || input.previousActiveId === input.nextActiveId || input.selectedId === input.nextActiveId) return 'none';
  // 用户主动查看历史会话时只提示新 current，不能强制跳走。
  if ((input.selectedId ?? input.previousActiveId) !== input.previousActiveId) return 'notify';
  // 仍跟随旧 current 时允许自动同步，但必须先保护尚未发送的草稿。
  return input.hasDraft ? 'wait_for_draft' : 'follow';
}

export function currentConversationForChannel(
  conversations: ConversationRecord[],
  channelId: string | undefined,
  activeConversationId?: string
): ConversationRecord | undefined {
  if (!channelId) return undefined;
  const selected = activeConversationId
    ? conversations.find((conversation) => conversation.channelId === channelId && conversation.id === activeConversationId && conversation.status === 'active')
    : undefined;
  if (selected) return selected;
  return conversations.find((conversation) => (
    conversation.channelId === channelId &&
    conversation.status === 'active'
  ));
}

export function conversationsForMenuView<T extends ConversationRecord>(conversations: T[], view: ConversationMenuView): T[] {
  return view === 'archived'
    ? conversations.filter((conversation) => Boolean(conversation.archivedAt))
    : conversations.filter((conversation) => !conversation.archivedAt);
}

export function conversationListVisibility(view: ConversationMenuView, routeConversationId: string | undefined): {
  includeArchived: boolean;
} {
  // 显式 conversation 深链可能指向归档记录，首次加载必须包含归档会话才能恢复正确上下文。
  return { includeArchived: view === 'archived' || Boolean(routeConversationId) };
}

export function canArchiveConversation(conversation: ConversationRecord | undefined): boolean {
  return Boolean(conversation && !conversation.archivedAt);
}

export function canPermanentlyDeleteConversation(conversation: ConversationRecord | undefined): boolean {
  return Boolean(conversation?.archivedAt && conversation.status !== 'active');
}

export function validateConversationRename(value: string): ConversationRenameValidation {
  const title = value.trim();
  if (!title) return { title: '', error: 'required' };
  if (Array.from(title).length > CONVERSATION_TITLE_MAX_LENGTH) return { title, error: 'too_long' };
  return { title, error: null };
}

export function conversationTitleUpdateFromMessageResponse(response: unknown): ConversationTitleUpdate | null {
  if (!response || typeof response !== 'object') return null;
  const message = response as Record<string, unknown>;
  const channelId = typeof message.channelId === 'string' ? message.channelId.trim() : '';
  const conversationId = typeof message.conversationId === 'string' ? message.conversationId.trim() : '';
  const title = typeof message.conversationTitle === 'string' ? message.conversationTitle.trim() : '';
  // 消息写入后以服务端生成的标题为准，避免前端自行复制命名规则造成漂移。
  return channelId && conversationId && title ? { channelId, conversationId, title } : null;
}

export function conversationViewMode(conversation: ConversationRecord | undefined): ConversationViewMode {
  // 只有 active conversation 可继续发送；历史与归档会话都保持只读。
  return conversation?.status === 'closed' || Boolean(conversation?.archivedAt)
    ? 'history'
    : 'active';
}
