import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSnapshot, ChannelRecord, DeviceCapabilityDescriptor, DeviceRecord, MessageRecord } from '@tyr-ai/contracts';
import { submitMessage } from '../../lib/messageSubmission';
import { activeMentionToken } from '../../app/workspaceUtils';
import type { MentionCandidate } from '../../app/workspaceTypes';
import { useComposerAttachments } from '../../composerAttachments';
import { chatMessagePayloadFromComposerParts, shouldRemoveInlineTokenBeforeCaret } from './deviceComposer';
import { activeSlashToken, chatDeviceMethodOptions, chatDeviceOptions, chatMentionCandidates, chatMentionMembers, chatSlashActions, type ChatSlashAction } from './chatUtils';
import { focusAfterToken, type SlashAnchor, tokenIdBeforeCaret } from './InlineComposerEditor';
import { conversationTitleUpdateFromMessageResponse, type ConversationTitleUpdate } from '../../conversationModel';
import {
  composerDeviceRefs,
  composerPlainText,
  insertComposerToken,
  removeComposerPart,
  replaceComposerTextRange,
  type ComposerDeviceMethodToken,
  type ComposerPart
} from './inlineComposerModel';

type SlashPickerStage = 'actions' | 'devices' | 'methods';
interface ComposerDraft {
  parts: ComposerPart[];
  quoteTarget: MessageRecord | null;
  caretIndex: number;
  suppressedMention: string;
}

function emptyComposerParts(): ComposerPart[] {
  return [{ type: 'text', text: '' }];
}

