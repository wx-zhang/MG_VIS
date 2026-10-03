import { ArrowRight, ArrowUp, Bot, MessageCircle, RefreshCw, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { HelpdeskSignupRequestPublicPayload } from "@tyr-ai/contracts";
import { api } from "../lib/api";
import { useLocation } from "react-router-dom";

export function HelpdeskSignupAgentPanel() {
  const location = useLocation();
  // Helpdesk signup is a platform-level pre-auth assistant, not a workspace Agent.
  const [isOpen, setIsOpen] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [draft, setDraft] = useState("");
  const [submittedMessage, setSubmittedMessage] = useState("");
  const [result, setResult] = useState<HelpdeskSignupRequestPublicPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hasConversation = Boolean(submittedMessage || result || error);

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  function clearCloseTimer() {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function openPanel() {
    clearCloseTimer();
    setIsClosing(false);
    setIsOpen(true);
  }

  function closePanel() {
    if (isClosing) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    clearCloseTimer();
    if (reduceMotion) {
      setIsClosing(false);
      setIsOpen(false);
      return;
    }
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      closeTimerRef.current = null;
    }, 170);
  }

  async function requestSignup() {
    const requestedMessage = draft.trim();
    if (!requestedMessage) return;
    setBusy(true);
    setError("");
    setResult(null);
    setSubmittedMessage(requestedMessage);
    try {
      const data = await api<HelpdeskSignupRequestPublicPayload>("/api/helpdesk/signup-requests", {
        method: "POST",
        body: JSON.stringify({ message: requestedMessage,
          returnPath: signupInvitationReturnPath(new URLSearchParams(location.search).get("next")) })
      });
      setResult(data);
      if (data.status === "sent") setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startNewRequest() {
    setDraft("");
    setSubmittedMessage("");
    setResult(null);
    setError("");
    inputRef.current?.focus();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void requestSignup();
  }

  return (
    <aside className={`auth-helpdesk-widget ${isOpen ? "open" : "collapsed"} ${isClosing ? "closing" : ""}`} aria-label="Helpdesk Signup Agent">
      {!isOpen && (
        <button className="auth-helpdesk-launcher" type="button" aria-label="Open Helpdesk Signup Agent" onClick={openPanel}>
          <MessageCircle size={27} />
        </button>
      )}
      {isOpen && (
        <section className={`auth-helpdesk-drawer ${isClosing ? "closing" : ""}`} role="dialog" aria-label="Helpdesk Signup Agent">
          <div className="auth-helpdesk-drawer-head">
            <div className="auth-helpdesk-agent-id">
              <span className="auth-helpdesk-mark"><Bot size={18} /></span>
              <div>
                <b>Helpdesk Signup Agent</b>
                <p><span className="auth-helpdesk-status" /> Online</p>
              </div>
            </div>
            <div className="auth-helpdesk-drawer-tools">
              {hasConversation && (
                <button type="button" aria-label="Start over" title="Start over" disabled={busy} onClick={startNewRequest}>
                  <RotateCcw size={19} />
                </button>
              )}
              <button type="button" aria-label="Close Helpdesk Signup Agent" title="Close" onClick={closePanel}>
                <X size={22} />
              </button>
            </div>
          </div>
          <div className="auth-helpdesk-conversation" aria-live="polite">
            <div className="auth-helpdesk-message agent">
              <span className="auth-helpdesk-bubble-icon"><Bot size={13} /></span>
              <p>Tyr signup is invite-only right now. Send your email and I will prepare the next step.</p>
            </div>
            {submittedMessage && (
              <div className="auth-helpdesk-message user">
                <p>{submittedMessage}</p>
              </div>
            )}
            {busy && (
              <div className="auth-helpdesk-message agent working">
                <span className="auth-helpdesk-bubble-icon"><RefreshCw size={13} /></span>
                <p>Checking signup access...</p>
              </div>
            )}
            {result && <HelpdeskSignupResult result={result} />}
            {error && (
              <div className="auth-helpdesk-message agent error">
                <span className="auth-helpdesk-bubble-icon"><Bot size={13} /></span>
                <p>{error}</p>
              </div>
            )}
          </div>
          <div className="auth-helpdesk-composer">
            <input
              ref={inputRef}
              className="auth-helpdesk-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              autoComplete="off"
              type="text"
              placeholder="Ask for signup access"
              aria-label="Signup request message"
            />
            <button className={`auth-helpdesk-send ${busy ? "busy" : ""}`} type="button" aria-label="Send signup request" disabled={busy || !draft.trim()} onClick={() => void requestSignup()}>
              {busy ? <RefreshCw size={18} /> : <ArrowUp size={18} />}
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}

export function signupInvitationReturnPath(value: string | null): string | undefined {
  return value && /^\/bridge\/connect\/[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

function HelpdeskSignupResult({ result }: { result: HelpdeskSignupRequestPublicPayload }) {
  if (result.status === "sent") {
    return (
      <div className="auth-helpdesk-message agent sent">
        <span className="auth-helpdesk-bubble-icon"><Bot size={13} /></span>
        <div>
          <p>Signup link ready{result.email ? ` for ${result.email}` : ""}.</p>
          {result.confirmationUrl && (
            <a className="auth-helpdesk-link" href={result.confirmationUrl}>
              Open confirmation link <ArrowRight size={15} />
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`auth-helpdesk-message agent ${result.status}`}>
      <span className="auth-helpdesk-bubble-icon"><Bot size={13} /></span>
      <p>{result.replyText}</p>
    </div>
  );
}
