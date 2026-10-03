import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  isCommunicationAgent, normalizeTyrEmailLocalPart, tyrEmailLocalPartError,
  tyrEmailNameSuggestion, TYR_EMAIL_DOMAIN, type AgentRecord, type ServerRecord,
  type TyrEmailCandidate, type TyrEmailSettings
} from "@tyr-ai/contracts";
import type { CommunicationAgentEmailAliasRecord, TyrDb } from "./index";

export function createCommunicationEmailStore(db: Database.Database, ctx: {
  getAgent: (id: string) => AgentRecord | null;
  listServersForUser: (id: string) => ServerRecord[];
  recordAuditEvent: TyrDb["recordAuditEvent"];
}) {
  function rowAlias(row: any): CommunicationAgentEmailAliasRecord {
    return {
      id: row.id, serverId: row.server_id, userId: row.user_id,
      assistantAgentId: row.assistant_agent_id, address: row.address,
      status: row.status === "revoked" ? "revoked" : "active",
      isPrimary: Boolean(row.is_primary), createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  function listCommunicationAgentEmailAliases(assistantAgentId: string): CommunicationAgentEmailAliasRecord[] {
    return db.prepare(`select * from communication_agent_email_aliases
      where assistant_agent_id = ? and status = 'active' order by is_primary desc, created_at, id`)
      .all(assistantAgentId).map(rowAlias);
  }

  function getCommunicationAgentEmailAliasByAddress(address: string): CommunicationAgentEmailAliasRecord | null {
    const row = db.prepare(`select * from communication_agent_email_aliases
      where lower(address) = ? and status = 'active'`).get(address.trim().toLowerCase());
    return row ? rowAlias(row) : null;
  }

  function addressAvailable(address: string, assistantAgentId?: string): boolean {
    if (address === (process.env.TYR_HELPDESK_EMAIL || `help@${TYR_EMAIL_DOMAIN}`).trim().toLowerCase()) return false;
    const existing = getCommunicationAgentEmailAliasByAddress(address);
    if (existing) return existing.assistantAgentId === assistantAgentId;
    return !db.prepare("select 1 from communication_email_address_reservations where address = ?").get(address);
  }

  function insertAlias(serverId: string, userId: string, assistantAgentId: string, address: string) {
    const at = new Date().toISOString();
    db.prepare(`insert into communication_agent_email_aliases
      (id, server_id, user_id, assistant_agent_id, address, status, is_primary, created_at, updated_at)
      values (?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
      .run(`agent_email_${randomUUID()}`, serverId, userId, assistantAgentId, address, at, at);
    return getCommunicationAgentEmailAliasByAddress(address)!;
  }

  function ensureCommunicationAgentEmailAlias(input: {
    serverId: string; userId: string; assistantAgentId: string; domain: string;
  }): CommunicationAgentEmailAliasRecord {
    return db.transaction(() => {
      const assistant = ctx.getAgent(input.assistantAgentId);
      const server = db.prepare("select name, owner_user_id from servers where id = ?").get(input.serverId) as
        { name: string; owner_user_id: string } | undefined;
      if (!server || !assistant || assistant.deletedAt || !isCommunicationAgent(assistant)
        || (assistant.serverId ?? "local") !== input.serverId) throw new Error("communication_agent_not_found");
      const existing = listCommunicationAgentEmailAliases(assistant.id)[0];
      if (existing) return existing;
      const domain = input.domain.trim().toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error("invalid_email_alias_domain");
      const base = tyrEmailNameSuggestion(server.name);
      let localPart = base;
      // Automatic provisioning stays non-blocking; custom requests never silently change the chosen name.
      for (let number = 2; !addressAvailable(`${localPart}@${domain}`); number += 1) {
        localPart = `${base}-${number}`;
      }
      return insertAlias(input.serverId, server.owner_user_id, assistant.id, `${localPart}@${domain}`);
    }).immediate();
  }

  function emailScope(agentId: string, userId: string) {
    const assistant = ctx.getAgent(agentId);
    if (!assistant || assistant.deletedAt || !isCommunicationAgent(assistant)) throw new Error("communication_agent_not_found");
    const server = ctx.listServersForUser(userId).find((item) => item.id === (assistant.serverId ?? "local"));
    if (!server || (server.role !== "owner" && server.role !== "member")) throw new Error("server_membership_required");
    return { assistant, server, canCustomize: server.role === "owner" && server.ownerId === userId };
  }

  function candidateFor(value: string, assistantAgentId: string): TyrEmailCandidate {
    const localPart = normalizeTyrEmailLocalPart(value);
    const address = `${localPart}@${TYR_EMAIL_DOMAIN}`;
    const reason = tyrEmailLocalPartError(localPart)
      ?? (address === (process.env.TYR_HELPDESK_EMAIL || `help@${TYR_EMAIL_DOMAIN}`).trim().toLowerCase() ? "reserved_email_alias" : undefined)
      ?? (addressAvailable(address, assistantAgentId) ? undefined : "email_alias_taken");
    return { localPart, address, available: !reason, ...(reason ? { reason } : {}) };
  }

  function getCommunicationAgentEmailSettings(input: { agentId: string; userId: string; localPart?: string }): TyrEmailSettings {
    const { assistant, server, canCustomize } = emailScope(input.agentId, input.userId);
    if (input.localPart !== undefined && !canCustomize) throw new Error("server_owner_required");
    const primary = ensureCommunicationAgentEmailAlias({ serverId: server.id, userId: input.userId,
      assistantAgentId: assistant.id, domain: TYR_EMAIL_DOMAIN });
    const suggestions: string[] = [];
    const base = tyrEmailNameSuggestion(input.localPart && !tyrEmailLocalPartError(normalizeTyrEmailLocalPart(input.localPart))
      ? input.localPart : server.name);
    if (canCustomize) {
      const alternatives = [base, ...["tyr", "assistant", "team"].filter((suffix) => !base.endsWith(`-${suffix}`))
        .map((suffix) => `${base}-${suffix}`), ...Array.from({ length: 20 }, (_, i) => `${base}-${i + 2}`)];
      for (const localPart of alternatives) {
        const candidate = candidateFor(localPart, assistant.id);
        if (candidate.available && candidate.address !== primary.address) suggestions.push(localPart);
        if (suggestions.length === 3) break;
      }
    }
    return {
      address: primary.address, domain: TYR_EMAIL_DOMAIN, canCustomize, suggestions,
      previousAddresses: canCustomize ? listCommunicationAgentEmailAliases(assistant.id)
        .filter((alias) => alias.id !== primary.id).map((alias) => alias.address) : [],
      ...(input.localPart !== undefined ? { candidate: candidateFor(input.localPart, assistant.id) } : {})
    };
  }

  function updateCommunicationAgentEmailAlias(input: {
    agentId: string; userId: string; localPart: string; expectedAddress: string;
  }): TyrEmailSettings {
    return db.transaction(() => {
      const { assistant, server, canCustomize } = emailScope(input.agentId, input.userId);
      if (!canCustomize) throw new Error("server_owner_required");
      const primary = ensureCommunicationAgentEmailAlias({ serverId: server.id, userId: input.userId,
        assistantAgentId: assistant.id, domain: TYR_EMAIL_DOMAIN });
      const candidate = candidateFor(input.localPart, assistant.id);
      if (candidate.reason) throw new Error(candidate.reason);
      // A repeated save after a lost HTTP response returns the same primary address.
      if (primary.address === candidate.address) return getCommunicationAgentEmailSettings(input);
      if (primary.address !== input.expectedAddress) throw new Error("email_alias_changed");
      db.prepare("update communication_agent_email_aliases set is_primary = 0 where assistant_agent_id = ?").run(assistant.id);
      const previous = getCommunicationAgentEmailAliasByAddress(candidate.address);
      if (previous) db.prepare("update communication_agent_email_aliases set is_primary = 1, updated_at = ? where id = ?")
        .run(new Date().toISOString(), previous.id);
      else insertAlias(server.id, server.ownerId, assistant.id, candidate.address);
      ctx.recordAuditEvent({ kind: "communication_email_alias_updated", actorType: "user", actorId: input.userId,
        resourceType: "agent", resourceId: assistant.id, serverId: server.id,
        metadata: { previousAddress: primary.address, address: candidate.address } });
      return getCommunicationAgentEmailSettings(input);
    }).immediate();
  }

  return { ensureCommunicationAgentEmailAlias, getCommunicationAgentEmailAliasByAddress,
    listCommunicationAgentEmailAliases, getCommunicationAgentEmailSettings, updateCommunicationAgentEmailAlias };
}

export function migrateCommunicationEmailAliases(db: Database.Database) {
  if (!(db.prepare("pragma table_info(communication_agent_email_aliases)").all() as { name: string }[])
    .some((column) => column.name === "is_primary")) {
    db.exec("alter table communication_agent_email_aliases add column is_primary integer not null default 0");
  }
  db.exec(`
    update communication_agent_email_aliases set is_primary = 1
    where rowid in (select min(rowid) from communication_agent_email_aliases where status = 'active'
      group by server_id, assistant_agent_id)
    and not exists (select 1 from communication_agent_email_aliases p
      where p.assistant_agent_id = communication_agent_email_aliases.assistant_agent_id and p.is_primary = 1 and p.status = 'active');
    create unique index if not exists idx_communication_email_primary
      on communication_agent_email_aliases(server_id, assistant_agent_id) where is_primary = 1 and status = 'active';
    create unique index if not exists idx_communication_email_address_normalized
      on communication_agent_email_aliases(lower(address));
    create table if not exists communication_email_address_reservations (address text primary key);
    insert or ignore into communication_email_address_reservations select lower(address) from communication_agent_email_aliases;
    create trigger if not exists reserve_communication_email_insert after insert on communication_agent_email_aliases
      begin insert or ignore into communication_email_address_reservations values (lower(new.address)); end;
    create trigger if not exists reserve_communication_email_update after update of address on communication_agent_email_aliases
      begin insert or ignore into communication_email_address_reservations values (lower(new.address)); end;
  `);
}
