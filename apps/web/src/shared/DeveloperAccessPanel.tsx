import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  Code2,
  Copy,
  FileJson2,
  Globe2,
  KeyRound,
  LogIn,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2
} from "lucide-react";
import type {
  McpPersonalAccessTokenExpirationDays,
  McpPersonalAccessTokenRecord,
  McpPersonalAccessTokenScope
} from "@tyr-ai/contracts";
import { copyMessageText } from "../app/workspaceUtils";
import { api, apiErrorMessage } from "../lib/api";
import { confirmDialog } from "./confirmDialog";
import { Modal } from "./ui";

const DEFAULT_EXPIRATION_DAYS: McpPersonalAccessTokenExpirationDays = 90;

export const MCP_PAT_EXPIRATION_OPTIONS: ReadonlyArray<{
  days: McpPersonalAccessTokenExpirationDays;
  label: string;
  description: string;
  recommended?: boolean;
}> = [
  { days: 30, label: "30 days", description: "Short-term or temporary access" },
  { days: 90, label: "90 days", description: "Recommended for regular use", recommended: true },
  { days: 365, label: "1 year", description: "Long-lived access; rotate regularly" }
];

export function mcpConfig(resource: string): string {
  return JSON.stringify({
    mcpServers: {
      "tyr-assistant": {
        type: "http",
        url: resource,
        headers: {
          Authorization: "Bearer ${TYR_MCP_TOKEN}"
        }
      }
    }
  }, null, 2);
}

export function mcpAuthorizationHeader(): string {
  return "Authorization: Bearer ${TYR_MCP_TOKEN}";
}

export function codexPatConfig(resource: string): string {
  return [
    '[mcp_servers."tyr-assistant"]',
    `url = ${JSON.stringify(resource)}`,
    'bearer_token_env_var = "TYR_MCP_TOKEN"'
  ].join("\n");
}

export function codexOAuthConfig(resource: string): string {
  return [
    '[mcp_servers."tyr-assistant"]',
    `url = ${JSON.stringify(resource)}`,
    'auth = "oauth"'
  ].join("\n");
}

export function claudeOAuthCommand(resource: string): string {
  return `claude mcp add --transport http --scope user tyr-assistant ${JSON.stringify(resource)}`;
}

export function expirationTimestamp(
  days: McpPersonalAccessTokenExpirationDays,
  now = Date.now()
): number {
  return now + days * 24 * 60 * 60 * 1000;
}

type TokenEditor =
  | { mode: "create" }
  | { mode: "rotate"; token: McpPersonalAccessTokenRecord };

type CopyTarget =
  | "token"
  | "environment"
  | "token-endpoint"
  | "authorization"
  | "claude-config"
  | "codex-pat-config"
  | "overview-endpoint"
  | "oauth-endpoint"
  | "codex-oauth-config"
  | "codex-login"
  | "claude-oauth";
type CopyStatus = "copied" | "failed";
type SetupClient = "generic" | "codex" | "claude";
type OAuthSetupClient = "chatgpt" | "codex" | "claude" | "generic";

function tokenState(token: McpPersonalAccessTokenRecord): "active" | "expired" | "revoked" {
  if (token.revokedAt) return "revoked";
  return new Date(token.expiresAt).getTime() <= Date.now() ? "expired" : "active";
}

function lifecycleLabel(value: string | null, empty: string): string {
  if (!value) return empty;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function expirationDateLabel(days: McpPersonalAccessTokenExpirationDays): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(expirationTimestamp(days)));
}

