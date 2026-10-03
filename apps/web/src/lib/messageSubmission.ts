import { api, ApiError } from "./api";
import { captureAuthContext, isCurrentAuthContext } from "./authStorage";

export interface MessageSubmissionReceipt {
  id: string;
  channelId: string;
  conversationId?: string;
  submission: { clientRequestId: string; state: "queued" | "running" | "dispatched" | "interrupted" };
}

const pendingKeys = new Map<string, string>();
const inFlight = new Map<string, Promise<MessageSubmissionReceipt>>();

/** An unconfirmed retry keeps its identity; a confirmed, independent send gets a new one even with identical text. */
export async function submitMessage(userId: string, payload: object): Promise<MessageSubmissionReceipt> {
  const authContext = captureAuthContext();
  const body = JSON.stringify(payload);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  if (!isCurrentAuthContext(authContext)) throw new ApiError({ code: "stale_auth_context" });
  const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  // Only the opaque key and a payload digest survive refresh; message text and credentials are never stored here.
  const storageKey = `tyr-message-submission:${userId}:${fingerprint}`;
  const running = inFlight.get(storageKey);
  if (running) return running;
  let saved: string | null = null;
  try { saved = sessionStorage.getItem(storageKey); } catch { /* private storage may be unavailable */ }
  const clientRequestId = pendingKeys.get(storageKey) ?? (saved && /^[A-Za-z0-9_-]{1,128}$/.test(saved) ? saved : null) ?? crypto.randomUUID();
  pendingKeys.set(storageKey, clientRequestId);
  try { sessionStorage.setItem(storageKey, clientRequestId); } catch { /* retain the in-memory identity */ }
  const clear = () => {
    pendingKeys.delete(storageKey);
    try { sessionStorage.removeItem(storageKey); } catch { /* optional storage */ }
  };
  const request = (async () => {
    try {
      const receipt = await api<MessageSubmissionReceipt>("/api/messages", {
        method: "POST", body: JSON.stringify({ ...payload, clientRequestId })
      });
      validateReceipt(receipt, clientRequestId);
      clear();
      return receipt;
    } catch (error) {
      if (error instanceof ApiError && (error.code === "stale_auth_context" || error.status === 401)) throw error;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== "invalid_api_response") {
        clear();
        throw error;
      }
      // A timeout/non-JSON response says nothing about whether the write committed. Reconcile; never resend automatically.
      try {
        const receipt = await api<MessageSubmissionReceipt>(`/api/message-submissions/${encodeURIComponent(clientRequestId)}`, { timeoutMs: 5_000 });
        validateReceipt(receipt, clientRequestId);
        clear();
        return receipt;
      } catch (lookupError) {
        if (lookupError instanceof ApiError && (lookupError.code === "stale_auth_context" || lookupError.status === 401)) throw lookupError;
        throw new ApiError({ code: "message_submission_unconfirmed", requestId: clientRequestId,
          message: "Delivery could not be confirmed. Your draft is preserved. Sending the same draft again will check the same request." });
      }
    }
  })().finally(() => { inFlight.delete(storageKey); });
  inFlight.set(storageKey, request);
  return request;
}

function validateReceipt(receipt: MessageSubmissionReceipt, clientRequestId: string): void {
  if (!receipt || typeof receipt.id !== "string" || receipt.submission?.clientRequestId !== clientRequestId) {
    throw new ApiError({ code: "invalid_api_response" });
  }
}
