import type { RuntimeExecutionEventRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";

export type RuntimeAssistantOutputStatus = "running" | "completed" | "failed";

export interface RuntimeAssistantOutput {
  assistantBlockId: string;
  text: string;
  at: string;
  status: RuntimeAssistantOutputStatus;
  truncated: boolean;
}

export interface RuntimeAssistantOutputCoalescerOptions {
  previewIntervalMs: number;
  durableIntervalMs: number;
  durableLineInterval: number;
  maxChars?: number;
  maxLines?: number;
  onPreview: (execution: RuntimeExecutionRecord, output: RuntimeAssistantOutput) => void;
  onDurableOutput: (execution: RuntimeExecutionRecord, output: RuntimeAssistantOutput) => void;
}

const DEFAULT_MAX_ASSISTANT_OUTPUT_CHARS = 20_000;
const DEFAULT_MAX_ASSISTANT_OUTPUT_LINES = 400;

type AssistantBuffer = {
  assistantBlockId: string;
  text: string;
  truncated: boolean;
  lastAt: string;
  lastPreviewMs: number;
  lastDurableMs: number;
  lastDurableLineCount: number;
  lastDurableStatus?: RuntimeAssistantOutputStatus;
  dirty: boolean;
};

export class RuntimeAssistantOutputCoalescer {
  private readonly buffers = new Map<string, AssistantBuffer>();
  private readonly segmentCounters = new Map<string, number>();
  private readonly maxChars: number;
  private readonly maxLines: number;

  constructor(private readonly options: RuntimeAssistantOutputCoalescerOptions) {
    this.maxChars = positiveLimit(options.maxChars, DEFAULT_MAX_ASSISTANT_OUTPUT_CHARS);
    this.maxLines = positiveLimit(options.maxLines, DEFAULT_MAX_ASSISTANT_OUTPUT_LINES);
  }

  acceptDelta(execution: RuntimeExecutionRecord, event: RuntimeExecutionEventRecord): void {
    const delta = event.detail ?? "";
    if (!delta) return;
    const buffer = this.ensureBuffer(execution, event.at);
    const merged = mergeAssistantFrame(buffer.text, delta);
    const bounded = boundAssistantText(merged, this.maxChars, this.maxLines);
    buffer.text = bounded.text;
    buffer.truncated ||= bounded.truncated;
    buffer.lastAt = event.at;
    buffer.dirty = true;
    this.maybePreview(execution, buffer);
    this.maybeDurableCheckpoint(execution, buffer);
  }

  flush(
    execution: RuntimeExecutionRecord,
    options: { at: string; status?: RuntimeAssistantOutputStatus; clear?: boolean; force?: boolean }
  ): RuntimeAssistantOutput | null {
    const buffer = this.buffers.get(execution.id);
    const status = options.status ?? "running";
    if (!buffer || !buffer.text || (!buffer.dirty && !this.shouldForceDurable(buffer, status, options.force))) {
      if (options.clear) this.buffers.delete(execution.id);
      return null;
    }
    buffer.lastAt = options.at;
    const output = this.durableOutput(execution, buffer, status);
    if (options.clear) this.buffers.delete(execution.id);
    return output;
  }

  clear(executionId: string): void {
    this.buffers.delete(executionId);
  }

  private ensureBuffer(execution: RuntimeExecutionRecord, at: string): AssistantBuffer {
    const existing = this.buffers.get(execution.id);
    if (existing) return existing;
    const nextSegment = (this.segmentCounters.get(execution.id) ?? 0) + 1;
    this.segmentCounters.set(execution.id, nextSegment);
    const buffer: AssistantBuffer = {
      assistantBlockId: `assistant:${execution.id}:segment_${nextSegment}`,
      text: "",
      truncated: false,
      lastAt: at,
      lastPreviewMs: 0,
      lastDurableMs: Date.parse(at) || Date.now(),
      lastDurableLineCount: 0,
      dirty: false
    };
    this.buffers.set(execution.id, buffer);
    return buffer;
  }

  private maybePreview(execution: RuntimeExecutionRecord, buffer: AssistantBuffer): void {
    const atMs = Date.parse(buffer.lastAt);
    if (Number.isFinite(atMs) && buffer.lastPreviewMs && atMs - buffer.lastPreviewMs < this.options.previewIntervalMs) return;
    buffer.lastPreviewMs = Number.isFinite(atMs) ? atMs : Date.now();
    this.options.onPreview(execution, {
      assistantBlockId: buffer.assistantBlockId,
      text: buffer.text,
      at: buffer.lastAt,
      status: "running",
      truncated: buffer.truncated
    });
  }

  private maybeDurableCheckpoint(execution: RuntimeExecutionRecord, buffer: AssistantBuffer): void {
    const atMs = Date.parse(buffer.lastAt);
    const lineCount = countLines(buffer.text);
    const reachedLineInterval = lineCount - buffer.lastDurableLineCount >= this.options.durableLineInterval;
    const reachedTimeInterval = Number.isFinite(atMs) && buffer.lastDurableMs > 0 && atMs - buffer.lastDurableMs >= this.options.durableIntervalMs;
    if (!reachedLineInterval && !reachedTimeInterval) return;
    this.durableOutput(execution, buffer, "running");
  }

  private durableOutput(
    execution: RuntimeExecutionRecord,
    buffer: AssistantBuffer,
    status: RuntimeAssistantOutputStatus
  ): RuntimeAssistantOutput {
    const output = {
      assistantBlockId: buffer.assistantBlockId,
      text: buffer.text,
      at: buffer.lastAt,
      status,
      truncated: buffer.truncated
    };
    // durable checkpoint 代表“已稳定可回放”的累计文本，后续 token 继续追加在同一段。
    buffer.lastDurableMs = Date.parse(buffer.lastAt) || Date.now();
    buffer.lastDurableLineCount = countLines(buffer.text);
    buffer.lastDurableStatus = status;
    buffer.dirty = false;
    this.options.onDurableOutput(execution, output);
    return output;
  }

  private shouldForceDurable(buffer: AssistantBuffer, status: RuntimeAssistantOutputStatus, force?: boolean): boolean {
    if (!force) return false;
    if (status === "running") return false;
    return buffer.lastDurableStatus !== status;
  }
}

function countLines(text: string): number {
  if (!text) return 0;
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
}

function mergeAssistantFrame(current: string, incoming: string): string {
  if (!current) return incoming;
  // Some runtimes send cumulative text frames instead of token deltas; replace in that case to avoid quadratic growth.
  if (incoming.startsWith(current)) return incoming;
  // Once the local buffer is truncated, the retained tail can appear inside the next cumulative full frame.
  if (current.length > 1_000 && incoming.includes(current)) return incoming;
  return current + incoming;
}

function boundAssistantText(text: string, maxChars: number, maxLines: number): { text: string; truncated: boolean } {
  let next = text;
  let truncated = false;
  if (next.length > maxChars) {
    next = next.slice(-maxChars);
    truncated = true;
  }
  const lineBounded = takeLastLines(next, maxLines);
  if (lineBounded !== next) {
    next = lineBounded;
    truncated = true;
  }
  return { text: next, truncated };
}

function takeLastLines(text: string, maxLines: number): string {
  if (!text || maxLines <= 0) return "";
  let linesSeen = 1;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text.charCodeAt(index) !== 10) continue;
    linesSeen += 1;
    if (linesSeen > maxLines) return text.slice(index + 1);
  }
  return text;
}
