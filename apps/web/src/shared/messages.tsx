import React, { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, CheckCircle2, ChevronDown, ClipboardList, Copy, ExternalLink, FileText, History, LocateFixed, Mail, MessageSquare, MoreHorizontal, Paperclip, Quote, RefreshCw, SmilePlus, Smartphone, Terminal, Trash2, X, XCircle } from "lucide-react";
import {
  SUPPORTED_MESSAGE_REACTIONS,
  type AgentRecord,
  type AppSnapshot,
  type AttachmentPreviewResponse,
  type ChannelFileItem,
  type ChannelRecord,
  type DeviceCommandRecord,
  type MessageQuoteSummary,
  type MessageReactionEmoji,
  type MessageRecord,
  type MessageResult,
  type WorkspaceBridgeRequestStatusPayload
} from "@tyr-ai/contracts";
import { shouldCloseContextMenuForKey, shouldCloseContextMenuForPointerTarget } from "../contextMenu";
import { canDeleteMessageForViewer, messageActionItems, messageActionMenuPosition, messageOverflowActionItems, messagePrimaryActionItems, messageSupportsReactions, type MessageActionId, type MessageActionItem, type MessageActionMenuPosition } from "../messageActions";
import { type MessageThreadSummary } from "../threadSummaries";
import { api, authenticatedApiUrl } from "../lib/api";
import { avatarSeed, formatBytes } from "../app/workspaceUtils";
import type { ChatMessageExecutionSummary } from "../pages/chat/chatUtils";
import { Modal, SectionLabel } from "./ui";
import { MessageMarkdown } from "./MessageMarkdown";
import { BridgeRequestProgress } from "./BridgeRequestProgress";
import { deviceCapabilityLabel, deviceCommandErrorText, deviceCommandStatusLabel, deviceCommandTerminalFailed } from "../deviceCapabilities";
import { formatMessageTimestamp } from "./messageTime";
import { isCommunicationAgentDmChannel } from "../resourceAccess";

type MessageAttachment = NonNullable<MessageRecord["attachments"]>[number];
type CopyFeedbackState = "idle" | "success" | "error";
export type CommunicationAgentRouteAction = {
  targetAgentName: string;
  instruction: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
};

const MESSAGE_REACTION_LABELS: Record<MessageReactionEmoji, string> = {
  "👍": "Thumbs up",
  "✅": "Done",
  "👀": "Watching",
  "❤️": "Love",
  "😂": "Funny",
  "🎉": "Celebrate"
};

type ToggleMessageReaction = (emoji: MessageReactionEmoji) => void | Promise<void>;

function messageReactionLabel(emoji: MessageReactionEmoji): string {
  return MESSAGE_REACTION_LABELS[emoji] ?? "Reaction";
}

function MessageReactionEmojiGlyph({ emoji }: { emoji: MessageReactionEmoji }) {
  // 反应语义直接使用彩色 emoji；只有“添加反应”入口继续保持克制的线性图标。
  return <span className="reaction-emoji" aria-hidden="true">{emoji}</span>;
}

export function MessageContent({ content }: { content: string }) {
  return <MessageMarkdown content={content} />;
}

