import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type express from "express";
import type { TyrDb } from "@tyr-ai/db";
import type { DeploymentNotice } from "@tyr-ai/contracts";

export const DEPLOYMENT_QUIET_MS = 120_000;
export type DeploymentBrowserPresence = { visible: boolean; updatedAt: number };

export function deploymentBrowserCounts(clients: Iterable<{ deploymentPresence?: DeploymentBrowserPresence }>, now = Date.now()) {
  let foregroundPages = 0;
  let unknownPages = 0;
  for (const client of clients) {
    const presence = client.deploymentPresence;
    if (!presence || now < presence.updatedAt || now - presence.updatedAt > 90_000) unknownPages++;
    else if (presence.visible) foregroundPages++;
  }
  return { foregroundPages, unknownPages };
}

/** Advisory evidence only: this monitor does not lock admission or authorize a restart. */
export class DeploymentActivityMonitor {
  private lastActivityAt: number;
  private inFlight = 0;
  private idleSince: number | null = null;
  private lastSampleAt: number | null = null;

  constructor(private readonly now = Date.now) { this.lastActivityAt = now(); }

  touch(): void {
    this.lastActivityAt = this.now();
    this.idleSince = null;
  }

  readonly observeHttp: express.RequestHandler = (req, res, next) => {
    // Health and notice polling are observation, not user activity. Everything else
    // (including MCP, webhooks and internal callbacks) is counted conservatively.
    if (req.method === "OPTIONS" || (req.method === "GET" &&
      ["/api/health", "/api/deployment-notice"].includes(req.path))) return next();
    this.touch();
    this.inFlight++;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.inFlight--;
      this.touch();
    };
    res.once("finish", finish);
    res.once("close", finish);
    next();
  };

  inspect(readCounts: () => Record<string, number>) {
    const now = this.now();
    let counts: Record<string, number>;
    let observationError = false;
    try {
      counts = { ...readCounts(), httpRequests: this.inFlight };
      if (Object.values(counts).some((count) => !Number.isFinite(count) || count < 0)) throw new Error("invalid_counts");
    } catch {
      counts = { httpRequests: this.inFlight };
      observationError = true;
    }
    const blockers = Object.entries(counts).filter(([, count]) => count > 0).map(([kind, count]) => ({ kind, count }));
    if (observationError) blockers.push({ kind: "observation_unavailable", count: 1 });
    // A stale snapshot or an event-loop pause cannot count as continuous observation.
    if (this.lastSampleAt === null || now < this.lastSampleAt || now - this.lastSampleAt > 10_000) this.idleSince = null;
    this.lastSampleAt = now;
    if (blockers.length) this.idleSince = null;
    else this.idleSince ??= now;
    if (now - this.lastActivityAt < DEPLOYMENT_QUIET_MS) blockers.push({ kind: "recent_activity", count: 1 });
    const quietForMs = this.idleSince === null ? 0 : Math.max(0, now - this.idleSince);
    return {
      sampledAt: new Date(now).toISOString(),
      observedIdle: blockers.length === 0 && quietForMs >= DEPLOYMENT_QUIET_MS,
      advisoryOnly: true as const,
      quietForMs,
      requiredQuietMs: DEPLOYMENT_QUIET_MS,
      lastActivityAt: new Date(this.lastActivityAt).toISOString(),
      counts,
      blockers
    };
  }
}

export function deploymentWorkCounts(store: Pick<TyrDb, "db">): Record<string, number> {
  const queries: Record<string, string> = {
    executions: "select count(*) n from runtime_executions where status not in ('completed','failed','cancelled')",
    humanSubmissions: "select count(*) n from message_submissions where state in ('queued','running')",
    mcpSubmissions: "select count(*) n from mcp_operation_submissions where state in ('queued','running')",
    workerReturns: "select count(*) n from communication_return_events where state in ('pending','running')",
    bridgeAttempts: "select count(*) n from bridge_continuation_attempts where state = 'running'",
    bridgeContinuations: `select count(*) n from cross_workspace_messages request where continuation_state = 'running'
      or (continuation_state in ('registered','pending') and exists (
        select 1 from cross_workspace_messages terminal where terminal.terminal_request_id = request.id
          and terminal.response_kind in ('final','error') and terminal.origin_message_id is not null))`,
    deviceCommands: "select count(*) n from device_commands where status in ('queued','sent','running')",
    telegramDeliveries: "select count(*) n from telegram_outbound_deliveries where status in ('pending','sending')",
  };
  // Older installations do not have the optional email invitation queue. An
  // absent table cannot hold deliveries; a present but incompatible table still fails closed.
  const hasInvitations = Boolean(store.db.prepare("select 1 from sqlite_master where type = 'table' and name = 'workspace_bridge_email_invitations'").get());
  if (hasInvitations) queries.bridgeInvitations = "select count(*) n from workspace_bridge_email_invitations where delivery_status in ('pending','sending')";
  // Required missing tables/columns deliberately throw: unavailable observation is not idle.
  return { bridgeInvitations: 0, ...Object.fromEntries(Object.entries(queries).map(([key, sql]) => [key, (store.db.prepare(sql).get() as { n: number }).n])) };
}

export function validDeploymentNotice(value: unknown): value is DeploymentNotice {
  if (!value || typeof value !== "object") return false;
  const item = value as DeploymentNotice;
  return typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(item.id)
    && ["scheduled", "updating", "completed", "postponed"].includes(item.phase)
    && typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt))
    && typeof item.expiresAt === "string" && Number.isFinite(Date.parse(item.expiresAt));
}

export class DeploymentNoticeStore {
  constructor(private readonly filePath: string, private readonly now = Date.now) {}

  read(): DeploymentNotice | null {
    if (!existsSync(this.filePath)) return null;
    const value: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (!validDeploymentNotice(value)) throw new Error("deployment_notice_invalid");
    // Expiry is carried to the browser; an expired 'updating' notice must not look like success.
    return { id: value.id, phase: value.phase, updatedAt: value.updatedAt, expiresAt: value.expiresAt };
  }

  set(input: Omit<DeploymentNotice, "updatedAt">, expectedNoticeId: string | null): DeploymentNotice {
    const current = this.read();
    if ((current?.id ?? null) !== expectedNoticeId) throw new Error("deployment_notice_conflict");
    const now = this.now();
    const notice = { ...input, updatedAt: new Date(now).toISOString() };
    const duration = Date.parse(notice.expiresAt) - now;
    if (!validDeploymentNotice(notice) || duration <= 0 || duration > 2 * 60 * 60_000) throw new Error("deployment_notice_invalid");
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(notice), { mode: 0o600 });
    renameSync(temporary, this.filePath);
    return notice;
  }
}
