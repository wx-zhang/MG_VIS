import { AlertTriangle, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { API_WARNING_EVENT, ApiError, apiErrorMessage, isStaleAuthContextError, type ApiWarningEventDetail } from "../lib/api";

type ApiNotice = {
  id: number;
  tone: "error" | "warning";
  title: string;
  message: string;
  requestId?: string;
};

const NOTICE_LIFETIME_MS = 6_000;

export function ApiFeedbackProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<ApiNotice[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    const enqueue = (notice: Omit<ApiNotice, "id">) => {
      const id = nextId.current++;
      setNotices((current) => [...current.slice(-2), { id, ...notice }]);
      window.setTimeout(() => {
        setNotices((current) => current.filter((item) => item.id !== id));
      }, NOTICE_LIFETIME_MS);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!(event.reason instanceof ApiError)) return;
      event.preventDefault();
      // 认证切换主动淘汰的旧请求不是用户操作失败，不显示全局错误。
      if (isStaleAuthContextError(event.reason)) return;
      enqueue({
        tone: "error",
        title: "Action failed",
        message: apiErrorMessage(event.reason),
        requestId: event.reason.requestId
      });
    };
    const onWarning = (event: Event) => {
      const warning = (event as CustomEvent<ApiWarningEventDetail>).detail;
      if (!warning?.code) return;
      enqueue({
        tone: "warning",
        title: "Completed with a warning",
        message: warning.message || warningMessage(warning.code)
      });
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener(API_WARNING_EVENT, onWarning);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener(API_WARNING_EVENT, onWarning);
    };
  }, []);

  return (
    <>
      {children}
      {notices.length > 0 && (
        <div className="api-feedback-stack" aria-live="polite" aria-atomic="false">
          {notices.map((notice) => (
            <div key={notice.id} className={`api-feedback-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>{notice.title}</strong>
                <p>{notice.message}</p>
                {notice.requestId && <small>Reference: {notice.requestId}</small>}
              </div>
              <button type="button" aria-label="Dismiss notification" onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}>
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function warningMessage(code: string): string {
  const messages: Record<string, string> = {
    agent_restart_not_delivered: "The changes were saved, but the agent could not be restarted.",
    workspace_sync_failed: "The changes were saved, but workspace synchronization failed."
  };
  return messages[code] || "The operation completed, but follow-up action may be required.";
}
