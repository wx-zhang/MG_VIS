import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Smartphone, UserRound, X } from 'lucide-react';
import { type ChannelRecord } from '@tyr-ai/contracts';
import { avatarSeed, statusDot } from '../../app/workspaceUtils';
import { ComposerAttachmentPreviewList } from '../../composerAttachments';
import { deviceCapabilityLabel } from '../../deviceCapabilities';
import { MessageQuoteCard, quoteSummaryFromMessage } from '../../shared/messages';
import { InlineComposerEditor } from './InlineComposerEditor';
import type { ChatComposerState } from './useChatComposer';

const RUNNING_GUIDANCE_DISMISSED_STORAGE_KEY = "tyr.chat.running-guidance-dismissed.v1";

function hasDismissedRunningGuidance(): boolean {
  try {
    return window.localStorage.getItem(RUNNING_GUIDANCE_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function ChatComposer({ channel, composer, placeholder, readOnly, onViewMessageInChannel }: { channel?: ChannelRecord; composer: ChatComposerState; placeholder?: string; readOnly?: boolean; onViewMessageInChannel: (channelId: string, messageId: string) => void }) {
  const selectedDevice = composer.slashSelectedDevice;
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [runningGuidanceDismissed, setRunningGuidanceDismissed] = useState(hasDismissedRunningGuidance);
  const composerPlaceholder = placeholder ?? (channel?.type === 'dm' ? `Message @${channel.displayName.replace(/^DM\s*@?/, "") || channel.name}` : 'Message conversation');
  const slashMenuClass = composer.slashAnchor ? "mention-menu composer-slash-menu composer-floating-menu" : "mention-menu composer-slash-menu";
  const slashMenuStyle = composer.slashAnchor ? { left: composer.slashAnchor.left, top: composer.slashAnchor.top } : undefined;

  useEffect(() => {
    if (!composer.mentionOpen) return;
    // Keyboard navigation changes the active row without moving DOM focus, so keep the scrollable menu aligned manually.
    mentionOptionRefs.current[composer.mentionIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [composer.mentionOpen, composer.mentionIndex, composer.mentionCandidates]);

  function keepEditorVisibleAfterKeyboard() {
    window.setTimeout(() => {
      composer.editorRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 80);
  }

  function dismissRunningGuidance() {
    setRunningGuidanceDismissed(true);
    try {
      // 该轻量提示按浏览器记忆即可；无需为展示偏好增加账号级后端状态。
      window.localStorage.setItem(RUNNING_GUIDANCE_DISMISSED_STORAGE_KEY, "1");
    } catch {
      // 存储不可用时仍关闭当前页面中的提示。
    }
  }

  return (
    <div className="composer">
      {channel?.archivedAt && <div className="archived-banner">This conversation is archived. Restore it before sending new messages.</div>}
      {readOnly && <div className="composer-read-only">Viewing conversation history. Back to current conversation to send a new message.</div>}
      {composer.quoteTarget && <MessageQuoteCard quote={quoteSummaryFromMessage(composer.quoteTarget)} onOpen={() => onViewMessageInChannel(composer.quoteTarget!.channelId, composer.quoteTarget!.id)} onClear={() => composer.setQuoteTarget(null)} />}
      {composer.mentionOpen && (
        <div className="mention-menu" role="listbox" aria-label="Mention members">
          {composer.mentionCandidates.map((candidate, index) => (
            <button
              ref={(node) => {
                mentionOptionRefs.current[index] = node;
              }}
              key={`${candidate.type}-${candidate.id}`}
              className={index === composer.mentionIndex ? 'mention-option active' : 'mention-option'}
              role="option"
              aria-selected={index === composer.mentionIndex}
              onMouseEnter={() => composer.setMentionIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                composer.insertMention(candidate);
              }}
            >
              <span className={`avatar ${candidate.type}`}>{candidate.type === 'human' ? <UserRound size={15} /> : avatarSeed(candidate.name)}</span>
              <span className="mention-main">
                <b>{candidate.displayName}</b>
                {candidate.type === 'agent' && <span className={statusDot(candidate.status)} />}
                {candidate.description && <small>{candidate.description}</small>}
              </span>
              <span className="mention-handle">{candidate.handle}</span>
            </button>
          ))}
        </div>
      )}
      {!composer.mentionOpen && composer.slashPickerOpen && (
        <div className={slashMenuClass} style={slashMenuStyle} role="listbox" aria-label="Device method picker">
          {composer.slashPickerStage === 'actions' && composer.slashActions.map((action, index) => (
            <button
              key={action.id}
              className={index === composer.slashPickerIndex ? 'mention-option slash-option active' : 'mention-option slash-option'}
              role="option"
              aria-selected={index === composer.slashPickerIndex}
              onMouseEnter={() => composer.setSlashPickerIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                composer.selectSlashAction(action);
              }}
            >
              <span className="slash-option-icon"><Smartphone size={15} /></span>
              <span className="slash-option-main">
                <b>{action.label}</b>
                <small>{action.description}</small>
              </span>
              <span className="slash-option-meta">{action.command}</span>
            </button>
          ))}
          {composer.slashPickerStage === 'devices' && composer.slashDeviceOptions.map((device, index) => (
            <button
              key={device.id}
              className={index === composer.slashPickerIndex ? 'mention-option slash-option active' : 'mention-option slash-option'}
              role="option"
              aria-selected={index === composer.slashPickerIndex}
              onMouseEnter={() => composer.setSlashPickerIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                composer.selectDeviceForMethod(device);
              }}
            >
              <span className="slash-option-icon"><Smartphone size={15} /></span>
              <span className="slash-option-main">
                <b>{device.displayName}</b>
                <small>{device.platform} / {device.deviceKind} · {device.capabilities.length} methods</small>
              </span>
              <span className={device.status === 'online' ? 'slash-option-status online' : 'slash-option-status'}>{device.status}</span>
            </button>
          ))}
          {composer.slashPickerStage === 'devices' && composer.slashDeviceOptions.length === 0 && (
            <div className="mention-empty" role="option" aria-disabled="true">No paired devices</div>
          )}
          {composer.slashPickerStage === 'methods' && composer.slashMethodOptions.map((descriptor, index) => {
            const capability = descriptor.id;
            return (
              <button
                key={capability}
                className={index === composer.slashPickerIndex ? 'mention-option slash-option active' : 'mention-option slash-option'}
                role="option"
                aria-selected={index === composer.slashPickerIndex}
                onMouseEnter={() => composer.setSlashPickerIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  composer.selectDeviceMethod(descriptor);
                }}
              >
                <span className="slash-option-icon"><Smartphone size={15} /></span>
                <span className="slash-option-main">
                  <b>{deviceCapabilityLabel(selectedDevice, capability)}</b>
                  {descriptor.description && <small>{descriptor.description}</small>}
                </span>
                <span className="slash-option-meta">{descriptor.riskLevel} risk</span>
              </button>
            );
          })}
          {composer.slashPickerStage === 'methods' && composer.slashMethodOptions.length === 0 && (
            <div className="mention-empty" role="option" aria-disabled="true">No available methods</div>
          )}
        </div>
      )}
      <div className="composer-input-shell">
        {/* 运行中的 TYR 会话继续保持单执行，只提示用户使用现有会话菜单启动并行工作。 */}
        {composer.responding && !runningGuidanceDismissed && (
          <div className="composer-running-guidance">
            <p>TYR is working in this conversation. To run another task in parallel, select <b>Start new conversation</b> from the conversation menu above.</p>
            <button className="composer-running-guidance-dismiss" type="button" aria-label="Dismiss guidance" title="Dismiss" onClick={dismissRunningGuidance}>
              <X size={14} />
            </button>
          </div>
        )}
        <ComposerAttachmentPreviewList attachments={composer.attachmentDrafts} onRemove={composer.removeAttachment} />
        <div className="composer-row">
          <input ref={composer.fileRef} type="file" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void composer.uploadFile(file);
            event.currentTarget.value = "";
          }} />
          <button className="icon-btn" type="button" disabled={readOnly || Boolean(channel?.archivedAt) || composer.uploading} onClick={() => composer.fileRef.current?.click()} title="Attach"><Paperclip size={16} /></button>
          <InlineComposerEditor
            editorRef={composer.editorRef}
            parts={composer.composerParts}
            devices={composer.deviceOptions}
            placeholder={composerPlaceholder}
            disabled={readOnly || Boolean(channel?.archivedAt)}
            onInputParts={composer.updateInlineParts}
            onKeyDown={composer.onComposerKeyDown}
            onRemoveToken={composer.removeComposerToken}
            onSlashAnchorChange={composer.setSlashAnchor}
            onFocusVisible={keepEditorVisibleAfterKeyboard}
          />
          <button className="btn primary" disabled={readOnly || Boolean(channel?.archivedAt) || composer.responding || !composer.canSend || composer.blocked} onClick={() => void composer.send()}><Send size={16} /> Send</button>
        </div>
      </div>
    </div>
  );
}
