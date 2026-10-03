import { type ClipboardEvent, type KeyboardEvent, type MouseEvent, type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import type { DeviceCapability, DeviceRecord } from "@tyr-ai/contracts";
import { deviceCapabilityDescriptors, deviceCapabilityLabel } from "../../deviceCapabilities";
import { compactComposerParts, type ComposerPart } from "./inlineComposerModel";

export type SlashAnchor = { left: number; top: number } | null;

export function InlineComposerEditor(props: {
  editorRef: RefObject<HTMLDivElement | null>;
  parts: ComposerPart[];
  devices: DeviceRecord[];
  placeholder: string;
  disabled: boolean;
  onInputParts: (parts: ComposerPart[], caretIndex: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onRemoveToken: (tokenId: string) => void;
  onSlashAnchorChange: (anchor: SlashAnchor) => void;
  onFocusVisible: () => void;
}) {
  const lastInputSignatureRef = useRef("");
  const lastDeviceSignatureRef = useRef("");

  useEffect(() => {
    if (props.parts.length === 1 && props.parts[0].type === "text" && props.parts[0].text.length === 0) {
      props.onSlashAnchorChange(null);
    }
  }, [props.parts, props.onSlashAnchorChange]);

  useLayoutEffect(() => {
    const editor = props.editorRef.current;
    if (!editor) return;
    const signature = composerPartsSignature(props.parts);
    const deviceSignature = composerDevicesSignature(props.devices);
    if (signature === lastInputSignatureRef.current && deviceSignature === lastDeviceSignatureRef.current) return;
    renderComposerParts(editor, props.parts, props.devices);
    lastInputSignatureRef.current = signature;
    lastDeviceSignatureRef.current = deviceSignature;
  }, [props.devices, props.editorRef, props.parts]);

  function handleEditableInput(editor: HTMLDivElement) {
    const parts = editorComposerParts(editor);
    lastInputSignatureRef.current = composerPartsSignature(parts);
    props.onInputParts(parts, caretTextIndex(editor));
    props.onSlashAnchorChange(caretMenuAnchor(editor));
  }

  function handleEditablePaste(event: ClipboardEvent<HTMLDivElement>) {
    // Keep paste plain; contentEditable otherwise preserves source HTML styles in the composer DOM.
    const text = event.clipboardData.getData("text/plain");
    event.preventDefault();
    if (text) insertPlainTextAtSelection(event.currentTarget, text);
    handleEditableInput(event.currentTarget);
  }

  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    const removeButton = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(".composer-inline-device-remove");
    if (!removeButton) return;
    const token = removeButton.closest<HTMLElement>("[data-composer-token-id]");
    const tokenId = token?.dataset.composerTokenId;
    if (!tokenId) return;
    event.preventDefault();
    event.stopPropagation();
    props.onRemoveToken(tokenId);
  }

  return (
    <div
      ref={props.editorRef}
      className="composer-inline-editor"
      role="textbox"
      aria-multiline="true"
      aria-label={props.placeholder}
      data-placeholder={props.placeholder}
      contentEditable={!props.disabled}
      suppressContentEditableWarning
      onInput={(event) => handleEditableInput(event.currentTarget)}
      onKeyDown={props.onKeyDown}
      onClick={(event) => handleEditableInput(event.currentTarget)}
      onKeyUp={(event) => handleEditableInput(event.currentTarget)}
      onMouseDown={handleMouseDown}
      onPaste={handleEditablePaste}
      onFocus={props.onFocusVisible}
    />
  );
}

function composerPartsSignature(parts: readonly ComposerPart[]): string {
  return JSON.stringify(parts);
}

function composerDevicesSignature(devices: readonly DeviceRecord[]): string {
  return JSON.stringify(devices.map((device) => ({
    id: device.id,
    displayName: device.displayName,
    capabilities: device.capabilities,
    capabilityDescriptors: device.capabilityDescriptors
  })));
}

function renderComposerParts(editor: HTMLElement, parts: readonly ComposerPart[], devices: readonly DeviceRecord[]): void {
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text) fragment.append(document.createTextNode(part.text));
      continue;
    }
    fragment.append(createDeviceTokenElement(part, devices));
  }
  editor.replaceChildren(fragment);
}