export function MessageResultInline({ result, currentServerId, sourceAgent, onOpenSourceAgent, onRetryAssistantRequest, assistantRetrying = false }: {
  result: MessageResult;
  currentServerId?: string;
  sourceAgent?: AgentRecord;
  onOpenSourceAgent?: (agentId: string) => void | Promise<void>;
  onRetryAssistantRequest?: (sourceMessageId: string) => void | Promise<void>;
  assistantRetrying?: boolean;
}) {
  const bridgeRequestId = result.workspaceBridge?.bridgeRequestId;
  const bridgeId = result.workspaceBridge?.bridgeId;
  const [bridgeStatus, setBridgeStatus] = useState<WorkspaceBridgeRequestStatusPayload | null>(null);
  const resolvedBridgeState = bridgeStatus?.state ?? result.workspaceBridge?.state;
  useEffect(() => {
    if (!currentServerId || !bridgeId || !bridgeRequestId || resolvedBridgeState === "completed" || resolvedBridgeState === "failed") return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await api<WorkspaceBridgeRequestStatusPayload>(
          `/api/servers/${encodeURIComponent(currentServerId)}/workspace-bridges/${encodeURIComponent(bridgeId)}/requests/${encodeURIComponent(bridgeRequestId)}/status`
        );
        if (!cancelled) setBridgeStatus(status);
      } catch {
        // The persisted partial receipt remains visible if status is temporarily unavailable.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [bridgeId, bridgeRequestId, currentServerId, resolvedBridgeState]);
  const humanReply = Boolean(result.sourceHumanName?.trim());
  const source = humanReply ? `${result.sourceHumanName!.trim()} · Personal reply` : result.sourceAgentName?.trim() || "Agent";
  const sourceAgentId = result.sourceAgentId;
  const sourceUnavailable = Boolean(sourceAgentId && !sourceAgent);
  const canOpenSource = Boolean(sourceAgentId && sourceAgent && onOpenSourceAgent);
  const sourceName = canOpenSource ? (
    <button
      className="message-result-source-agent"
      type="button"
      title={`Open conversation with ${source}`}
      aria-label={`Open conversation with ${source}`}
      onClick={() => {
        if (sourceAgentId && onOpenSourceAgent) void onOpenSourceAgent(sourceAgentId);
      }}
    >
      {source}
    </button>
  ) : <b className="message-result-source-agent" title={source}>{source}</b>;
  const attributionLabel = humanReply ? `${source}, relayed by TYR` : result.status === "failed"
    ? `Result from ${source}, presented by TYR, failed`
    : result.status === "partial"
      ? `Partial result from ${source}, presented by TYR`
      : `Result from ${source}, presented by TYR`;
  // MessageResult 保留结构化来源信息，但普通 handoff 的可见内容应保持自然聊天形态。
  const content = humanReply ? result.body ?? result.summary : result.body?.trim() || result.summary.trim();
  // 阶段性回执是历史消息；Bridge 后续完成不能把当时的“已发送”改写成“已完成”。
  const bridgeStateLabel = result.status === "partial" && result.workspaceBridge
    ? "Sent through Workspace Bridge"
    : bridgeStatus?.resolution
      ? "Resolved by follow-up"
    : resolvedBridgeState === "completed"
      ? "Completed through Workspace Bridge"
      : resolvedBridgeState === "failed"
        ? "Failed through Workspace Bridge"
        : result.workspaceBridge ? "Sent through Workspace Bridge" : null;
  return (
    <section className={`message-result-inline ${result.status}`}>
      <div className={`message-result-source ${result.status}${sourceUnavailable ? " unavailable" : ""}`} role="group" aria-label={attributionLabel}>
        {!humanReply && <><span>{result.status === "partial" ? "Partial result from" : "Result from"}</span>{sourceName}</>}
        <small>{humanReply ? "Relayed by TYR" : "Presented by TYR"}</small>
        {result.status === "failed" && <small>Failed</small>}
        {sourceUnavailable && <small>unavailable</small>}
      </div>
      {content && (humanReply ? <div className="message-content personal-reply-content">{content}</div> : <MessageContent content={content} />)}
      {result.workspaceBridge && bridgeStateLabel && (
        <>
          <details className="message-result-bridge">
            <summary>{bridgeStateLabel}</summary>
            <p>{result.workspaceBridge.sentContent}</p>
          </details>
          {result.status === "partial" && (
            <small role="status">{bridgeStatus?.resolution
              ? "A later reviewed Bridge response resolved this request."
              : resolvedBridgeState === "completed"
              ? "This Bridge request has since completed."
              : resolvedBridgeState === "failed"
                ? "This Bridge request has since failed."
                : resolvedBridgeState === "blocked_on_peer_approval"
                  ? "Waiting for approval in a connected workspace."
                  : resolvedBridgeState === "needs_attention"
                    ? bridgeStatus?.progress?.summary ?? "The connected workspace request needs attention."
                  : resolvedBridgeState === "running"
                    ? bridgeStatus?.progress?.summary ?? "The connected workspace is working on this request."
                    : "Request delivered; waiting for a response."}</small>
          )}
          {bridgeStatus && <BridgeRequestProgress status={bridgeStatus} />}
        </>
      )}
      {result.assistantRetry && onRetryAssistantRequest && (
        <button
          className="message-result-assistant-retry"
          type="button"
          disabled={assistantRetrying}
          onClick={() => void onRetryAssistantRequest(result.assistantRetry!.sourceMessageId)}
        >
          <RefreshCw size={12} aria-hidden="true" />
          {assistantRetrying ? "Retrying…" : "Retry Assistant request"}
        </button>
      )}
      {result.truncated && <small className="message-result-notice">Result shortened. Open Tyr to view the available result details.</small>}
    </section>
  );
}

function isDeviceSnapshotAttachment(attachment: MessageAttachment): boolean {
  // Device screenshot artifacts are materialized by the server as PNG chat attachments with this stable prefix.
  return attachment.mimeType === "image/png" && attachment.filename.startsWith("device-snapshot-");
}

function isPreviewableRasterImage(attachment: MessageAttachment): boolean {
  const mimeType = attachment.mimeType.toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  // 历史 Agent 上传可能记录成 octet-stream；只兼容浏览器可安全内联的栅格图片扩展名。
  return mimeType === "application/octet-stream" && /\.(?:png|jpe?g|gif|webp)$/i.test(attachment.filename);
}

export function AttachmentChips({ attachments, onPreviewAttachment }: { attachments?: MessageRecord["attachments"]; onPreviewAttachment?: (attachmentId: string) => void }) {
  if (!attachments?.length) return null;
  const deviceSnapshots = attachments.filter(isDeviceSnapshotAttachment);
  const otherAttachments = attachments.filter((attachment) => !isDeviceSnapshotAttachment(attachment));
  return (
    <>
      {deviceSnapshots.length > 0 && (
        <div className="device-result-list">
          {deviceSnapshots.map((attachment) => {
            const href = authenticatedApiUrl(`/api/attachments/${encodeURIComponent(attachment.id)}?disposition=inline`);
            return (
              <button key={attachment.id} className="device-snapshot-card" type="button" title={`Open ${attachment.filename}`} onClick={() => onPreviewAttachment?.(attachment.id)}>
                <span className="device-snapshot-thumb">
                  <img src={href} alt={attachment.filename} />
                </span>
                <span className="device-snapshot-copy">
                  <b>App screen snapshot</b>
                  <small>{attachment.filename} · {formatBytes(attachment.sizeBytes)}</small>
                </span>
                <span className="device-snapshot-action">Open <ExternalLink size={13} /></span>
              </button>
            );
          })}
        </div>
      )}
      {otherAttachments.length > 0 && (
        <div className="attachment-list">
          {otherAttachments.map((attachment) => {
            const href = authenticatedApiUrl(`/api/attachments/${encodeURIComponent(attachment.id)}?disposition=inline`);
            return (
              <button key={attachment.id} className="attachment-chip" type="button" onClick={() => onPreviewAttachment?.(attachment.id)}>
                {isPreviewableRasterImage(attachment) ? <img src={href} alt={attachment.filename} /> : <Paperclip size={14} />}
                <span>{attachment.filename}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export function DeviceRefChips({ message, snapshot }: { message: MessageRecord; snapshot: AppSnapshot }) {
  if (!message.deviceRefs?.length) return null;
  return (
    <div className="device-ref-list">
      {message.deviceRefs.map((ref) => {
        const device = snapshot.devices?.find((item) => item.id === ref.deviceId);
        const Icon = ref.capability === "location.get_coarse_once" ? LocateFixed : Smartphone;
        const label = deviceCapabilityLabel(device, ref.capability);
        const command = latestDeviceCommandForRef(snapshot.deviceCommands ?? [], message.id, ref.deviceId, ref.capability);
        return (
          <span key={`${ref.deviceId}:${ref.capability}`} className="device-ref-chip">
            <Icon size={12} />
            <b>{device?.displayName ?? ref.deviceId}</b>
            <small>{label}</small>
            {command && <DeviceCommandStatusChip command={command} />}
          </span>
        );
      })}
    </div>
  );
}

function latestDeviceCommandForRef(commands: DeviceCommandRecord[], messageId: string, deviceId: string, capability: string): DeviceCommandRecord | undefined {
  return commands
    .filter((command) => command.requestedByMessageId === messageId && command.deviceId === deviceId && command.capability === capability)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
}

export function DeviceCommandStatusChip({ command }: { command: DeviceCommandRecord }) {
  const failed = deviceCommandTerminalFailed(command);
  const errorText = deviceCommandErrorText(command);
  const statusLabel = deviceCommandStatusLabel(command.status);
  const TerminalIcon = command.status === "succeeded" ? CheckCircle2 : failed ? XCircle : null;
  const className = [
    "device-command-status",
    command.status,
    failed ? "failed" : "",
    TerminalIcon ? "terminal" : ""
  ].filter(Boolean).join(" ");
  return (
    <em className={className} title={errorText || statusLabel} aria-label={errorText || statusLabel}>
      {TerminalIcon ? <TerminalIcon size={11} aria-hidden="true" /> : statusLabel}
    </em>
  );
}

export function quoteSummaryFromMessage(message: MessageRecord): MessageQuoteSummary {
  return {
    messageId: message.id,
    channelId: message.channelId,
    senderType: message.senderType,
    senderId: message.senderId,
    senderName: message.senderName,
    content: message.content,
    createdAt: message.createdAt
  };
}

export function MessageQuoteCard({ quote, onOpen, onClear }: { quote: MessageQuoteSummary; onOpen?: () => void; onClear?: () => void }) {
  const clickable = Boolean(onOpen);
  return (
    <div
      className={clickable ? "quote-card clickable" : "quote-card"}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!clickable) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.();
        }
      }}
    >
      <div className="quote-card-head"><Quote size={14} /><b>{quote.senderName}</b><time>{formatMessageTimestamp(quote.createdAt)}</time></div>
      <p>{quote.content}</p>
      {onClear && (
        <button className="quote-clear" type="button" title="Remove quote" aria-label="Remove quote" onClick={(event) => {
          event.stopPropagation();
          onClear();
        }}><X size={14} /></button>
      )}
    </div>
  );
}

export function MessageReactionPicker({ open, onOpenChange, onToggleReaction }: { open: boolean; onOpenChange: (open: boolean) => void; onToggleReaction?: ToggleMessageReaction }) {
  const [menuPosition, setMenuPosition] = useState<MessageActionMenuPosition | null>(null);
  const [pendingEmoji, setPendingEmoji] = useState<MessageReactionEmoji | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      setErrorMessage("");
      return;
    }
    function updateMenuPosition() {
      const buttonRect = buttonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;
      setMenuPosition(messageActionMenuPosition({
        buttonRect,
        menuWidth: menuRef.current?.offsetWidth ?? 226,
        menuHeight: menuRef.current?.offsetHeight ?? 48,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }));
    }
    updateMenuPosition();
    function handlePointerDown(event: PointerEvent) {
      if (
        shouldCloseContextMenuForPointerTarget(rootRef.current, event.target) &&
        shouldCloseContextMenuForPointerTarget(menuRef.current, event.target)
      ) {
        onOpenChange(false);
      }
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (shouldCloseContextMenuForKey(event.key)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [onOpenChange, open]);
  if (!onToggleReaction) return null;
  async function runToggle(emoji: MessageReactionEmoji) {
    if (pendingEmoji) return;
    setPendingEmoji(emoji);
    setErrorMessage("");
    try {
      await onToggleReaction?.(emoji);
      onOpenChange(false);
    } catch {
      setErrorMessage("Couldn’t update reaction.");
    } finally {
      setPendingEmoji(null);
    }
  }
  const menuStyle: CSSProperties = {
    left: menuPosition?.left ?? 0,
    top: menuPosition?.top ?? 0,
    visibility: menuPosition ? "visible" : "hidden"
  };
  const menu = (
    <div ref={menuRef} className="reaction-menu" data-placement={menuPosition?.placement} style={menuStyle} role="menu" aria-label="Choose reaction" aria-busy={Boolean(pendingEmoji)}>
      <div className="reaction-menu-options">
        {SUPPORTED_MESSAGE_REACTIONS.map((emoji) => {
          const label = messageReactionLabel(emoji);
          return (
            <button key={emoji} type="button" role="menuitem" title={label} aria-label={label} disabled={Boolean(pendingEmoji)} onClick={() => void runToggle(emoji)}>
              <MessageReactionEmojiGlyph emoji={emoji} />
            </button>
          );
        })}
      </div>
      {errorMessage && <small className="reaction-update-error" role="status">{errorMessage}</small>}
    </div>
  );
  return (
    <div ref={rootRef} className="reaction-picker">
      <button ref={buttonRef} className="reaction-add" type="button" title="Add reaction" aria-label="Add reaction" aria-expanded={open} disabled={Boolean(pendingEmoji)} onClick={() => onOpenChange(!open)}>
        <SmilePlus size={15} />
      </button>
      {open && (typeof document === "undefined" ? menu : createPortal(menu, document.body))}
    </div>
  );
}

export function MessageReactions({ message, currentUserId, onToggleReaction }: { message: MessageRecord; currentUserId: string; onToggleReaction?: ToggleMessageReaction }) {
  const [pendingEmoji, setPendingEmoji] = useState<MessageReactionEmoji | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const reactions = message.reactions ?? [];
  if (!reactions.length) return null;
  async function runToggle(emoji: MessageReactionEmoji) {
    if (!onToggleReaction || pendingEmoji) return;
    setPendingEmoji(emoji);
    setErrorMessage("");
    try {
      await onToggleReaction(emoji);
    } catch {
      setErrorMessage("Couldn’t update reaction.");
    } finally {
      setPendingEmoji(null);
    }
  }
  return (
    <div className="message-reactions">
      {reactions.map((reaction) => {
        const active = reaction.reactorIds.includes(currentUserId);
        const label = messageReactionLabel(reaction.emoji);
        const title = reaction.reactorNames.length ? `${label}: ${reaction.reactorNames.join(", ")}` : label;
        return (
          <button key={reaction.emoji} className={active ? "reaction-chip active" : "reaction-chip"} type="button" title={title} aria-label={title} disabled={Boolean(pendingEmoji)} onClick={() => void runToggle(reaction.emoji)}>
            <MessageReactionEmojiGlyph emoji={reaction.emoji} />
            <b>{reaction.count}</b>
          </button>
        );
      })}
      {errorMessage && <small className="reaction-update-error" role="status">{errorMessage}</small>}
    </div>
  );
}

function CommunicationAgentRouteActionPanel({ action }: { action: CommunicationAgentRouteAction }) {
  return (
    <div className="message-route-action-panel" aria-label="Route confirmation">
      <div className="message-route-action-copy">
        <b>Ready to route to {action.targetAgentName}</b>
        <small>{action.instruction}</small>
      </div>
      <div className="message-route-action-buttons">
        <button className="message-route-action-confirm" type="button" disabled={action.busy} onClick={() => void action.onConfirm()}>
          <CheckCircle2 size={14} /> Confirm route
        </button>
        <button className="message-route-action-cancel" type="button" disabled={action.busy} onClick={() => void action.onCancel()}>
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}

export function MessageActionsMenu({ items, primaryItems = [], saved = false, onToggleReaction, onAction }: { items: MessageActionItem[]; primaryItems?: MessageActionItem[]; saved?: boolean; onToggleReaction?: ToggleMessageReaction; onAction: (action: MessageActionId) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MessageActionMenuPosition | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedbackState>("idle");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    function updateMenuPosition() {
      const buttonRect = buttonRef.current?.getBoundingClientRect();
      if (!buttonRect) return;
      setMenuPosition(messageActionMenuPosition({
        buttonRect,
        menuWidth: menuRef.current?.offsetWidth ?? 190,
        menuHeight: menuRef.current?.offsetHeight ?? 168,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }));
    }
    updateMenuPosition();
    function handlePointerDown(event: PointerEvent) {
      if (
        shouldCloseContextMenuForPointerTarget(rootRef.current, event.target) &&
        shouldCloseContextMenuForPointerTarget(menuRef.current, event.target)
      ) {
        setOpen(false);
        setMenuPosition(null);
      }
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (shouldCloseContextMenuForKey(event.key)) {
        setOpen(false);
        setMenuPosition(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [open]);
  useEffect(() => () => {
    if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current);
  }, []);
  function showCopyFeedback(state: Exclude<CopyFeedbackState, "idle">) {
    if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current);
    setCopyFeedback(state);
    copyFeedbackTimerRef.current = window.setTimeout(() => setCopyFeedback("idle"), 2200);
  }
  const iconForAction = (id: MessageActionId) => {
    if (id === "copy" && copyFeedback === "success") return <CheckCircle2 size={16} />;
    if (id === "copy" && copyFeedback === "error") return <XCircle size={16} />;
    if (id === "reply-thread") return <MessageSquare size={16} />;
    if (id === "quote") return <Quote size={16} />;
    if (id === "copy") return <Copy size={16} />;
    if (id === "save") return <Bookmark size={16} fill={saved ? "currentColor" : "none"} />;
    if (id === "mark-unread") return <Mail size={16} />;
    if (id === "stop-execution") return <XCircle size={16} />;
    if (id === "delete-message") return <Trash2 size={16} />;
    return <ClipboardList size={16} />;
  };
  function copyFeedbackLabel(item: MessageActionItem): string {
    return item.id === "copy" && copyFeedback === "success"
      ? "Copied"
      : item.id === "copy" && copyFeedback === "error"
        ? "Copy failed"
        : item.label;
  }
  function copyFeedbackClass(id: MessageActionId): string {
    return id === "copy" && copyFeedback !== "idle" ? `message-action copy-${copyFeedback}` : "message-action";
  }
  async function runPrimaryAction(id: MessageActionId) {
    setOpen(false);
    setReactionOpen(false);
    setMenuPosition(null);
    try {
      await onAction(id);
      if (id === "copy") showCopyFeedback("success");
    } catch (error) {
      if (id === "copy") {
        showCopyFeedback("error");
        return;
      }
      throw error;
    }
  }
  if (items.length === 0 && primaryItems.length === 0 && !onToggleReaction) return null;
  const menuStyle: CSSProperties = {
    left: menuPosition?.left ?? 0,
    top: menuPosition?.top ?? 0,
    visibility: menuPosition ? "visible" : "hidden"
  };
  const menu = (
    <div ref={menuRef} className="message-action-menu" data-placement={menuPosition?.placement} style={menuStyle} role="menu" aria-label="Message actions">
      {items.map((item) => (
        <button key={item.id} role="menuitem" onClick={() => {
          setOpen(false);
          setMenuPosition(null);
          onAction(item.id);
        }}>
          {iconForAction(item.id)}
          {item.label}
        </button>
      ))}
    </div>
  );
  return (
    <div ref={rootRef} className={open || reactionOpen ? "message-actions open" : "message-actions"}>
      {onToggleReaction && <MessageReactionPicker open={reactionOpen} onOpenChange={(nextOpen) => {
        setReactionOpen(nextOpen);
        if (nextOpen) {
          setOpen(false);
          setMenuPosition(null);
        }
      }} onToggleReaction={onToggleReaction} />}
      {primaryItems.map((item) => (
        <button key={item.id} className={copyFeedbackClass(item.id)} type="button" title={copyFeedbackLabel(item)} aria-label={copyFeedbackLabel(item)} onClick={() => void runPrimaryAction(item.id)}>
          {iconForAction(item.id)}
        </button>
      ))}
      {items.length > 0 && (
        <button ref={buttonRef} className={saved ? "message-action saved" : "message-action"} title="More actions" aria-label="More actions" aria-expanded={open} onClick={() => {
          setReactionOpen(false);
          setMenuPosition(null);
          setOpen((current) => !current);
        }}>
          <MoreHorizontal size={17} />
        </button>
      )}
      {open && (typeof document === "undefined" ? menu : createPortal(menu, document.body))}
    </div>
  );
}

function MessageExecutionSummaryBlock({ summary, onOpenExecution, onOpenAgentActivity }: {
  summary: ChatMessageExecutionSummary;
  onOpenExecution?: () => void;
  onOpenAgentActivity?: (agentId: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const items: NonNullable<ChatMessageExecutionSummary["items"]> = summary.items?.length
    ? summary.items
    : summary.agentNames.map((agentName, index) => ({
      agentName,
      status: summary.status === "running" ? "running" : summary.status,
      actionLabel: summary.actionLabel === "Review approval" ? "Review approval" : summary.status === "completed" ? "View result" : "View progress",
      updatedAt: "",
      executionId: summary.executionIds[index]
    } satisfies NonNullable<ChatMessageExecutionSummary["items"]>[number]));
  if (items.length === 0) return null;
  function renderAgentActivityButton(item: NonNullable<ChatMessageExecutionSummary["items"]>[number]) {
    if (!(item.agentId && onOpenAgentActivity)) return null;
    return (
      <button
        className="message-execution-agent-chat tooltip-trigger"
        type="button"
        title={`Agent history: ${item.agentName}`}
        aria-label={`Agent history: ${item.agentName}`}
        data-tooltip="Agent history"
        onClick={(event) => {
          event.stopPropagation();
          void onOpenAgentActivity(item.agentId!);
        }}
      >
        <History size={13} />
      </button>
    );
  }
  // 单 Agent 使用持续的 handoff tracker；多 Agent 展开状态名册，避免聚合后丢失参与者和逐项进度。
  if (items.length === 1) {
    const item = items[0];
    const statusLabel = executionItemStatusLabel(item.status);
    const trackerCopy: Record<typeof item.status, { label: string; stage: string }> = {
      queued: { label: `Waiting for ${item.agentName}...`, stage: "Queued" },
      delivered: { label: `Sent to ${item.agentName}`, stage: "Delivered" },
      running: { label: `${item.agentName} is working...`, stage: "Running" },
      waiting: { label: `${item.agentName} is waiting...`, stage: "Waiting" },
      pending_approval: { label: `${item.agentName} needs approval`, stage: "Needs approval" },
      completed: { label: `${item.agentName} responded`, stage: "Completed" },
      failed: { label: `${item.agentName} needs attention`, stage: "Failed" },
      partial: { label: `${item.agentName} history available`, stage: "History" }
    };
    const copy = trackerCopy[item.status];
    const pillContent = (
      <>
        <span className="message-execution-signal" aria-hidden="true"><i /><i /><i /></span>
        <span className="message-execution-copy">
          <b>{copy.label}</b>
          <small>{copy.stage}</small>
        </span>
      </>
    );
    // 没有详情回调时只展示状态，不能向用户提供一个实际为空操作的按钮。
    const pill = onOpenExecution ? (
      <button
        className={`message-execution-pill message-handoff-tracker ${item.status} tooltip-trigger`}
        type="button"
        title={`${statusLabel} · Open ${item.agentName} execution`}
        aria-label={`${statusLabel}. Open ${item.agentName} execution`}
        data-tooltip={`${statusLabel} · Open execution`}
        onClick={onOpenExecution}
      >
        {pillContent}
      </button>
    ) : (
      <span className={`message-execution-pill message-handoff-tracker ${item.status}`} aria-label={`${statusLabel}. ${item.agentName} execution`}>
        {pillContent}
      </span>
    );
    if (!(item.agentId && onOpenAgentActivity)) return pill;
    return (
      <div className="message-execution-pill-group">
        {pill}
        {renderAgentActivityButton(item)}
      </div>
    );
  }
  const completedCount = items.filter((item) => item.status === "completed").length;
  const progressLabel = `${completedCount} of ${items.length} completed`;
  return (
    <section className={`message-execution-summary-block ${summary.status}`} aria-label={`Execution progress: ${progressLabel}`}>
      <div className="message-execution-summary-head">
        <span className="message-execution-summary-mark" aria-hidden="true"><Terminal size={13} /></span>
        <span className="message-execution-summary-title">
          <b>Execution</b>
          <small>{items.length} assigned agents</small>
        </span>
        <span className="message-execution-summary-progress">{progressLabel}</span>
        <button
          className="message-execution-summary-toggle"
          type="button"
          title={expanded ? "Collapse Agent status list" : "Expand Agent status list"}
          aria-label={expanded ? "Collapse Agent status list" : "Expand Agent status list"}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="message-execution-summary-rows">
          {items.map((item, index) => (
            <div
              key={item.executionId ?? item.groupId ?? `${item.agentName}-${index}`}
              className={`message-execution-summary-row ${item.status}`}
              role="group"
              aria-label={`${item.agentName}: ${executionItemStatusLabel(item.status)}`}
            >
              {onOpenExecution ? <button
                className="message-execution-summary-row-main"
                type="button"
                title={`${item.actionLabel}: ${item.agentName}`}
                aria-label={`${item.actionLabel}: ${item.agentName}`}
                onClick={onOpenExecution}
              >
                <span className="message-execution-agent">
                  <i className="message-execution-row-dot" aria-hidden="true" />
                  <span>{item.agentName}</span>
                </span>
                <span className="message-execution-status">{executionItemStatusLabel(item.status)}</span>
                <b>{item.actionLabel}</b>
              </button> : <div className="message-execution-summary-row-main" aria-label={`${item.agentName}: ${executionItemStatusLabel(item.status)}`}>
                <span className="message-execution-agent">
                  <i className="message-execution-row-dot" aria-hidden="true" />
                  <span>{item.agentName}</span>
                </span>
                <span className="message-execution-status">{executionItemStatusLabel(item.status)}</span>
                <b>{item.actionLabel}</b>
              </div>}
              {renderAgentActivityButton(item)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function executionItemStatusLabel(status: NonNullable<ChatMessageExecutionSummary["items"]>[number]["status"] | ChatMessageExecutionSummary["status"]): string {
  if (status === "queued") return "Queued";
  if (status === "delivered") return "Delivered";
  if (status === "running") return "Running";
  if (status === "waiting") return "Waiting";
  if (status === "pending_approval") return "Needs approval";
  if (status === "failed") return "Failed";
  if (status === "partial") return "Partial history";
  return "Completed";
}

export function MessageItem({ snapshot, message, focused = false, saved = false, threadSummary, executionSummary, communicationAgentRouteAction, assistantRetrying = false, onToggleSaved, onOpenThread, onOpenExecution, onOpenAgentActivity, onOpenAgentDm, onRetryAssistantRequest, onPreviewAttachment, onToggleReaction, onQuoteMessage, onCopyMessage, onMarkUnread, onOpenQuote, onStopExecution, onDeleteMessage }: {
  snapshot: AppSnapshot;
  message: AppSnapshot["messages"][number];
  focused?: boolean;
  saved?: boolean;
  threadSummary?: MessageThreadSummary;
  executionSummary?: ChatMessageExecutionSummary | null;
  communicationAgentRouteAction?: CommunicationAgentRouteAction;
  assistantRetrying?: boolean;
  onToggleSaved?: () => void;
  onOpenThread?: () => void;
  onOpenExecution?: () => void;
  onOpenAgentActivity?: (agentId: string) => void | Promise<void>;
  onOpenAgentDm?: (agentId: string) => void | Promise<void>;
  onRetryAssistantRequest?: (sourceMessageId: string) => void | Promise<void>;
  onPreviewAttachment?: (attachmentId: string) => void;
  onToggleReaction?: ToggleMessageReaction;
  onQuoteMessage?: () => void;
  onCopyMessage?: () => void | Promise<void>;
  onMarkUnread?: () => void;
  onOpenQuote?: (quote: MessageQuoteSummary) => void;
  onStopExecution?: () => void | Promise<void>;
  onDeleteMessage?: () => void | Promise<void>;
}) {
  const isDeleted = Boolean(message.deletedAt);
  const isSelf = message.senderType === "human" && message.senderId === snapshot.currentUser.id;
  const parentChannel = snapshot.channels.find((channel) => channel.id === message.channelId);
  const assistantDm = isCommunicationAgentDmChannel(parentChannel, snapshot.agents);
  // TYR 的执行、worker 状态和结果都回到主 DM；只有普通 Runtime Agent DM 可以新建消息 thread。
  const canOpenThread = !isDeleted && message.senderType !== "system" && message.channelType === "dm" && !assistantDm && Boolean(onOpenThread);
  const canReact = messageSupportsReactions(message) && Boolean(onToggleReaction);
  const canQuoteMessage = !isDeleted && message.senderType !== "system" && Boolean(onQuoteMessage);
  // 只有还可能继续写回的执行才提供 Stop；failed/completed 已经是终态，不再发取消请求。
  const canStopExecution = !isDeleted && Boolean(executionSummary && executionSummary.status !== "completed" && executionSummary.status !== "failed" && executionSummary.status !== "partial" && onStopExecution);
  const personalReplyName = !isDeleted ? message.result?.sourceHumanName?.trim() : undefined;
  const label = personalReplyName || (message.senderType === "human"
    ? snapshot.humans.find((human) => human.id === message.senderId)?.displayName ?? message.senderName
    : message.senderName);
  // TYR 返回的 worker 结果仍由 Assistant 写入当前 DM；来源 Agent 单独决定身份条和跳转目标。
  const resultSourceAgent = message.result?.sourceAgentId
    ? snapshot.agents.find((agent) => agent.id === message.result?.sourceAgentId)
    : undefined;
  const actionItems = messageActionItems({
    canReplyInThread: canOpenThread,
    threadReplyCount: threadSummary?.replyCount,
    canQuote: canQuoteMessage,
    canCopy: !isDeleted && Boolean(onCopyMessage),
    canSave: !isDeleted && Boolean(onToggleSaved),
    saved,
    canMarkUnread: !isDeleted && message.senderType !== "system" && Boolean(onMarkUnread),
    canStopExecution,
    canDelete: canDeleteMessageForViewer(snapshot, message) && Boolean(onDeleteMessage)
  });
  const primaryActionItems = messagePrimaryActionItems(actionItems, message);
  const overflowActionItems = messageOverflowActionItems(actionItems, message);
  const hasActionMenu = !isDeleted && (actionItems.length > 0 || canReact);
  function runMessageAction(action: MessageActionId): void | Promise<void> {
    if (action === "reply-thread") return onOpenThread?.();
    if (action === "quote") return onQuoteMessage?.();
    if (action === "copy") return onCopyMessage?.();
    if (action === "save") return onToggleSaved?.();
    if (action === "mark-unread") return onMarkUnread?.();
    if (action === "stop-execution") return onStopExecution?.();
    if (action === "delete-message") return onDeleteMessage?.();
  }
  const messageClasses = [
    "message",
    isSelf ? "self" : "",
    message.senderType === "system" ? "system" : "",
    message.result ? `result-message result-${message.result.status}` : "",
    isDeleted ? "deleted" : "",
    focused ? "focused" : ""
  ].filter(Boolean).join(" ");
  const actionMenu = hasActionMenu ? (
    <MessageActionsMenu
      items={overflowActionItems}
      primaryItems={primaryActionItems}
      saved={saved}
      onToggleReaction={canReact ? onToggleReaction : undefined}
      onAction={runMessageAction}
    />
  ) : null;
  // 已有 Thread 的回复数是持久入口；清除 unread 后仍然必须能重新进入。
  const showThreadPill = Boolean(threadSummary && threadSummary.replyCount > 0 && onOpenThread);
  // 所有消息的操作入口都固定在气泡下方；execution 保持在前，避免 hover 展开消息操作时把状态入口向右推移。
  const showAffordanceRow = Boolean(hasActionMenu || showThreadPill || (!isDeleted && executionSummary));
  return (
    <div className={messageClasses} data-message-id={message.id}>
      <div className={`avatar ${personalReplyName ? "human" : message.senderType === "agent" ? "agent" : message.senderType === "system" ? "system" : "human"}`}>
        {message.senderType === "system" ? "S" : avatarSeed(label)}
      </div>
      <div className="message-body">
        {message.senderType !== "system" && (
          <div className="message-meta"><b>{label}</b><small>{personalReplyName ? "Personal reply" : message.senderType}</small><time>{formatMessageTimestamp(message.createdAt)}</time></div>
        )}
        <div className="message-bubble">
          {isDeleted ? (
            <p className="message-tombstone">Message deleted</p>
          ) : (
            <>
              {message.quote && <MessageQuoteCard quote={message.quote} onOpen={onOpenQuote ? () => onOpenQuote(message.quote!) : undefined} />}
              {message.result ? <MessageResultInline result={message.result} currentServerId={snapshot.currentServer?.id} sourceAgent={resultSourceAgent} onOpenSourceAgent={onOpenAgentDm} onRetryAssistantRequest={onRetryAssistantRequest} assistantRetrying={assistantRetrying} /> : <MessageContent content={message.content} />}
              {communicationAgentRouteAction && <CommunicationAgentRouteActionPanel action={communicationAgentRouteAction} />}
              <DeviceRefChips message={message} snapshot={snapshot} />
              <AttachmentChips attachments={message.attachments} onPreviewAttachment={onPreviewAttachment} />
              {messageSupportsReactions(message) && <MessageReactions message={message} currentUserId={snapshot.currentUser.id} onToggleReaction={onToggleReaction} />}
            </>
          )}
        </div>
        {showAffordanceRow && (
          <div className="message-affordance-row">
            {showThreadPill && threadSummary && <button className={`thread-pill${threadSummary.unreadCount > 0 ? " unread" : ""}`} type="button" onClick={onOpenThread}>
              <MessageSquare size={13} /> {threadSummary.unreadCount > 0
                ? <>{threadSummary.unreadCount} {threadSummary.unreadCount === 1 ? "new reply" : "new replies"}</>
                : <>{threadSummary.replyCount} {threadSummary.replyCount === 1 ? "reply" : "replies"}</>}
            </button>}
            {!isDeleted && executionSummary && (
              <MessageExecutionSummaryBlock summary={executionSummary} onOpenExecution={onOpenExecution} onOpenAgentActivity={onOpenAgentActivity} />
            )}
            {actionMenu}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChannelFilesView({ channel, onPreviewAttachment }: { channel: ChannelRecord; onPreviewAttachment: (attachmentId: string) => void }) {
  const [files, setFiles] = useState<ChannelFileItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setFiles([]);
    api<{ files: ChannelFileItem[] }>(`/api/channels/${encodeURIComponent(channel.id)}/files`)
      .then((data) => {
        if (cancelled) return;
        setFiles(data.files);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [channel.id]);

  return (
    <div className="channel-files-view">
      <div className="channel-files-head">
        <SectionLabel label={`FILES ${files.length}`} />
      </div>
      {state === "loading" && <div className="empty-box">Loading files...</div>}
      {state === "error" && <div className="empty-box">Could not load files.</div>}
      {state === "ready" && files.length === 0 && <div className="empty-box">No files in this conversation.</div>}
      {state === "ready" && files.length > 0 && (
        <div className="file-list channel-file-list">
          {files.map((file) => (
            <button key={`${file.messageId}-${file.attachmentId}`} className="file-row channel-file-row" onClick={() => onPreviewAttachment(file.attachmentId)}>
              {file.previewType === "image" ? <img className="file-thumb" src={authenticatedApiUrl(`/api/attachments/${encodeURIComponent(file.attachmentId)}?disposition=inline`)} alt="" /> : <FileText size={18} />}
              <b>{file.filename}</b>
              <small>{file.senderName} · {file.mimeType} · {formatBytes(file.sizeBytes)}</small>
              <time>{new Date(file.messageCreatedAt).toLocaleString()}</time>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AttachmentPreviewModal({ attachmentId, onClose }: { attachmentId: string; onClose: () => void }) {
  const [preview, setPreview] = useState<AttachmentPreviewResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setPreview(null);
    api<AttachmentPreviewResponse>(`/api/attachments/${encodeURIComponent(attachmentId)}/preview`)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  const inlineHref = preview ? authenticatedApiUrl(preview.inlineUrl) : "";
  const downloadHref = preview ? authenticatedApiUrl(preview.downloadUrl) : "";

  return (
    <Modal title={preview?.filename ?? "Attachment Preview"} onClose={onClose} className="template-form-modal template-form-modal-xl attachment-preview-modal" backdropClassName="template-form-modal-backdrop" titleIcon={<Paperclip size={18} />}>
      <div className="template-dialog-content">
        <div className="template-dialog-body attachment-preview-dialog-body">
          {state === "loading" && <div className="empty-box">Loading preview...</div>}
          {state === "error" && <div className="empty-box">Preview unavailable.</div>}
          {state === "ready" && preview && (
            <>
              <div className="attachment-preview-meta">
                <span>{preview.mimeType}</span>
                <span>{formatBytes(preview.sizeBytes)}</span>
                <span>{preview.previewType}</span>
              </div>
              <div className="attachment-preview-body">
                {preview.previewType === "image" && <img className="attachment-preview-image" src={inlineHref} alt={preview.filename} />}
                {preview.content !== undefined && <pre>{preview.content}{preview.truncated ? "\n\n[Preview truncated]" : ""}</pre>}
                {preview.previewType === "download" && (
                  <div className="preview-download-only">
                    <Paperclip size={28} />
                    <p>This file type is available for download.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {state === "ready" && preview && (
          <div className="modal-actions template-dialog-actions">
            <a className="btn" href={downloadHref} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Download</a>
            <button className="btn primary" type="button" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
