import {
  WEB_API_ENVELOPE_MEDIA_TYPE,
  isApiResponse,
  isApiSuccess,
  type ApiFailure,
  type ApiWarning
} from "@tyr-ai/contracts";
import {
  captureAuthContext,
  getAccessToken,
  getRefreshToken,
  isCurrentAuthContext,
  setAuthTokens,
  type AuthContextSnapshot
} from "./authStorage";

const appBasePath = import.meta.env?.BASE_URL || "/";
const apiBaseOverride = String(import.meta.env?.VITE_TYR_API_BASE || "").replace(/\/$/, "");
const realtimePathOverride = String(import.meta.env?.VITE_TYR_REALTIME_PATH || "");
const DEFAULT_API_TIMEOUT_MS = 30_000;
const DEFAULT_API_DIAGNOSTIC_SLOW_MS = 750;
const AUTH_REFRESH_TIMEOUT_MS = 15_000;
const AUTH_REFRESH_EXCLUDED_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/refresh",
  "/api/auth/register"
]);

type AuthTokenPair = { accessToken: string; refreshToken: string };

let refreshInFlight: { refreshToken: string; promise: Promise<boolean> } | null = null;
let lastRefreshTransition: { previousRefreshToken: string; nextRefreshToken: string } | null = null;

export type ApiRequestInit = RequestInit & {
  timeoutMs?: number;
  label?: string;
};

export const API_WARNING_EVENT = "tyr:api-warning";

export type ApiWarningEventDetail = ApiWarning & {
  path: string;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(input: { code: string; status?: number; message?: string; requestId?: string; details?: unknown }) {
    super(input.message || apiErrorMessageForCode(input.code, input.status ?? 0));
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status ?? 0;
    this.requestId = input.requestId;
    this.details = input.details;
  }
}

export function apiErrorMessage(error: unknown, fallback = "The request could not be completed. Please try again."): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function isStaleAuthContextError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "stale_auth_context";
}

export function publicPath(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = appBasePath.endsWith("/") ? appBasePath : appBasePath + "/";
  return base + path.replace(/^\//, "");
}

export function apiPath(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return apiBaseOverride ? apiBaseOverride + (path.startsWith("/") ? path : "/" + path) : publicPath(path);
}

export function realtimeUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const path = realtimePathOverride || publicPath("/socket.io/");
  return protocol + "://" + window.location.host + (path.startsWith("/") ? path : "/" + path) + "?EIO=4&transport=websocket";
}

export function authenticatedApiUrl(path: string): string {
  const accessToken = getAccessToken();
  const tokenQuery = accessToken ? (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(accessToken) : "";
  return apiPath(path + tokenQuery);
}

export function uploadAuthHeaders(): HeadersInit | undefined {
  const accessToken = getAccessToken();
  return accessToken ? { Authorization: "Bearer " + accessToken } : undefined;
}

export async function api<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const initialAuthContext = captureAuthContext();
  try {
    return await apiRequest<T>(path, init);
  } catch (error) {
    if (isStaleAuthContextError(error) && authContextWasAutomaticallyRefreshed(initialAuthContext)) {
      return apiRequest<T>(path, init);
    }
    if (!shouldRefreshAfter(error, path, initialAuthContext)) throw error;
    const refreshed = await refreshAuthSession(initialAuthContext.refreshToken!);
    if (!refreshed) throw error;
    return apiRequest<T>(path, init);
  }
}