function ExpirationPicker({
  value,
  onChange
}: {
  value: McpPersonalAccessTokenExpirationDays;
  onChange: (value: McpPersonalAccessTokenExpirationDays) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, MCP_PAT_EXPIRATION_OPTIONS.findIndex((option) => option.days === value));
  const selected = MCP_PAT_EXPIRATION_OPTIONS[selectedIndex];

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      // The menu lives inside a scrolling modal, so outside-click handling is scoped to this picker.
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function focusOption(index: number) {
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  }

  function openAndFocus(index: number) {
    setOpen(true);
    focusOption(index);
  }

  function selectOption(days: McpPersonalAccessTokenExpirationDays) {
    onChange(days);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="developer-expiration-picker" ref={rootRef}>
      <button
        id="mcp-token-expiration"
        ref={triggerRef}
        className={`developer-expiration-trigger${open ? " open" : ""}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="mcp-token-expiration-options"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openAndFocus(selectedIndex);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openAndFocus(selectedIndex);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span>
          <b>{selected.label}</b>
          <small>{selected.description}</small>
        </span>
        {selected.recommended && <em>Recommended</em>}
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {open && (
        <div id="mcp-token-expiration-options" className="developer-expiration-menu" role="listbox" aria-label="Token expiration">
          {MCP_PAT_EXPIRATION_OPTIONS.map((option, index) => (
            <button
              key={option.days}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              className={option.days === value ? "selected" : ""}
              type="button"
              role="option"
              aria-selected={option.days === value}
              onClick={() => selectOption(option.days)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusOption((index + 1) % MCP_PAT_EXPIRATION_OPTIONS.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusOption((index - 1 + MCP_PAT_EXPIRATION_OPTIONS.length) % MCP_PAT_EXPIRATION_OPTIONS.length);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  focusOption(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  focusOption(MCP_PAT_EXPIRATION_OPTIONS.length - 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  triggerRef.current?.focus();
                }
              }}
            >
              <span>
                <b>{option.label}</b>
                <small>{option.description}</small>
              </span>
              {option.recommended && <em>Recommended</em>}
              <Check size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <small className="developer-expiration-date">Expires {expirationDateLabel(value)}</small>
    </div>
  );
}

function CopyButton({
  label,
  status,
  className = "",
  onClick
}: {
  label: string;
  status?: CopyStatus;
  className?: string;
  onClick: () => void;
}) {
  const displayLabel = status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label;
  return (
    <button
      className={`${className} developer-copy-button${status ? ` ${status}` : ""}`.trim()}
      type="button"
      onClick={onClick}
    >
      {status === "copied" ? <Check size={13} /> : status === "failed" ? <AlertTriangle size={13} /> : <Copy size={13} />}
      {displayLabel}
    </button>
  );
}

export function DeveloperAccessPanel({
  serverId,
  serverName,
  role,
  passwordSetupRequired
}: {
  serverId: string;
  serverName: string;
  role: string;
  passwordSetupRequired: boolean;
}) {
  const [tokens, setTokens] = useState<McpPersonalAccessTokenRecord[]>([]);
  const [resource, setResource] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<TokenEditor | null>(null);
  const [name, setName] = useState("");
  const [manageAccess, setManageAccess] = useState(role !== "guest");
  const [bridgeAccess, setBridgeAccess] = useState(false);
  const [expirationDays, setExpirationDays] = useState<McpPersonalAccessTokenExpirationDays>(DEFAULT_EXPIRATION_DAYS);
  const [currentPassword, setCurrentPassword] = useState("");
  const [secret, setSecret] = useState<{ token: string; record: McpPersonalAccessTokenRecord } | null>(null);
  const [setupClient, setSetupClient] = useState<SetupClient>("generic");
  const [oauthGuideOpen, setOauthGuideOpen] = useState(false);
  const [oauthSetupClient, setOauthSetupClient] = useState<OAuthSetupClient>("chatgpt");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copyStates, setCopyStates] = useState<Partial<Record<CopyTarget, CopyStatus>>>({});
  const copyTimersRef = useRef<Partial<Record<CopyTarget, number>>>({});

  const activeCount = useMemo(
    () => tokens.filter((token) => tokenState(token) === "active").length,
    [tokens]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setResource("");
    setMessage("");
    api<{ resource: string; tokens: McpPersonalAccessTokenRecord[] }>(
      `/api/servers/${encodeURIComponent(serverId)}/mcp-access-tokens`
    ).then((payload) => {
      if (active) {
        setResource(payload.resource);
        setTokens(payload.tokens);
      }
    }).catch((error) => {
      if (active) setMessage(apiErrorMessage(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [serverId]);

  useEffect(() => () => {
    Object.values(copyTimersRef.current).forEach((timer) => window.clearTimeout(timer));
  }, []);

  function openCreate() {
    setName("");
    setManageAccess(role !== "guest");
    // Bridge access is never preselected because it crosses the current workspace boundary.
    setBridgeAccess(false);
    setExpirationDays(DEFAULT_EXPIRATION_DAYS);
    setCurrentPassword("");
    setMessage("");
    setEditor({ mode: "create" });
  }

  function openRotate(token: McpPersonalAccessTokenRecord) {
    setExpirationDays(DEFAULT_EXPIRATION_DAYS);
    setCurrentPassword("");
    setMessage("");
    setEditor({ mode: "rotate", token });
  }

  async function submitToken() {
    if (!editor) return;
    setBusyAction(editor.mode);
    setMessage("");
    try {
      const path = editor.mode === "create"
        ? `/api/servers/${encodeURIComponent(serverId)}/mcp-access-tokens`
        : `/api/servers/${encodeURIComponent(serverId)}/mcp-access-tokens/${encodeURIComponent(editor.token.id)}/rotate`;
      const scopes: McpPersonalAccessTokenScope[] = [
        "tyr:read",
        ...(manageAccess ? ["tyr:manage" as const] : []),
        ...(bridgeAccess ? ["tyr:bridge:read" as const, "tyr:bridge:send" as const] : [])
      ];
      const created = await api<{ token: string; record: McpPersonalAccessTokenRecord }>(path, {
        method: "POST",
        body: JSON.stringify(editor.mode === "create"
          ? { name, scopes, expirationDays, currentPassword }
          : { expirationDays, currentPassword })
      });
      setTokens((current) => [
        created.record,
        // 轮换后的旧 Token 已撤销，只保留新 Token 和其他仍可管理的记录。
        ...current.filter((token) => editor.mode !== "rotate" || token.id !== editor.token.id)
      ]);
      setCurrentPassword("");
      setEditor(null);
      setSecret(created);
      setSetupClient("generic");
      setCopyStates({});
    } catch (error) {
      setMessage(apiErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function revokeToken(token: McpPersonalAccessTokenRecord) {
    const confirmed = await confirmDialog({
      title: `Revoke “${token.name}”?`,
      description: "MCP clients and automations using this token will lose TYR access immediately.",
      confirmText: "Revoke token",
      tone: "danger"
    });
    if (!confirmed) return;
    setBusyAction(token.id);
    setMessage("");
    try {
      const payload = await api<{ token: McpPersonalAccessTokenRecord }>(
        `/api/servers/${encodeURIComponent(serverId)}/mcp-access-tokens/${encodeURIComponent(token.id)}`,
        { method: "DELETE" }
      );
      // 服务端保留审计记录，但已撤销 Token 不再出现在凭据管理列表。
      setTokens((current) => current.filter((item) => item.id !== payload.token.id));
      setMessage("Token revoked.");
    } catch (error) {
      setMessage(apiErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function copyValue(target: CopyTarget, value: string) {
    const existingTimer = copyTimersRef.current[target];
    if (existingTimer) window.clearTimeout(existingTimer);
    try {
      await copyMessageText(value);
      setCopyStates((current) => ({ ...current, [target]: "copied" }));
    } catch (error) {
      setCopyStates((current) => ({ ...current, [target]: "failed" }));
    }
    // Feedback is local to each copy control so copying one recipe does not erase another button's state.
    copyTimersRef.current[target] = window.setTimeout(() => {
      setCopyStates((current) => {
        const next = { ...current };
        delete next[target];
        return next;
      });
      delete copyTimersRef.current[target];
    }, 2000);
  }

  const editorToken = editor?.mode === "rotate" ? editor.token : null;
  const editorManageAccess = editorToken
    ? editorToken.scopes.includes("tyr:manage")
    : manageAccess;
  const editorBridgeAccess = editorToken
    ? editorToken.scopes.includes("tyr:bridge:send")
    : bridgeAccess;
  const secretMcpConfig = secret ? mcpConfig(secret.record.resource) : "";
  const secretCodexConfig = secret ? codexPatConfig(secret.record.resource) : "";
  const oauthCodexConfig = resource ? codexOAuthConfig(resource) : "";
  const oauthClaudeCommand = resource ? claudeOAuthCommand(resource) : "";
  const canSubmit = Boolean(
    currentPassword &&
    (editor?.mode === "rotate" || name.trim()) &&
    !busyAction
  );

  return (
    <>
      <section className="settings-card developer-access-card">
        <div className="account-card-head">
          <h3><Terminal size={17} /> Developer access</h3>
          <span>{activeCount} active tokens</span>
        </div>

        <div className="developer-mcp-overview">
          <div className="developer-access-intro">
            <span className="developer-access-mark"><Code2 size={19} /></span>
            <span>
              <b>Connect TYR via MCP</b>
              <small>Use OAuth for interactive clients or a personal access token for headless CLI and automation. Access stays limited to {serverName}.</small>
            </span>
          </div>
          <div className="developer-endpoint">
            <span><b>MCP endpoint</b><small>Streamable HTTP</small></span>
            <code>{resource || "Loading endpoint…"}</code>
            {resource && (
              <CopyButton
                label="Copy"
                status={copyStates["overview-endpoint"]}
                onClick={() => void copyValue("overview-endpoint", resource)}
                className="developer-endpoint-copy"
              />
            )}
          </div>
        </div>

        <div className="developer-auth-methods" aria-label="Authentication methods">
          <article className="developer-auth-method recommended">
            <span className="developer-auth-icon"><LogIn size={18} /></span>
            <span className="developer-auth-copy">
              <em>Recommended</em>
              <b>OAuth 2.1</b>
              <small>Best for ChatGPT, Codex, Claude Code, and other interactive clients. Sign in with Tyr in your browser; no token to copy.</small>
            </span>
            <button className="btn primary small" type="button" disabled={loading || !resource} onClick={() => {
              setOauthSetupClient("chatgpt");
              setOauthGuideOpen(true);
            }}>
              <LogIn size={14} /> View OAuth setup
            </button>
          </article>
          <article className="developer-auth-method">
            <span className="developer-auth-icon token"><KeyRound size={18} /></span>
            <span className="developer-auth-copy">
              <em>CLI &amp; automation</em>
              <b>Personal access token</b>
              <small>Use a workspace-scoped Bearer token when a client cannot open an interactive browser or runs unattended.</small>
            </span>
            <button className="btn small" type="button" disabled={loading || passwordSetupRequired || activeCount >= 10} onClick={openCreate}>
              <Plus size={14} /> Create token
            </button>
          </article>
        </div>

        {passwordSetupRequired && (
          <div className="developer-access-notice">
            <AlertTriangle size={15} />
            Set your account password in Security before creating a token.
          </div>
        )}

        <div className="developer-token-section-head">
          <span>
            <b>Personal access tokens</b>
            <small>Only create tokens for clients or automations that need Bearer authentication.</small>
          </span>
          <em>{activeCount} active</em>
        </div>

        <div className="developer-token-ledger">
          {loading && <div className="developer-token-empty">Loading tokens…</div>}
          {!loading && tokens.length === 0 && (
            <div className="developer-token-empty">
              <ShieldCheck size={20} />
              <b>No personal access tokens</b>
              <small>Interactive clients can connect with OAuth. Create a token only for headless CLI or automation.</small>
            </div>
          )}
          {!loading && tokens.map((token) => {
            const state = tokenState(token);
            const active = state === "active";
            return (
              <div className={`developer-token-row ${state}`} key={token.id}>
                <div className="developer-token-primary">
                  <span className={`developer-token-status-dot ${state}`} aria-hidden="true" />
                  <span>
                    <b>{token.name}</b>
                    <code>{token.tokenPrefix}••••••••</code>
                  </span>
                </div>
                <div className="developer-token-scopes">
                  {token.scopes.map((scope) => (
                    <span key={scope}>
                      {scope === "tyr:manage"
                        ? "Manage"
                        : scope === "tyr:bridge:read"
                          ? "Bridge read"
                          : scope === "tyr:bridge:send"
                            ? "Bridge send"
                            : "Read"}
                    </span>
                  ))}
                </div>
                <div className="developer-token-dates">
                  <span><b>Expires</b>{lifecycleLabel(token.expiresAt, "—")}</span>
                  <span><b>Last used</b>{lifecycleLabel(token.lastUsedAt, "Never")}</span>
                </div>
                <span className={`developer-token-state ${state}`}>{state}</span>
                <div className="developer-token-actions">
                  <button className="btn small" type="button" disabled={!active || Boolean(busyAction)} onClick={() => openRotate(token)}>
                    <RefreshCw size={13} /> Rotate
                  </button>
                  <button className="btn orange small" type="button" disabled={!active || Boolean(busyAction)} onClick={() => void revokeToken(token)}>
                    <Trash2 size={13} /> Revoke
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {message && <p className="settings-status inline-status" role="status">{message}</p>}
        <span className="developer-copy-live" role="status" aria-live="polite">
          {copyStates["overview-endpoint"] === "copied"
            ? "MCP endpoint copied."
            : copyStates["overview-endpoint"] === "failed"
              ? "Could not copy the MCP endpoint."
              : ""}
        </span>
      </section>

      {oauthGuideOpen && (
        <Modal
          title="CONNECT WITH OAUTH"
          onClose={() => {
            setOauthGuideOpen(false);
            setCopyStates({});
          }}
          className="template-form-modal template-form-modal-lg developer-oauth-modal"
          backdropClassName="template-form-modal-backdrop"
          titleIcon={<LogIn size={18} />}
        >
          <div className="template-dialog-content">
            <div className="template-dialog-body developer-oauth-guide">
              <div className="developer-oauth-summary">
                <span className="developer-access-mark"><ShieldCheck size={19} /></span>
                <span>
                  <b>OAuth is the preferred interactive sign-in</b>
                  <small>Your client opens Tyr in a browser so you can sign in, choose one workspace, and approve the requested access. You do not need to create or paste a personal access token.</small>
                </span>
              </div>

              <label className="field-label">Choose your client</label>
              <div className="developer-client-tabs oauth" role="tablist" aria-label="OAuth client setup">
                <button role="tab" type="button" aria-selected={oauthSetupClient === "chatgpt"} className={oauthSetupClient === "chatgpt" ? "active" : ""} onClick={() => setOauthSetupClient("chatgpt")}>
                  <Bot size={14} /> ChatGPT
                </button>
                <button role="tab" type="button" aria-selected={oauthSetupClient === "codex"} className={oauthSetupClient === "codex" ? "active" : ""} onClick={() => setOauthSetupClient("codex")}>
                  <Terminal size={14} /> Codex
                </button>
                <button role="tab" type="button" aria-selected={oauthSetupClient === "claude"} className={oauthSetupClient === "claude" ? "active" : ""} onClick={() => setOauthSetupClient("claude")}>
                  <FileJson2 size={14} /> Claude Code
                </button>
                <button role="tab" type="button" aria-selected={oauthSetupClient === "generic"} className={oauthSetupClient === "generic" ? "active" : ""} onClick={() => setOauthSetupClient("generic")}>
                  <Globe2 size={14} /> Other MCP
                </button>
              </div>

              {oauthSetupClient === "chatgpt" && (
                <div className="developer-client-panel" role="tabpanel">
                  <div className="developer-guide-title">
                    <span><Bot size={17} /><b>ChatGPT</b></span>
                    <em>OAuth</em>
                  </div>
                  <ol className="developer-setup-steps">
                    <li>Open <b>Settings → Security and login</b>, then turn on <b>Developer mode</b>.</li>
                    <li>Open <b>Settings → Plugins</b> and select the plus button.</li>
                    <li>Enter a name and description, paste the MCP endpoint below, then create the connection.</li>
                    <li>Complete Tyr sign-in, choose one workspace, review the scopes, and select <b>Allow</b>.</li>
                    <li>Return to ChatGPT, review the discovered tools, and add TYR from the tools menu in a new chat.</li>
                  </ol>
                  <div className="developer-setup-field">
                    <b>MCP endpoint</b>
                    <div className="developer-code-block">
                      <code>{resource}</code>
                      <CopyButton
                        label="Copy"
                        status={copyStates["oauth-endpoint"]}
                        onClick={() => void copyValue("oauth-endpoint", resource)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {oauthSetupClient === "codex" && (
                <div className="developer-client-panel" role="tabpanel">
                  <div className="developer-guide-title">
                    <span><Terminal size={17} /><b>Codex</b></span>
                    <em>OAuth</em>
                  </div>
                  <div className="developer-setup-field">
                    <b>~/.codex/config.toml</b>
                    <div className="developer-code-block multiline">
                      <pre>{oauthCodexConfig}</pre>
                      <CopyButton
                        label="Copy"
                        status={copyStates["codex-oauth-config"]}
                        onClick={() => void copyValue("codex-oauth-config", oauthCodexConfig)}
                      />
                    </div>
                  </div>
                  <div className="developer-setup-field">
                    <b>Start browser sign-in</b>
                    <div className="developer-code-block">
                      <code>codex mcp login tyr-assistant</code>
                      <CopyButton
                        label="Copy"
                        status={copyStates["codex-login"]}
                        onClick={() => void copyValue("codex-login", "codex mcp login tyr-assistant")}
                      />
                    </div>
                  </div>
                  <p className="developer-token-help">Codex CLI, the Codex app, and the IDE extension share MCP configuration for the same Codex host.</p>
                </div>
              )}

              {oauthSetupClient === "claude" && (
                <div className="developer-client-panel" role="tabpanel">
                  <div className="developer-guide-title">
                    <span><FileJson2 size={17} /><b>Claude Code</b></span>
                    <em>OAuth</em>
                  </div>
                  <div className="developer-setup-field">
                    <b>Add the remote MCP server</b>
                    <div className="developer-code-block">
                      <code>{oauthClaudeCommand}</code>
                      <CopyButton
                        label="Copy"
                        status={copyStates["claude-oauth"]}
                        onClick={() => void copyValue("claude-oauth", oauthClaudeCommand)}
                      />
                    </div>
                  </div>
                  <ol className="developer-setup-steps compact">
                    <li>Start Claude Code and run <code>/mcp</code>.</li>
                    <li>Select <b>tyr-assistant</b>, choose Authenticate, and complete Tyr sign-in in your browser.</li>
                    <li>Return to Claude Code and confirm the server is connected.</li>
                  </ol>
                </div>
              )}

              {oauthSetupClient === "generic" && (
                <div className="developer-client-panel" role="tabpanel">
                  <div className="developer-guide-title">
                    <span><Globe2 size={17} /><b>Other Streamable HTTP clients</b></span>
                    <em>OAuth 2.1</em>
                  </div>
                  <ol className="developer-setup-steps compact">
                    <li>Open the client&apos;s MCP, integrations, or tools settings.</li>
                    <li>Add a <b>Streamable HTTP</b> server named <b>TYR</b> and paste the endpoint below.</li>
                    <li>Choose <b>OAuth</b> with automatic discovery, then start the connection.</li>
                    <li>Complete Tyr sign-in, choose one workspace, review the scopes, and select <b>Allow</b>.</li>
                  </ol>
                  <div className="developer-setup-field">
                    <b>MCP endpoint</b>
                    <div className="developer-code-block">
                      <code>{resource}</code>
                      <CopyButton
                        label="Copy"
                        status={copyStates["oauth-endpoint"]}
                        onClick={() => void copyValue("oauth-endpoint", resource)}
                      />
                    </div>
                  </div>
                  <p className="developer-token-help">There is no universal install command for this tab because each client names its MCP settings differently. The client must support Streamable HTTP, Authorization Code with PKCE S256, and Dynamic Client Registration. Otherwise, use a personal access token only when the client can read a Bearer token securely.</p>
                </div>
              )}

              <span className="developer-copy-live" role="status" aria-live="polite">
                {Object.values(copyStates).includes("copied")
                  ? "Copied to clipboard."
                  : Object.values(copyStates).includes("failed")
                    ? "Could not copy to the clipboard."
                    : ""}
              </span>
            </div>
            <div className="modal-actions template-dialog-actions">
              <button className="btn primary" type="button" onClick={() => {
                setOauthGuideOpen(false);
                setCopyStates({});
              }}>Done</button>
            </div>
          </div>
        </Modal>
      )}

      {editor && (
        <Modal
          title={editor.mode === "create" ? "CREATE ACCESS TOKEN" : "ROTATE ACCESS TOKEN"}
          onClose={() => !busyAction && setEditor(null)}
          className="template-form-modal template-form-modal-sm developer-token-modal"
          backdropClassName="template-form-modal-backdrop"
          titleIcon={<KeyRound size={18} />}
        >
          <div className="template-dialog-content">
            <div className="template-dialog-body developer-token-form">
              {editor.mode === "create" ? (
                <>
                  <label className="field-label">Token name</label>
                  <input className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="e.g. MacBook CLI, CI runner" autoFocus />
                </>
              ) : (
                <div className="developer-token-rotate-summary">
                  <span><b>{editor.token.name}</b><code>{editor.token.tokenPrefix}••••••••</code></span>
                  <small>The old token stops working as soon as the replacement is created.</small>
                </div>
              )}

              <label className="field-label">Access</label>
              <label className="developer-scope-option">
                <input type="checkbox" checked disabled />
                <span><b>Read TYR</b><small>Query workspace status and read operation results.</small></span>
              </label>
              <label className="developer-scope-option">
                <input
                  type="checkbox"
                  checked={editorManageAccess}
                  disabled={editor.mode === "rotate" || role === "guest"}
                  onChange={(event) => setManageAccess(event.target.checked)}
                />
                <span><b>Request managed actions</b><small>Submit actions that still pass through Tyr approvals and policy checks.</small></span>
              </label>
              <label className="developer-scope-option">
                <input
                  type="checkbox"
                  checked={editorBridgeAccess}
                  disabled={editor.mode === "rotate" || role === "guest"}
                  onChange={(event) => setBridgeAccess(event.target.checked)}
                />
                <span><b>Communicate through Workspace Bridges</b><small>List connected workspaces and send requests only through their TYR.</small></span>
              </label>

              <label className="field-label" htmlFor="mcp-token-expiration">Expiration</label>
              <ExpirationPicker
                value={expirationDays}
                onChange={setExpirationDays}
              />

              <label className="field-label" htmlFor="mcp-token-current-password">Current password</label>
              <input
                id="mcp-token-current-password"
                className="input"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Confirm this security-sensitive change"
              />
              {message && <p className="field-hint error" role="alert">{message}</p>}
            </div>
            <div className="modal-actions template-dialog-actions">
              <button className="btn" type="button" disabled={Boolean(busyAction)} onClick={() => setEditor(null)}>Cancel</button>
              <button className="btn primary" type="button" disabled={!canSubmit} onClick={() => void submitToken()}>
                <KeyRound size={14} /> {busyAction ? "Creating…" : editor.mode === "create" ? "Create token" : "Rotate token"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {secret && (
        <Modal
          title="TOKEN CREATED"
          onClose={() => {
            setSecret(null);
            setCopyStates({});
          }}
          className="template-form-modal template-form-modal-lg developer-token-secret-modal"
          backdropClassName="template-form-modal-backdrop"
          titleIcon={<Check size={18} />}
        >
          <div className="template-dialog-content">
            <div className="template-dialog-body developer-token-secret">
              <div className="developer-access-notice warning">
                <AlertTriangle size={15} />
                Copy this token now. Tyr cannot show it again.
              </div>
              <label className="field-label">Personal access token</label>
              <div className="developer-secret-line">
                <code>{secret.token}</code>
                <CopyButton
                  className="btn small"
                  label="Copy token"
                  status={copyStates.token}
                  onClick={() => void copyValue("token", secret.token)}
                />
              </div>
              <label className="field-label">Recommended environment variable</label>
              <div className="developer-code-block">
                <code>{`export TYR_MCP_TOKEN='${secret.token}'`}</code>
                <CopyButton
                  label="Copy"
                  status={copyStates.environment}
                  onClick={() => void copyValue("environment", `export TYR_MCP_TOKEN='${secret.token}'`)}
                />
              </div>
              <label className="field-label">Client setup using this token</label>
              <div className="developer-client-tabs token" role="tablist" aria-label="Personal access token client setup">
                <button role="tab" type="button" aria-selected={setupClient === "generic"} className={setupClient === "generic" ? "active" : ""} onClick={() => setSetupClient("generic")}>
                  <Globe2 size={14} /> Generic MCP
                </button>
                <button role="tab" type="button" aria-selected={setupClient === "codex"} className={setupClient === "codex" ? "active" : ""} onClick={() => setSetupClient("codex")}>
                  <Terminal size={14} /> Codex
                </button>
                <button role="tab" type="button" aria-selected={setupClient === "claude"} className={setupClient === "claude" ? "active" : ""} onClick={() => setSetupClient("claude")}>
                  <FileJson2 size={14} /> Claude Code
                </button>
              </div>
              {setupClient === "generic" ? (
                <div className="developer-client-panel" role="tabpanel">
                  <div className="developer-setup-field">
                    <b>MCP endpoint</b>
                    <div className="developer-code-block">
                      <code>{secret.record.resource}</code>
                      <CopyButton
                        label="Copy"
                        status={copyStates["token-endpoint"]}
                        onClick={() => void copyValue("token-endpoint", secret.record.resource)}
                      />
                    </div>
                  </div>
                  <div className="developer-setup-field">
                    <b>Authorization header</b>
                    <div className="developer-code-block">
                      <code>{mcpAuthorizationHeader()}</code>
                      <CopyButton
                        label="Copy"
                        status={copyStates.authorization}
                        onClick={() => void copyValue("authorization", mcpAuthorizationHeader())}
                      />
                    </div>
                  </div>
                  <p className="developer-token-help">Use these values in a compatible Streamable HTTP MCP client. Keep the token in an environment variable rather than client configuration.</p>
                </div>
              ) : setupClient === "codex" ? (
                <div className="developer-client-panel" role="tabpanel">
                  <div className="developer-setup-field">
                    <b>~/.codex/config.toml</b>
                    <div className="developer-code-block multiline">
                      <pre>{secretCodexConfig}</pre>
                      <CopyButton
                        label="Copy"
                        status={copyStates["codex-pat-config"]}
                        onClick={() => void copyValue("codex-pat-config", secretCodexConfig)}
                      />
                    </div>
                  </div>
                  <p className="developer-token-help">Set <code>TYR_MCP_TOKEN</code> before starting Codex. Codex reads it from the environment and sends it as the Authorization Bearer token.</p>
                </div>
              ) : (
                <div className="developer-client-panel" role="tabpanel">
                  <div className="developer-setup-field">
                    <b>Claude Code .mcp.json</b>
                    <div className="developer-code-block multiline">
                      <pre>{secretMcpConfig}</pre>
                      <CopyButton
                        label="Copy"
                        status={copyStates["claude-config"]}
                        onClick={() => void copyValue("claude-config", secretMcpConfig)}
                      />
                    </div>
                  </div>
                  <p className="developer-token-help">Set the environment variable before starting Claude Code. This configuration reads it at launch and sends it only as an Authorization header.</p>
                </div>
              )}
              <div className="developer-token-oauth-note">
                <LogIn size={14} />
                <span><b>Using ChatGPT?</b> Connect with OAuth from the Developer Access page instead. ChatGPT does not need this token.</span>
              </div>
              <span className="developer-copy-live" role="status" aria-live="polite">
                {Object.values(copyStates).includes("copied")
                  ? "Copied to clipboard."
                  : Object.values(copyStates).includes("failed")
                    ? "Could not copy to the clipboard."
                    : ""}
              </span>
            </div>
            <div className="modal-actions template-dialog-actions">
              <button className="btn primary" type="button" onClick={() => {
                setSecret(null);
                setCopyStates({});
              }}>I saved the token</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
