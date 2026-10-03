import { submitMessage } from '../../lib/messageSubmission';
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Mail, X } from 'lucide-react';
import { type AppSnapshot, type ChannelRecord, type MessageReactionEmoji, type MessageRecord } from '@tyr-ai/contracts';
import { api } from '../../lib/api';
import { canSendThreadReply, threadReplyPayload } from '../../threadComposer';
import { canDeleteMessageForViewer, messageActionItems, messageDeleteConfirmationContentForMessage, messageDeletePath, messageExecutionCancelPath, messageSupportsReactions, messageUnreadPath, type MessageActionId } from '../../messageActions';
import { copyMessageText, avatarSeed, messageWithOptimisticReaction, toggleMessageReaction } from '../../app/workspaceUtils';
import { useComposerAttachments } from '../../composerAttachments';
import { confirmDialog } from '../../shared/confirmDialog';
import { AttachmentChips, MessageActionsMenu, MessageItem, MessageQuoteCard, MessageReactions, quoteSummaryFromMessage } from '../../shared/messages';
import { ThreadReplyComposer } from '../../shared/ThreadReplyComposer';
import { messageThreadParentChannelLabel } from './threadLabels';
import { formatMessageTimestamp } from '../../shared/messageTime';
import { chatMessageExecutionSummary } from './chatUtils';
import { isCommunicationAgentDmChannel } from '../../resourceAccess';
import { MessageExecutionPanel } from './MessageExecutionPanel';

