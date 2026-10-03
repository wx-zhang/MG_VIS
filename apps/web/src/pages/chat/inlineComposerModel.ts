import type { DeviceCapability, MessageDeviceRef } from "@tyr-ai/contracts";

export type ComposerDeviceMethodToken = {
  type: "device-method";
  id: string;
  deviceId: string;
  capability: DeviceCapability;
};

export type ComposerTextPart = {
  type: "text";
  text: string;
};

export type ComposerPart = ComposerTextPart | ComposerDeviceMethodToken;

export type ComposerTextRange = {
  start: number;
  end: number;
};

export function composerPlainText(parts: readonly ComposerPart[]): string {
  return parts.map((part) => part.type === "text" ? part.text : "").join("");
}

export function composerDeviceRefs(parts: readonly ComposerPart[]): MessageDeviceRef[] {
  return parts.flatMap((part) => part.type === "device-method"
    ? [{ deviceId: part.deviceId, capability: part.capability }]
    : []);
}

export function insertComposerToken(parts: readonly ComposerPart[], range: ComposerTextRange, token: ComposerDeviceMethodToken): ComposerPart[] {
  const result: ComposerPart[] = [];
  let textCursor = 0;
  let inserted = false;

  for (const part of parts) {
    if (part.type !== "text") {
      if (!inserted && textCursor >= range.end) {
        result.push(token);
        inserted = true;
      }
      result.push(part);
      continue;
    }

    const partStart = textCursor;
    const partEnd = partStart + part.text.length;
    textCursor = partEnd;

    if (partEnd <= range.start) {
      result.push(part);
      continue;
    }

    if (partStart >= range.end) {
      if (!inserted) {
        result.push(token);
        inserted = true;
      }
      result.push(part);
      continue;
    }

    const before = part.text.slice(0, Math.max(0, range.start - partStart));
    const after = part.text.slice(Math.max(0, range.end - partStart));
    if (before) result.push({ type: "text", text: before });
    if (!inserted) {
      result.push(token);
      inserted = true;
    }
    if (after) result.push({ type: "text", text: after });
  }

  if (!inserted) result.push(token);
  return compactComposerParts(result);
}

export function removeComposerPart(parts: readonly ComposerPart[], tokenId: string): ComposerPart[] {
  return compactComposerParts(parts.filter((part) => part.type === "text" || part.id !== tokenId));
}

export function replaceComposerTextRange(parts: readonly ComposerPart[], range: ComposerTextRange, replacement: string): ComposerPart[] {
  const result: ComposerPart[] = [];
  let textCursor = 0;
  let inserted = false;

  for (const part of parts) {
    if (part.type !== "text") {
      if (!inserted && textCursor >= range.end) {
        result.push({ type: "text", text: replacement });
        inserted = true;
      }
      result.push(part);
      continue;
    }

    const partStart = textCursor;
    const partEnd = partStart + part.text.length;
    textCursor = partEnd;

    if (partEnd <= range.start) {
      result.push(part);
      continue;
    }

    if (partStart >= range.end) {
      if (!inserted) {
        result.push({ type: "text", text: replacement });
        inserted = true;
      }
      result.push(part);
      continue;
    }

    const before = part.text.slice(0, Math.max(0, range.start - partStart));
    const after = part.text.slice(Math.max(0, range.end - partStart));
    if (before) result.push({ type: "text", text: before });
    if (!inserted) {
      result.push({ type: "text", text: replacement });
      inserted = true;
    }
    if (after) result.push({ type: "text", text: after });
  }

  if (!inserted) result.push({ type: "text", text: replacement });
  return compactComposerParts(result);
}

export function compactComposerParts(parts: readonly ComposerPart[]): ComposerPart[] {
  const result: ComposerPart[] = [];
  for (const part of parts) {
    const previous = result.at(-1);
    if (part.type === "text" && part.text.length === 0) continue;
    if (part.type === "text" && previous?.type === "text") {
      previous.text += part.text;
      continue;
    }
    result.push({ ...part });
  }
  return result.length ? result : [{ type: "text", text: "" }];
}
