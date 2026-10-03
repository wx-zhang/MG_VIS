import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import type { DeploymentNotice } from "@tyr-ai/contracts";
import { api } from "../lib/api";
import { deploymentNoticeText } from "../deploymentNotice";
import "../styles/deployment-notice.css";

export function DeploymentNoticeBanner({ text }: { text: string | null }) {
  return text ? <div className="deployment-notice" role="status" aria-live="polite" aria-atomic="true">
    <Info size={18} aria-hidden="true" /><span>{text}</span>
  </div> : null;
}

export function DeploymentNoticeFrame({ children, staticMode = false }: { children: ReactNode; staticMode?: boolean }) {
  const [notice, setNotice] = useState<DeploymentNotice | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(Date.now);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (staticMode) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const result = await api<{ notice: DeploymentNotice | null }>("/api/deployment-notice", {
          timeoutMs: 5_000, cache: "no-store", signal: controller.signal
        });
        if (!stopped) { setNotice(result.notice); setUnavailable(false); }
      } catch {
        // Keep the last notice across a short restart; a failed fetch never means success.
        if (!stopped) setUnavailable(true);
      } finally {
        if (!stopped) { setNow(Date.now()); timer = setTimeout(poll, 10_000); }
      }
    };
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [staticMode]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(([entry]) => {
      content.style.setProperty("--app-viewport-height", `${entry.contentRect.height}px`);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return <div className="deployment-frame">
    <DeploymentNoticeBanner text={deploymentNoticeText(notice, unavailable, now)} />
    <div className="deployment-content" ref={contentRef}>{children}</div>
  </div>;
}