export function MessageThreadPanel({ snapshot, thread, parentMessage, focusMessageId, onClose, onRefresh, onViewInChannel, onOpenThread, onViewMessageInChannel, onPreviewAttachment, onMessageUpdated, onBeginResize }: { snapshot: AppSnapshot; thread: ChannelRecord; parentMessage: MessageRecord; focusMessageId?: string; onClose: () => void; onRefresh: () => Promise<void>; onViewInChannel: () => void; onOpenThread?: (threadChannelId: string, conversationId?: string) => void; onViewMessageInChannel: (channelId: string, messageId: string, conversationId?: string) => void; onPreviewAttachment: (attachmentId: string) => void; onMessageUpdated: (message: MessageRecord) => void; onBeginResize?: (event: ReactPointerEvent<HTMLDivElement>) => void }) {
  const [content, setContent] = useState("");
  const [quoteTarget, setQuoteTarget] = useState<MessageRecord | null>(null);
  const [executionDetailMessageId, setExecutionDetailMessageId] = useState<string | null>(null);
  const attachments = useComposerAttachments(thread.id);
  const threadUnreadCount = snapshot.unreadCounts?.[thread.id] ?? 0;
  const threadBodyRef = useRef<HTMLDivElement>(null);
  const replies = snapshot.messages.filter((message) => message.channelId === thread.id);
  const executionDetailMessage = executionDetailMessageId
    ? replies.find((message) => message.id === executionDetailMessageId) ?? null
    : null;
  const savedSet = useMemo(() => new Set(snapshot.savedMessageIds ?? []), [snapshot.savedMessageIds]);
  const parentExecutionSummary = chatMessageExecutionSummary(snapshot, parentMessage.id);
  const parentSupportsReactions = messageSupportsReactions(parentMessage);
  const parentChannel = snapshot.channels.find((channel) => channel.id === parentMessage.channelId);
  const parentConversation = parentMessage.conversationId
    ? snapshot.conversations.find((conversation) => conversation.id === parentMessage.conversationId)
    : undefined;
  const assistantDmThread = isCommunicationAgentDmChannel(parentChannel, snapshot.agents);
  const archived = Boolean(parentChannel?.archivedAt);
  const conversationReadOnly = parentConversation?.status === "closed" || Boolean(parentConversation?.archivedAt);
  const readOnly = archived || conversationReadOnly;
  const parentDeleted = Boolean(parentMessage.deletedAt);
  const parentLabel = parentMessage.senderType === "human"
    ? snapshot.humans.find((human) => human.id === parentMessage.senderId)?.displayName ?? parentMessage.senderName
    : parentMessage.senderName;
  const parentChannelLabel = messageThreadParentChannelLabel(snapshot, parentMessage);
  useEffect(() => {
    setQuoteTarget(null);
  }, [thread.id]);
  useEffect(() => {
    if (!focusMessageId) return;
    window.requestAnimationFrame(() => {
      threadBodyRef.current?.querySelector(`[data-message-id="${focusMessageId}"]`)?.scrollIntoView({ block: "center" });
    });
  }, [focusMessageId, replies.length, thread.id]);
  async function sendReply() {
    if (assistantDmThread || !canSendThreadReply(content, attachments.attachmentIds, readOnly, thread.id) || attachments.blocked) return;
    await submitMessage(snapshot.currentUser.id, threadReplyPayload(thread.id, content, attachments.attachmentIds, quoteTarget?.id));
    setContent("");
    setQuoteTarget(null);
    attachments.resetAttachments();
    await onRefresh();
  }
  async function toggleReaction(message: MessageRecord, emoji: MessageReactionEmoji) {
    onMessageUpdated(messageWithOptimisticReaction(message, emoji, {
      id: snapshot.currentUser.id,
      name: snapshot.currentUser.displayName || snapshot.currentUser.name
    }));
    try {
      const result = await toggleMessageReaction(message.id, emoji);
      onMessageUpdated(result.message);
    } catch (error) {
      onMessageUpdated(message);
      throw error;
    }
  }
  async function toggleSavedMessage(message: MessageRecord) {
    const saved = savedSet.has(message.id);
    await api(`/api/messages/${message.id}/save`, { method: saved ? "DELETE" : "POST", body: "{}" });
    await onRefresh();
  }
  async function markMessageUnreadAction(message: MessageRecord) {
    await api(messageUnreadPath(message.id), { method: "POST", body: "{}" });
    await onRefresh();
  }
  async function stopMessageExecution(message: MessageRecord) {
    // 取消执行由服务端裁决；前端只按消息 id 请求，不尝试推断具体 runtime 进程。
    await api(messageExecutionCancelPath(message.id), { method: "POST", body: "{}" });
    await onRefresh();
  }
  async function deleteMessage(message: MessageRecord) {
    const summary = chatMessageExecutionSummary(snapshot, message.id);
    const confirmation = messageDeleteConfirmationContentForMessage(snapshot, message, summary);
    if (!(await confirmDialog({
      ...confirmation,
      confirmText: "Delete message",
      tone: "danger"
    }))) return;
    // 删除接口会先取消 active execution，再把消息软删除成 tombstone。
    await api(messageDeletePath(message.id), { method: "DELETE" });
    await onRefresh();
  }
  async function markThreadReadAction() {
    await api(`/api/channels/${encodeURIComponent(thread.id)}/read`, { method: "POST", body: "{}" });
    await onRefresh();
  }
  const parentActionItems = messageActionItems({
    canReplyInThread: false,
    canQuote: !assistantDmThread && !parentDeleted && parentMessage.senderType !== "system",
    canCopy: !parentDeleted,
    canSave: !parentDeleted,
    saved: savedSet.has(parentMessage.id),
    canMarkUnread: !parentDeleted && parentMessage.senderType !== "system",
    canStopExecution: !parentDeleted && Boolean(parentExecutionSummary && parentExecutionSummary.status !== "completed" && parentExecutionSummary.status !== "failed" && parentExecutionSummary.status !== "partial"),
    canDelete: canDeleteMessageForViewer(snapshot, parentMessage)
  });
  function runParentAction(action: MessageActionId) {
    if (action === "quote") setQuoteTarget(parentMessage);
    else if (action === "copy") void copyMessageText(parentMessage.content);
    else if (action === "save") void toggleSavedMessage(parentMessage);
    else if (action === "mark-unread") void markMessageUnreadAction(parentMessage);
    else if (action === "stop-execution") void stopMessageExecution(parentMessage);
    else if (action === "delete-message") void deleteMessage(parentMessage);
  }
  return (
    <>
    {/* Thread 保持挂载，返回 Execution 后可以恢复草稿、附件与滚动位置。 */}
    <aside className="thread-panel" hidden={Boolean(executionDetailMessage)}>
      {onBeginResize && <div className="thread-panel-resizer" onPointerDown={onBeginResize} aria-hidden="true" />}
      <div className="thread-head no-tabs">
        <h2>Thread <span>- {parentChannelLabel}</span></h2>
        {threadUnreadCount > 0 && (
          <button className="btn small" onClick={() => void markThreadReadAction()}><Mail size={15} /> Mark read</button>
        )}
        <button className="btn small" onClick={onViewInChannel}><ExternalLink size={15} /> View conversation</button>
        <button className="icon-btn" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="thread-body" ref={threadBodyRef}>
        <div className={[focusMessageId === parentMessage.id ? "thread-parent focused" : "thread-parent", parentDeleted ? "deleted" : ""].filter(Boolean).join(" ")} data-message-id={parentMessage.id}>
          <span className={`avatar ${parentMessage.senderType === "agent" ? "agent" : parentMessage.senderType === "system" ? "system" : "human"}`}>
            {parentMessage.senderType === "system" ? "S" : avatarSeed(parentLabel)}
          </span>
          <div className="thread-parent-content">
            <div className="thread-parent-head">
              <div className="message-meta"><b>{parentLabel}</b><small>{parentMessage.senderType}</small><time>{formatMessageTimestamp(parentMessage.createdAt)}</time></div>
              {!parentDeleted && (
              <div className="thread-parent-tools">
                <MessageActionsMenu
                  items={parentActionItems}
                  saved={savedSet.has(parentMessage.id)}
                  onToggleReaction={parentSupportsReactions ? (emoji) => toggleReaction(parentMessage, emoji) : undefined}
                  onAction={runParentAction}
                />
              </div>
              )}
            </div>
            {parentDeleted ? (
              <p className="message-tombstone">Message deleted</p>
            ) : (
              <>
                {parentMessage.quote && <MessageQuoteCard quote={parentMessage.quote} onOpen={() => onViewMessageInChannel(parentMessage.quote!.channelId, parentMessage.quote!.messageId)} />}
                <p>{parentMessage.content}</p>
                <AttachmentChips attachments={parentMessage.attachments} onPreviewAttachment={onPreviewAttachment} />
                {parentSupportsReactions && <MessageReactions message={parentMessage} currentUserId={snapshot.currentUser.id} onToggleReaction={(emoji) => toggleReaction(parentMessage, emoji)} />}
              </>
            )}
          </div>
        </div>
        <div className="reply-divider">
          <span>Beginning of replies</span>
          <span>{replies.length} {replies.length === 1 ? "reply" : "replies"}</span>
        </div>
        {replies.map((message) => {
          const executionSummary = chatMessageExecutionSummary(snapshot, message.id);
          return (
            <MessageItem key={message.id} snapshot={snapshot} message={message} focused={message.id === focusMessageId} saved={savedSet.has(message.id)} executionSummary={executionSummary} onOpenExecution={() => setExecutionDetailMessageId(message.id)} onToggleSaved={() => void toggleSavedMessage(message)} onPreviewAttachment={onPreviewAttachment} onToggleReaction={(emoji) => toggleReaction(message, emoji)} onQuoteMessage={assistantDmThread ? undefined : () => setQuoteTarget(message)} onCopyMessage={() => copyMessageText(message.content)} onMarkUnread={() => void markMessageUnreadAction(message)} onOpenQuote={(quote) => onViewMessageInChannel(quote.channelId, quote.messageId)} onStopExecution={() => void stopMessageExecution(message)} onDeleteMessage={() => void deleteMessage(message)} />
          );
        })}
      </div>
      {!assistantDmThread && (
        <ThreadReplyComposer
          archived={readOnly}
          disabled={readOnly}
          readOnlyMessage={conversationReadOnly && !archived ? "Viewing conversation history. Return to the current conversation before replying in thread." : undefined}
          content={content}
          attachments={attachments}
          quoteCard={quoteTarget ? <MessageQuoteCard quote={quoteSummaryFromMessage(quoteTarget)} onOpen={() => onViewMessageInChannel(quoteTarget.channelId, quoteTarget.id)} onClear={() => setQuoteTarget(null)} /> : null}
          canSend={canSendThreadReply(content, attachments.attachmentIds, readOnly, thread.id) && !attachments.blocked}
          onContentChange={setContent}
          onSend={sendReply}
        />
      )}
    </aside>
    {executionDetailMessage && (
      <MessageExecutionPanel
        snapshot={snapshot}
        message={executionDetailMessage}
        onClose={() => setExecutionDetailMessageId(null)}
        closeLabel="Back to thread"
        onRefresh={onRefresh}
        onOpenThread={onOpenThread ? (threadChannelId) => onOpenThread(threadChannelId, parentMessage.conversationId) : undefined}
        onViewMessageInChannel={onViewMessageInChannel}
        onBeginResize={onBeginResize}
      />
    )}
    </>
  );
}
