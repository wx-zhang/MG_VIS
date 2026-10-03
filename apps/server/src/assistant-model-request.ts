/** Transport diagnostics contain only bounded metadata, never prompts, replies, or reasoning. */
export type AssistantModelRequestMetrics = {
  model: string;
  endpointHost: string;
  modelTurn: number;
  phase: "headers" | "body" | "total_budget";
  outcome: "completed" | "failed";
  /** Present only when this Boolean was actually included in the outgoing request body. */
  enableThinking?: boolean;
  finishReason?: "stop" | "length" | "tool_calls" | "function_call" | "content_filter" | "other";
  status?: number;
  requestId?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  };
  requestElapsedMs: number;
  headerElapsedMs?: number;
  bodyElapsedMs?: number;
  toolWaitElapsedMs: number;
  requestBytes: number;
  responseBytes?: number;
};

export type AssistantModelRequestObserver = (metrics: AssistantModelRequestMetrics) => void;

export class AssistantModelRequestError extends Error {
  constructor(
    message: string,
    readonly code: "assistant_model_timeout" | "assistant_provider_error",
    readonly modelTurn: number,
    readonly elapsedMs: number,
    readonly metrics: AssistantModelRequestMetrics
  ) {
    super(message);
    this.name = "AssistantModelRequestError";
  }
}

export function notifyAssistantModelRequest(
  observer: AssistantModelRequestObserver | undefined,
  metrics: AssistantModelRequestMetrics
): void {
  try { observer?.(metrics); } catch { /* Diagnostics cannot alter model or tool outcomes. */ }
}

export function assistantModelSafeLabel(value: string, fallback: string): string {
  return value.length <= 128 && /^[a-zA-Z0-9._:/-]+$/.test(value) ? value : fallback;
}

export function assistantModelEndpointHost(baseUrl: string): string {
  try { return new URL(baseUrl).hostname.toLowerCase(); } catch { return "invalid-endpoint"; }
}

/** Only the official, confirmed Qwen family receives this non-standard provider option. */
export function assistantModelThinkingBody(
  baseUrl: string,
  model: string,
  enableThinking: boolean | undefined
): { enable_thinking?: boolean } {
  if (typeof enableThinking !== "boolean" ||
      !["qwen3.7-plus", "qwen3.7-plus-2026-05-26"].includes(model)) return {};
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "https:" && !url.port && !url.username && !url.password && !url.search && !url.hash &&
        url.hostname.toLowerCase() === "dashscope.aliyuncs.com" &&
        url.pathname.replace(/\/$/, "") === "/compatible-mode/v1") {
      return { enable_thinking: enableThinking };
    }
  } catch { /* Invalid endpoints are handled by the request transport. */ }
  return {};
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function responseMetadata(body: string): Pick<AssistantModelRequestMetrics, "requestId" | "usage" | "finishReason"> {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const requestId = typeof parsed.id === "string" ? assistantModelSafeLabel(parsed.id, "") : "";
    const choice = Array.isArray(parsed.choices) && parsed.choices[0] && typeof parsed.choices[0] === "object"
      ? parsed.choices[0] as Record<string, unknown> : {};
    const finishReason = typeof choice.finish_reason === "string"
      ? ["stop", "length", "tool_calls", "function_call", "content_filter"].includes(choice.finish_reason)
        ? choice.finish_reason as NonNullable<AssistantModelRequestMetrics["finishReason"]> : "other"
      : undefined;
    const source = parsed.usage && typeof parsed.usage === "object" && !Array.isArray(parsed.usage)
      ? parsed.usage as Record<string, unknown> : {};
    const details = source.completion_tokens_details && typeof source.completion_tokens_details === "object"
      ? source.completion_tokens_details as Record<string, unknown> : {};
    const usage = {
      ...(tokenCount(source.prompt_tokens) !== undefined ? { promptTokens: tokenCount(source.prompt_tokens) } : {}),
      ...(tokenCount(source.completion_tokens) !== undefined ? { completionTokens: tokenCount(source.completion_tokens) } : {}),
      ...(tokenCount(source.total_tokens) !== undefined ? { totalTokens: tokenCount(source.total_tokens) } : {}),
      ...(tokenCount(details.reasoning_tokens) !== undefined ? { reasoningTokens: tokenCount(details.reasoning_tokens) } : {})
    };
    return { ...(requestId ? { requestId } : {}), ...(finishReason ? { finishReason } : {}),
      ...(Object.keys(usage).length ? { usage } : {}) };
  } catch { return {}; }
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError"));
}

export async function requestAssistantModelText(input: {
  baseUrl: string;
  model: string;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  modelTurn: number;
  loopStartedAt: number;
  toolWaitElapsedMs?: number;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  observer?: AssistantModelRequestObserver;
}): Promise<string> {
  const body = JSON.stringify(input.body);
  const startedAt = Date.now();
  const signal = AbortSignal.timeout(input.timeoutMs);
  let metrics: AssistantModelRequestMetrics = {
    model: assistantModelSafeLabel(input.model, "configured-model"),
    endpointHost: assistantModelEndpointHost(input.baseUrl),
    modelTurn: input.modelTurn,
    phase: "headers",
    outcome: "failed",
    ...(typeof input.body.enable_thinking === "boolean" ? { enableThinking: input.body.enable_thinking } : {}),
    requestElapsedMs: 0,
    toolWaitElapsedMs: input.toolWaitElapsedMs ?? 0,
    requestBytes: Buffer.byteLength(body)
  };
  try {
    const response = await input.fetchImpl(`${input.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body,
      signal
    });
    const headersAt = Date.now();
    const headerRequestId = response.headers?.get("x-request-id") ?? response.headers?.get("request-id") ?? "";
    metrics = {
      ...metrics,
      phase: "body",
      ...(Number.isInteger(response.status) ? { status: response.status } : {}),
      ...(assistantModelSafeLabel(headerRequestId, "") ? { requestId: headerRequestId } : {}),
      headerElapsedMs: headersAt - startedAt
    };
    const text = await response.text();
    const completedAt = Date.now();
    metrics = {
      ...metrics,
      ...responseMetadata(text),
      ...(metrics.requestId ? { requestId: metrics.requestId } : {}),
      outcome: response.ok ? "completed" : "failed",
      requestElapsedMs: completedAt - startedAt,
      bodyElapsedMs: completedAt - headersAt,
      responseBytes: Buffer.byteLength(text)
    };
    notifyAssistantModelRequest(input.observer, metrics);
    if (!response.ok) {
      throw new AssistantModelRequestError(
        `assistant_model_request_failed:${response.status}`, "assistant_provider_error",
        input.modelTurn, Date.now() - input.loopStartedAt, metrics
      );
    }
    return text;
  } catch (error) {
    if (error instanceof AssistantModelRequestError) throw error;
    metrics = {
      ...metrics,
      requestElapsedMs: Date.now() - startedAt,
      ...(metrics.headerElapsedMs !== undefined
        ? { bodyElapsedMs: Date.now() - startedAt - metrics.headerElapsedMs } : {})
    };
    notifyAssistantModelRequest(input.observer, metrics);
    const code = isTimeout(error, signal) ? "assistant_model_timeout" : "assistant_provider_error";
    throw new AssistantModelRequestError(code, code, input.modelTurn, Date.now() - input.loopStartedAt, metrics);
  }
}