export async function apiForm<T>(path: string, form: FormData, init: Omit<ApiRequestInit, "body"> & { method?: string } = {}): Promise<T> {
  const authContext = captureAuthContext();
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, label = path, headers, ...fetchInit } = init;
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error("api_timeout")), timeoutMs) : null;
  try {
    const response = await fetch(apiPath(path), {
      ...fetchInit,
      method: fetchInit.method ?? "POST",
      signal: controller.signal,
      headers: {
        Accept: WEB_API_ENVELOPE_MEDIA_TYPE,
        ...uploadAuthHeaders(),
        ...headers
      },
      body: form
    });
    const data = parseJsonBody(await response.text().catch(() => ""));
    assertCurrentAuthContext(authContext);
    return unwrapApiResponse<T>(data, response, label);
  } catch (error) {
    if (!isCurrentAuthContext(authContext)) throw staleAuthContextError();
    if (isAbortError(error)) throw new ApiError({ code: "api_timeout", status: 0 });
    if (error instanceof ApiError) throw error;
    throw new ApiError({ code: "network_error", status: 0, details: error });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function apiRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const authContext = captureAuthContext();
  const accessToken = authContext.accessToken;
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, label = path, ...fetchInit } = init ?? {};
  const timing = { start: nowMs(), headers: 0, body: 0, json: 0 };
  let timedOut = false;
  let timeoutHandle: number | ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();
  const cleanupAbortListeners: Array<() => void> = [];
  const abortFromCaller = () => controller.abort(fetchInit.signal?.reason);
  const abortFromTimeout = () => controller.abort(new Error("api_timeout"));
  if (fetchInit.signal) {
    if (fetchInit.signal.aborted) controller.abort(fetchInit.signal.reason);
    else {
      fetchInit.signal.addEventListener("abort", abortFromCaller, { once: true });
      cleanupAbortListeners.push(() => fetchInit.signal?.removeEventListener("abort", abortFromCaller));
    }
  }
  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortFromTimeout();
    }, timeoutMs);
  }
  try {
    const res = await fetch(apiPath(path), {
      ...fetchInit,
      signal: controller.signal,
      headers: {
        Accept: WEB_API_ENVELOPE_MEDIA_TYPE,
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
        ...fetchInit.headers
      }
    });
    timing.headers = nowMs();
    const text = await res.text().catch(() => "");
    timing.body = nowMs();
    const data = parseJsonBody(text);
    timing.json = nowMs();
    assertCurrentAuthContext(authContext);
    warnIfSlowApiRequest(label, path, timing);
    return unwrapApiResponse<T>(data, res, path);
  } catch (err) {
    if (!isCurrentAuthContext(authContext)) throw staleAuthContextError();
    if (timedOut) throw new ApiError({ code: "api_timeout", status: 0 });
    if (err instanceof ApiError || isAbortError(err)) throw err;
    throw new ApiError({ code: "network_error", status: 0, details: err });
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    for (const cleanup of cleanupAbortListeners) cleanup();
  }
}

function shouldRefreshAfter(error: unknown, path: string, context: AuthContextSnapshot): boolean {
  return error instanceof ApiError
    && error.status === 401
    && !AUTH_REFRESH_EXCLUDED_PATHS.has(path)
    && Boolean(context.accessToken && context.refreshToken)
    && isCurrentAuthContext(context);
}

function authContextWasAutomaticallyRefreshed(context: AuthContextSnapshot): boolean {
  return Boolean(
    context.refreshToken
    && lastRefreshTransition?.previousRefreshToken === context.refreshToken
    && getRefreshToken() === lastRefreshTransition.nextRefreshToken
  );
}

function refreshAuthSession(refreshToken: string): Promise<boolean> {
  if (refreshInFlight?.refreshToken === refreshToken) return refreshInFlight.promise;
  const request = performAuthRefresh(refreshToken);
  const tracked = request.finally(() => {
    if (refreshInFlight?.promise === tracked) refreshInFlight = null;
  });
  refreshInFlight = { refreshToken, promise: tracked };
  return tracked;
}