function createDeviceTokenElement(part: Extract<ComposerPart, { type: "device-method" }>, devices: readonly DeviceRecord[]): HTMLElement {
  const device = devices.find((item) => item.id === part.deviceId);
  const descriptor = deviceCapabilityDescriptors(device).find((item) => item.id === part.capability);
  const token = document.createElement("span");
  token.className = "composer-inline-device-token";
  token.dataset.composerTokenId = part.id;
  token.dataset.deviceId = part.deviceId;
  token.dataset.capability = part.capability;
  token.contentEditable = "false";
  token.title = descriptor?.description || "Device method request";

  const icon = document.createElement("span");
  icon.className = "composer-inline-device-icon";
  icon.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.textContent = `${device?.displayName ?? part.deviceId} -> ${deviceCapabilityLabel(device, part.capability)}`;

  token.append(icon, label);
  if (descriptor?.riskLevel) {
    const risk = document.createElement("em");
    risk.textContent = `${descriptor.riskLevel} risk`;
    token.append(risk);
  }

  const remove = document.createElement("button");
  remove.className = "composer-inline-device-remove";
  remove.type = "button";
  remove.title = "Remove device method request";
  remove.setAttribute("aria-label", "Remove device method request");
  remove.textContent = "x";
  remove.contentEditable = "false";
  token.append(remove);
  return token;
}

export function editorText(editor: HTMLElement): string {
  let text = "";
  editor.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (node instanceof HTMLElement && node.dataset.composerTokenId) return;
    text += node.textContent ?? "";
  });
  return text;
}

export function editorComposerParts(editor: HTMLElement): ComposerPart[] {
  const parts: ComposerPart[] = [];
  editor.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push({ type: "text", text: node.textContent ?? "" });
      return;
    }
    if (node instanceof HTMLElement && node.dataset.composerTokenId) {
      const deviceId = node.dataset.deviceId;
      const capability = node.dataset.capability;
      if (deviceId && capability) {
        parts.push({
          type: "device-method",
          id: node.dataset.composerTokenId,
          deviceId,
          capability: capability as DeviceCapability
        });
      }
      return;
    }
    parts.push({ type: "text", text: node.textContent ?? "" });
  });
  return compactComposerParts(parts);
}

export function caretTextIndex(editor: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return editorText(editor).length;
  const range = selection.getRangeAt(0);
  return textLengthBeforeNode(editor, range.startContainer, range.startOffset);
}

export function tokenIdBeforeCaret(editor: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const container = range.startContainer;
  if (container === editor) {
    if (range.startOffset === 0) return null;
    const previous = editor.childNodes.item(range.startOffset - 1);
    return previous instanceof HTMLElement ? previous.dataset.composerTokenId ?? null : null;
  }
  if (container.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
    const previous = container.previousSibling;
    return previous instanceof HTMLElement ? previous.dataset.composerTokenId ?? null : null;
  }
  return null;
}

export function focusAfterToken(editor: HTMLElement, tokenId: string): void {
  const token = editor.querySelector<HTMLElement>(`[data-composer-token-id="${CSS.escape(tokenId)}"]`);
  if (!token) return;
  const range = document.createRange();
  range.setStartAfter(token);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  editor.focus();
}

function insertPlainTextAtSelection(editor: HTMLElement, text: string): void {
  const selection = window.getSelection();
  const textNode = document.createTextNode(text);
  if (!selection || selection.rangeCount === 0) {
    editor.append(textNode);
    placeCaretAfter(textNode);
    return;
  }

  const range = selection.getRangeAt(0);
  if (!editorContainsNode(editor, range.commonAncestorContainer)) {
    editor.append(textNode);
    placeCaretAfter(textNode);
    return;
  }

  range.deleteContents();
  range.insertNode(textNode);
  placeCaretAfter(textNode);
}

function editorContainsNode(editor: HTMLElement, node: Node): boolean {
  return node === editor || editor.contains(node);
}

function placeCaretAfter(node: Node): void {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function caretMenuAnchor(editor: HTMLElement): SlashAnchor {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return fallbackAnchor(editor);
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return fallbackAnchor(editor);
  return { left: rect.left, top: rect.top };
}

function fallbackAnchor(editor: HTMLElement): SlashAnchor {
  const rect = editor.getBoundingClientRect();
  return { left: rect.left + 8, top: rect.top };
}

function textLengthBeforeNode(root: HTMLElement, target: Node, offset: number): number {
  let count = 0;
  let found = false;

  function visit(node: Node): void {
    if (found) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) count += Math.min(offset, node.textContent?.length ?? 0);
      found = true;
      return;
    }
    if (node instanceof HTMLElement && node.dataset.composerTokenId) return;
    if (node.nodeType === Node.TEXT_NODE) {
      count += node.textContent?.length ?? 0;
      return;
    }
    node.childNodes.forEach(visit);
  }

  if (target === root) {
    for (let index = 0; index < Math.min(offset, root.childNodes.length); index += 1) {
      const child = root.childNodes.item(index);
      if (child instanceof HTMLElement && child.dataset.composerTokenId) continue;
      count += child.textContent?.length ?? 0;
    }
    return count;
  }

  root.childNodes.forEach(visit);
  return found ? count : editorText(root).length;
}
