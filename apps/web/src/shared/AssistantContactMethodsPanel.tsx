import { Check, Copy, Mail, MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AgentRecord, TyrEmailSettings } from "@tyr-ai/contracts";

import { assistantContactMethodsForAgent, type AssistantContactMethod, type AssistantTelegramStatus } from "../assistantContactMethods";
import { api } from "../lib/api";
import { copyMessageText } from "../app/workspaceUtils";
import { AssistantEmailEditor } from "./AssistantEmailEditor";

export function AssistantContactMethodsPanel({ agent, variant = "workspace" }: { agent: AgentRecord; variant?: "workspace" | "inspector" }) {
  const [telegramStatus, setTelegramStatus] = useState<AssistantTelegramStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [copiedMethodId, setCopiedMethodId] = useState("");
  const [email, setEmail] = useState<{ agentId: string; settings: TyrEmailSettings } | null>(null);
  const emailSettings = email?.agentId === agent.id ? email.settings : null;
  const methods = useMemo(() => assistantContactMethodsForAgent({ ...agent,
    communicationEmailAddress: emailSettings?.address ?? agent.communicationEmailAddress
  }, telegramStatus), [agent, telegramStatus, emailSettings]);

  useEffect(() => {
    let active = true;
    setEmail(null);
    setCopiedMethodId("");
    void api<TyrEmailSettings>(`/api/agents/${encodeURIComponent(agent.id)}/email`)
      .then((settings) => { if (active) setEmail({ agentId: agent.id, settings }); })
      .catch(() => { /* The address remains visible when management is unavailable or not permitted. */ });
    return () => { active = false; };
  }, [agent.id, agent.communicationEmailAddress]);

  useEffect(() => {
    let active = true;

    async function loadTelegramStatus() {
      try {
        const payload = await api<AssistantTelegramStatus>("/api/integrations/telegram/account");
        if (!active) return;
        setTelegramStatus(payload);
        setStatusMessage("");
      } catch (error) {
        if (!active) return;
        setTelegramStatus({ enabled: false, botUsername: null, account: null });
        setStatusMessage(error instanceof Error ? error.message : "Telegram status unavailable.");
      }
    }

    void loadTelegramStatus();
    return () => {
      active = false;
    };
  }, [agent.id]);

  async function copyMethod(method: AssistantContactMethod) {
    if (!method.copyValue) return;
    try {
      await copyMessageText(method.copyValue);
      setCopiedMethodId(method.id);
      setStatusMessage("Address copied.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Copy failed.");
    }
  }

  if (methods.length === 0) return null;

  return (
    <section id="agent-contact-methods" className={`assistant-contact-panel ${variant === "inspector" ? "inspector-section-card" : "info-block"}`}>
      <div className={variant === "inspector" ? "inspector-section-head assistant-contact-head" : "assistant-contact-head"}>
        <h3>Contact TYR</h3>
      </div>
      <div className="assistant-contact-list">
        {methods.map((method) => (
          <div key={method.id} className={`assistant-contact-method-row ${method.status}`}>
            <span className="assistant-contact-method-icon" aria-label={method.id === "email" ? "Email" : "Telegram"}>
              {method.id === "email" ? <Mail size={17} /> : <MessageSquare size={17} />}
            </span>
            <span className="assistant-contact-method-main">
              <b>{method.label}</b>
              <strong>{method.value}</strong>
              <small>{method.detail}</small>
            </span>
            <span className="assistant-contact-method-actions">
              <span className={`assistant-contact-status ${method.status}`}>{contactStatusLabel(method.status)}</span>
              {method.copyValue && (
                <button className="assistant-contact-copy-button" type="button" onClick={() => void copyMethod(method)}>
                  {copiedMethodId === method.id ? <Check size={14} /> : <Copy size={14} />} Copy address
                </button>
              )}
            </span>
            {method.id === "email" && emailSettings?.canCustomize && <div className="assistant-email-management">
              <AssistantEmailEditor key={agent.id} agentId={agent.id} settings={emailSettings} onSaved={(settings) => {
                setEmail({ agentId: agent.id, settings });
                setCopiedMethodId("");
                setStatusMessage("Email address updated. Previous addresses still work.");
              }} />
            </div>}
          </div>
        ))}
      </div>
      {statusMessage && <p className="assistant-contact-panel-status" role="status">{statusMessage}</p>}
    </section>
  );
}

function contactStatusLabel(status: AssistantContactMethod["status"]): string {
  if (status === "connected") return "Connected";
  if (status === "available") return "Available";
  return "Unavailable";
}