async function performAuthRefresh(refreshToken: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("api_timeout")), AUTH_REFRESH_TIMEOUT_MS);
  try {
    const response = await fetch(apiPath("/api/auth/refresh"), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: WEB_API_ENVELOPE_MEDIA_TYPE,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refreshToken })
    });
    const data = parseJsonBody(await response.text().catch(() => ""));
    if (response.status === 401) return false;
    const tokens = unwrapApiResponse<AuthTokenPair>(data, response, "/api/auth/refresh");
    if (getRefreshToken() !== refreshToken) throw staleAuthContextError();
    lastRefreshTransition = { previousRefreshToken: refreshToken, nextRefreshToken: tokens.refreshToken };
    setAuthTokens(tokens.accessToken, tokens.refreshToken);
    return true;
  } catch (error) {
    if (isAbortError(error)) throw new ApiError({ code: "api_timeout", status: 0 });
    if (error instanceof ApiError) throw error;
    throw new ApiError({ code: "network_error", status: 0, details: error });
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadAttachment(file: File, channelId: string): Promise<{ id: string }> {
  const authContext = captureAuthContext();
  const form = new FormData();
  form.append("file", file);
  form.append("channel", channelId);
  const res = await fetch(apiPath("/api/uploads"), {
    method: "POST",
    headers: {
      Accept: WEB_API_ENVELOPE_MEDIA_TYPE,
      ...uploadAuthHeaders()
    },
    body: form
  });
  const text = await res.text().catch(() => "");
  assertCurrentAuthContext(authContext);
  return unwrapApiResponse<{ id: string }>(parseJsonBody(text), res, "/api/uploads");
}

function parseJsonBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unwrapApiResponse<T>(data: unknown, res: Pick<Response, "ok" | "status" | "statusText">, path: string): T {
  if (!isApiResponse(data)) {
    throw new ApiError({
      code: "invalid_api_response",
      status: res.status,
      message: res.statusText || undefined
    });
  }
  if (!res.ok || !isApiSuccess(data)) {
    const failure = data as ApiFailure;
    throw new ApiError({
      code: failure.code === "ok" ? "invalid_api_response" : failure.code,
      status: res.status,
      message: failure.message,
      requestId: failure.requestId,
      details: failure.details
    });
  }
  if (data.warnings?.length) dispatchApiWarnings(data.warnings, path);
  return data.data as T;
}

function dispatchApiWarnings(warnings: ApiWarning[], path: string): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  for (const warning of warnings) {
    window.dispatchEvent(new CustomEvent<ApiWarningEventDetail>(API_WARNING_EVENT, {
      detail: { ...warning, path }
    }));
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function assertCurrentAuthContext(context: AuthContextSnapshot): void {
  if (!isCurrentAuthContext(context)) throw staleAuthContextError();
}

function staleAuthContextError(): ApiError {
  return new ApiError({
    code: "stale_auth_context",
    status: 0,
    message: "This request belongs to a previous sign-in session and was ignored."
  });
}

function apiErrorMessageForCode(code: string, status: number): string {
  const messages: Record<string, string> = {
    agent_create_fields_required: "Device, name, and CLI runtime are required.",
    approval_execution_terminal: "This approval belongs to an execution that has already ended. Refresh and request a new run.",
    approval_expired: "This approval has expired. Ask the Agent to request it again.",
    approval_governance_blocked: "Governance policy does not allow this approval.",
    approval_governance_required: "This approval is missing its Governance review. Ask the Agent to request it again.",
    approval_outbound_replay_failed: "The approved outbound action could not be replayed. Refresh and request it again.",
    api_timeout: "The request timed out. Please try again.",
    conflict: "The operation conflicts with the current state. Refresh and try again.",
    daemon_unavailable: "The device connector is unavailable. Start the daemon and try again.",
    daemon_unavailable_for_safe_rotation: "The device disconnected before it could receive the new connector token. Start the daemon and try again.",
    daemon_update_required_for_safe_rotation: "Update and restart this device's daemon before regenerating its connector token.",
    internal_error: "The server encountered an error. Please try again.",
    invalid_api_response: "The server returned an invalid response. Refresh and try again.",
    machine_not_found: "The selected device could not be found.",
    machine_offline: "The selected device is offline. Start the daemon and try again.",
    mcp_access_token_expiration_invalid: "Choose a token expiration of 30 days, 90 days, or 1 year.",
    mcp_access_token_failed: "The personal access token request could not be completed.",
    mcp_access_token_inactive: "This personal access token is already expired or revoked.",
    mcp_access_token_limit_reached: "This workspace already has the maximum of 10 active personal access tokens for your account.",
    mcp_access_token_manage_forbidden: "Guest accounts can create read-only TYR tokens only.",
    mcp_access_token_name_required: "Enter a name for this personal access token.",
    mcp_access_token_name_too_long: "The token name must be 80 characters or fewer.",
    mcp_access_token_not_found: "This personal access token could not be found.",
    mcp_access_token_scopes_invalid: "Choose a supported TYR access level.",
    model_not_available: "The selected model is not available on this device.",
    invalid_operator_credentials: "The Operator login or password is incorrect.",
    operator_audit_metadata_required: "Enter an audit reason and reference before changing an Agent.",
    operator_login_rate_limited: "Too many Operator sign-in attempts. Wait 15 minutes and try again.",
    operator_unauthorized: "The Operator session has expired. Sign in again.",
    network_error: "Unable to reach the server. Check your connection and try again.",
    not_found: "The requested item could not be found.",
    payload_too_large: "The selected file or request is too large.",
    permission_denied: "You do not have permission to perform this action.",
    rate_limited: "Too many requests. Wait a moment and try again.",
    runtime_not_supported: "The selected CLI runtime is not supported.",
    runtime_access_read_only: "Read Only Runtime Access cannot be elevated through an approval.",
    runtime_read_only_enforcement_unavailable: "Update and restart this device's daemon before using Read Only Runtime Access.",
    runtime_read_only_unsupported: "This CLI runtime does not support hard Read Only Runtime Access.",
    runtime_unavailable: "The selected CLI runtime is not available on this device.",
    incompatible_runtime_resource_grant: "Read Only Runtime Access cannot include a folder write grant.",
    signup_completed: "This signup link has already been used.",
    signup_expired: "This signup link has expired.",
    signup_invalid: "This signup link is unavailable.",
    signup_invalid_registration: "Check the account details and try again.",
    assistant_dm_thread_read_only: "TYR threads are read-only. Continue in the main conversation.",
    thread_dm_only: "Threads can only be started from direct messages with Runtime Agents.",
    thread_not_supported_for_assistant_dm: "Threads are not available in TYR conversations.",
    invalid_current_password: "Current password is incorrect.",
    recovery_completed: "This password reset link has already been used.",
    recovery_expired: "This password reset link has expired.",
    recovery_invalid: "This password reset link is unavailable.",
    recovery_invalid_password: "The password does not meet the account requirements.",
    service_unavailable: "The service is temporarily unavailable. Please try again.",
    stale_auth_context: "This request belongs to a previous sign-in session and was ignored.",
    unauthorized: "Your session has expired. Sign in again.",
    unsupported_attachment_type: "This attachment type is not supported.",
    unsupported_media_type: "This file or request format is not supported.",
    validation_failed: "Check the entered information and try again.",
    invalid_email_alias: "Use 3–32 letters, numbers, or hyphens. Start and end with a letter or number.",
    reserved_email_alias: "This email name is reserved. Choose another name.",
    email_alias_taken: "This email address is already taken. Choose another name.",
    email_alias_changed: "The address changed elsewhere. Close and reopen the editor to review the current address.",
    server_owner_required: "Only the Workspace Owner can make this change.",
    workspace_bridge_member_required: "Guest accounts cannot access workspace connections. Use a workspace owner or member account.",
    workspace_bridge_owner_required: "Only owners can revoke workspace connections. Sign in as an owner of this workspace.",
    workspace_bridge_not_found: "The workspace connection could not be found. Refresh and try again."
  };
  if (messages[code]) return messages[code];
  if (status >= 500) return messages.internal_error;
  return "The request could not be completed. Please try again.";
}

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function warnIfSlowApiRequest(label: string, path: string, timing: { start: number; headers: number; body: number; json: number }): void {
  if (!apiDiagnosticsEnabled()) return;
  const totalMs = timing.json - timing.start;
  const slowMs = apiDiagnosticsSlowMs();
  if (totalMs < slowMs) return;
  const headersMs = timing.headers - timing.start;
  const bodyMs = timing.body - timing.headers;
  const jsonMs = timing.json - timing.body;
  console.warn(`[api] slow ${label} path=${path} headersMs=${headersMs.toFixed(1)} bodyMs=${bodyMs.toFixed(1)} jsonMs=${jsonMs.toFixed(1)} totalMs=${totalMs.toFixed(1)}`);
}

function apiDiagnosticsEnabled(): boolean {
  return Boolean(import.meta.env?.DEV) || Boolean((globalThis as typeof globalThis & { __TYR_API_DIAGNOSTICS__?: boolean }).__TYR_API_DIAGNOSTICS__);
}

function apiDiagnosticsSlowMs(): number {
  const override = (globalThis as typeof globalThis & { __TYR_API_DIAGNOSTICS_SLOW_MS__?: number }).__TYR_API_DIAGNOSTICS_SLOW_MS__;
  return Number.isFinite(override) ? Number(override) : DEFAULT_API_DIAGNOSTIC_SLOW_MS;
}