export function useChatComposer({ snapshot, channel, conversationId, readOnly, responding = false, onRefresh, onConversationTitleChange, onLocalSendStart, onLocalSendFailure }: { snapshot: AppSnapshot; channel?: ChannelRecord; conversationId?: string; readOnly?: boolean; responding?: boolean; onRefresh: () => Promise<void>; onConversationTitleChange?: (update: ConversationTitleUpdate) => void; onLocalSendStart?: () => void; onLocalSendFailure?: () => void }) {
  const [composerParts, setComposerParts] = useState<ComposerPart[]>(emptyComposerParts);
  const [quoteTarget, setQuoteTarget] = useState<MessageRecord | null>(null);
  const attachments = useComposerAttachments(channel?.id);
  const composerScope = `${snapshot.currentUser.id}:${channel?.id ?? ''}:${conversationId ?? ''}`;
  const currentComposerScope = useRef(composerScope);
  currentComposerScope.current = composerScope;
  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caretIndex, setCaretIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [suppressedMention, setSuppressedMention] = useState('');
  const [slashPickerOpen, setSlashPickerOpen] = useState(false);
  const [slashPickerStage, setSlashPickerStage] = useState<SlashPickerStage>('actions');
  const [slashPickerQuery, setSlashPickerQuery] = useState('');
  const [slashPickerIndex, setSlashPickerIndex] = useState(0);
  const [slashPickerDeviceId, setSlashPickerDeviceId] = useState('');
  const [slashAnchor, setSlashAnchor] = useState<SlashAnchor>(null);
  const content = composerPlainText(composerParts);
  const deviceRefs = composerDeviceRefs(composerParts);
  const mentionMembers = useMemo(() => chatMentionMembers(snapshot), [snapshot]);
  const mentionToken = activeMentionToken(content, caretIndex);
  const mentionKey = mentionToken ? `${mentionToken.start}:${mentionToken.query}` : '';
  const slashToken = activeSlashToken(content, caretIndex);
  const slashKey = slashToken ? `${slashToken.start}:${slashToken.query}` : '';
  const mentionCandidates = useMemo(() => {
    if (!mentionToken || mentionKey === suppressedMention) return [];
    return chatMentionCandidates(mentionMembers, mentionToken.query);
  }, [mentionKey, mentionMembers, mentionToken, suppressedMention]);
  const mentionOpen = mentionCandidates.length > 0;
  const slashActions = useMemo(() => chatSlashActions(slashPickerStage === 'actions' ? slashPickerQuery : ''), [slashPickerQuery, slashPickerStage]);
  const slashDeviceOptions = useMemo(() => chatDeviceOptions(snapshot, slashPickerStage === 'devices' ? slashPickerQuery : ''), [snapshot, slashPickerQuery, slashPickerStage]);
  const slashSelectedDevice = useMemo(() => {
    return slashDeviceOptions.find((device) => device.id === slashPickerDeviceId) ?? snapshot.devices?.find((device) => device.id === slashPickerDeviceId);
  }, [slashDeviceOptions, slashPickerDeviceId, snapshot.devices]);
  const slashMethodOptions = useMemo(() => chatDeviceMethodOptions(slashSelectedDevice, slashPickerStage === 'methods' ? slashPickerQuery : ''), [slashPickerQuery, slashPickerStage, slashSelectedDevice]);
  const slashPickerItemCount = slashPickerStage === 'actions' ? slashActions.length : slashPickerStage === 'devices' ? slashDeviceOptions.length : slashMethodOptions.length;
  // Device method tokens are explicit message-bound requests, so a token-only composer is sendable.
  const canSend = !readOnly && !responding && Boolean(content.trim() || deviceRefs.length > 0 || attachments.attachmentIds.length > 0);
  const hasDraft = Boolean(content || deviceRefs.length > 0 || attachments.attachmentIds.length > 0 || quoteTarget);

  useEffect(() => {
    setQuoteTarget(null);
    setComposerParts(emptyComposerParts());
    setCaretIndex(0);
    closeSlashPicker();
  }, [channel?.id, conversationId]);

  useEffect(() => {
    setMentionIndex((current) => Math.min(current, Math.max(mentionCandidates.length - 1, 0)));
  }, [mentionCandidates.length]);

  useEffect(() => {
    if (mentionOpen) return;
    if (slashToken) {
      setSlashPickerOpen(true);
      setSlashPickerStage('actions');
      setSlashPickerQuery(slashToken.query);
      setSlashPickerIndex(0);
      return;
    }
    if (slashPickerOpen) closeSlashPicker();
  }, [mentionOpen, slashKey]);

  useEffect(() => {
    setSlashPickerIndex((current) => Math.min(current, Math.max(slashPickerItemCount - 1, 0)));
  }, [slashPickerItemCount]);

  async function send() {
    if (readOnly || responding || !canSend || channel?.archivedAt || attachments.blocked) return;
    const payload = chatMessagePayloadFromComposerParts({
      channelId: channel?.id,
      conversationId,
      parts: composerParts,
      attachmentIds: attachments.attachmentIds,
      quoteMessageId: quoteTarget?.id
    });
    const draft = captureComposerDraft();
    const sendingScope = composerScope;
    // 发送意图必须先于 HTTP/Realtime 消息到达，否则快速响应会被误判为远端新消息。
    onLocalSendStart?.();
    clearComposerDraft();
    try {
      const response = await submitMessage(snapshot.currentUser.id, payload);
      const titleUpdate = conversationTitleUpdateFromMessageResponse(response);
      if (titleUpdate) onConversationTitleChange?.(titleUpdate);
      if (currentComposerScope.current === sendingScope) attachments.resetAttachments();
    } catch (err) {
      if (currentComposerScope.current === sendingScope) {
        onLocalSendFailure?.();
        restoreComposerDraft(draft);
      }
      throw err;
    }
    await onRefresh();
  }

  async function sendText(text: string) {
    const content = text.trim();
    if (readOnly || responding || !content || !channel?.id || channel.archivedAt) return;
    const sendingScope = composerScope;
    onLocalSendStart?.();
    try {
      const response = await submitMessage(snapshot.currentUser.id, {
        channelId: channel.id,
        conversationId,
        content,
        attachmentIds: []
      });
      const titleUpdate = conversationTitleUpdateFromMessageResponse(response);
      if (titleUpdate) onConversationTitleChange?.(titleUpdate);
    } catch (err) {
      if (currentComposerScope.current === sendingScope) onLocalSendFailure?.();
      throw err;
    }
    await onRefresh();
  }

  function closeSlashPicker() {
    setSlashPickerOpen(false);
    setSlashPickerStage('actions');
    setSlashPickerQuery('');
    setSlashPickerIndex(0);
    setSlashPickerDeviceId('');
    setSlashAnchor(null);
  }

  function captureComposerDraft(): ComposerDraft {
    return {
      parts: composerParts,
      quoteTarget,
      caretIndex,
      suppressedMention
    };
  }

  function clearComposerDraft() {
    setComposerParts(emptyComposerParts());
    setQuoteTarget(null);
    setCaretIndex(0);
    setSuppressedMention('');
    closeSlashPicker();
  }

  function restoreComposerDraft(draft: ComposerDraft) {
    setComposerParts(draft.parts);
    setQuoteTarget(draft.quoteTarget);
    setCaretIndex(draft.caretIndex);
    setSuppressedMention(draft.suppressedMention);
  }

  function selectSlashAction(action: ChatSlashAction) {
    if (action.id !== 'device') return;
    setSlashPickerStage('devices');
    setSlashPickerQuery('');
    setSlashPickerIndex(0);
  }

  function selectDeviceForMethod(device: DeviceRecord) {
    setSlashPickerDeviceId(device.id);
    setSlashPickerStage('methods');
    setSlashPickerQuery('');
    setSlashPickerIndex(0);
  }

  function selectDeviceMethod(descriptor: DeviceCapabilityDescriptor) {
    const device = slashSelectedDevice;
    if (!device || !slashToken) return;
    const token: ComposerDeviceMethodToken = {
      type: 'device-method',
      id: `device_token_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
      deviceId: device.id,
      capability: descriptor.id
    };
    setComposerParts((current) => insertComposerToken(current, { start: slashToken.start, end: slashToken.end }, token));
    setCaretIndex(slashToken.start);
    closeSlashPicker();
    window.requestAnimationFrame(() => {
      if (editorRef.current) focusAfterToken(editorRef.current, token.id);
      textareaRef.current?.focus();
    });
  }

  function removeDeviceRef(index: number) {
    const token = composerParts.filter((part): part is ComposerDeviceMethodToken => part.type === 'device-method')[index];
    if (token) removeComposerToken(token.id);
  }

  function removeComposerToken(tokenId: string) {
    setComposerParts((current) => removeComposerPart(current, tokenId));
  }

  function updateInlineParts(parts: ComposerPart[], nextCaretIndex: number) {
    setComposerParts(parts);
    setCaretIndex(nextCaretIndex);
    setSuppressedMention('');
  }

  function setContent(next: string) {
    setComposerParts([{ type: 'text', text: next }]);
  }

  function insertMention(candidate: MentionCandidate) {
    if (!mentionToken) return;
    const insertion = `${candidate.handle} `;
    const after = content.slice(mentionToken.end);
    const normalizedInsertion = `${insertion}${after.startsWith(' ') ? '' : ''}`;
    const nextCaret = mentionToken.start + insertion.length;
    setComposerParts((current) => replaceComposerTextRange(current, {
      start: mentionToken.start,
      end: after.startsWith(' ') ? mentionToken.end + 1 : mentionToken.end
    }, normalizedInsertion));
    setCaretIndex(nextCaret);
    setSuppressedMention('');
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
      editorRef.current?.focus();
    });
  }

  function updateCaret(target: HTMLTextAreaElement, clearSuppression = false) {
    setCaretIndex(target.selectionStart);
    if (clearSuppression) setSuppressedMention('');
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((current) => (current + 1) % mentionCandidates.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === 'Tab') {
        event.preventDefault();
        const candidate = mentionCandidates[mentionIndex];
        if (candidate) insertMention(candidate);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSuppressedMention(mentionKey);
        return;
      }
    }
    if (slashPickerOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (slashPickerItemCount > 0) setSlashPickerIndex((current) => (current + 1) % slashPickerItemCount);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (slashPickerItemCount > 0) setSlashPickerIndex((current) => (current - 1 + slashPickerItemCount) % slashPickerItemCount);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === 'Tab') {
        event.preventDefault();
        if (slashPickerStage === 'actions') {
          const action = slashActions[slashPickerIndex];
          if (action) selectSlashAction(action);
        } else if (slashPickerStage === 'devices') {
          const device = slashDeviceOptions[slashPickerIndex];
          if (device) selectDeviceForMethod(device);
        } else {
          const descriptor = slashMethodOptions[slashPickerIndex];
          if (descriptor) selectDeviceMethod(descriptor);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSlashPicker();
        return;
      }
    }
    const editor = editorRef.current;
    const previousTokenId = editor ? tokenIdBeforeCaret(editor) : null;
    if (previousTokenId && shouldRemoveInlineTokenBeforeCaret({
      key: event.key,
      previousPartType: 'device-method',
      selectionCollapsed: window.getSelection()?.isCollapsed ?? true
    })) {
      event.preventDefault();
      removeComposerToken(previousTokenId);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return {
    content,
    setContent,
    quoteTarget,
    setQuoteTarget,
    composerParts,
    setComposerParts,
    deviceRefs,
    removeDeviceRef,
    removeComposerToken,
    updateInlineParts,
    deviceOptions: snapshot.devices ?? [],
    canSend,
    hasDraft,
    responding,
    slashPickerOpen,
    slashPickerStage,
    slashPickerIndex,
    slashAnchor,
    setSlashAnchor,
    slashActions,
    slashDeviceOptions,
    slashMethodOptions,
    slashSelectedDevice,
    setSlashPickerIndex,
    closeSlashPicker,
    selectSlashAction,
    selectDeviceForMethod,
    selectDeviceMethod,
    uploading: attachments.uploading,
    blocked: attachments.blocked,
    attachmentIds: attachments.attachmentIds,
    attachmentDrafts: attachments.drafts,
    fileRef: attachments.fileRef,
    textareaRef,
    editorRef,
    mentionIndex,
    setMentionIndex,
    mentionCandidates,
    mentionOpen,
    send,
    uploadFile: attachments.uploadFile,
    removeAttachment: attachments.removeAttachment,
    resetAttachments: attachments.resetAttachments,
    insertMention,
    updateCaret,
    onComposerKeyDown,
    sendText
  };
}

export type ChatComposerState = ReturnType<typeof useChatComposer>;
