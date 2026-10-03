import type { TyrDb } from "@tyr-ai/db";

export interface McpSubmission {
  operation_id: string;
  idempotency_key: string;
  turn_sequence: number;
  message_id: string;
  payload_hash: string;
  state: "queued" | "running" | "dispatched" | "interrupted";
  error_code: string | null;
  notice_message_id: string | null;
}

/** One server process owns an instance DB. Claims are durable before entering model/tool code. */
export class McpSubmissionDispatcher {
  private scheduled = false;
  private active = 0;
  constructor(private readonly store: TyrDb,
    private readonly process: (submission: McpSubmission) => Promise<void>,
    private readonly interrupted: (submission: McpSubmission) => void) {}

  recover(): void {
    this.store.db.prepare(`update mcp_operation_submissions set state='interrupted', error_code='server_restarted', updated_at=?
      where state='running'`).run(new Date().toISOString());
    for (const row of this.store.db.prepare("select * from mcp_operation_submissions where state='interrupted' and notice_message_id is null").all() as McpSubmission[]) {
      this.interrupted(row);
    }
    this.schedule();
  }

  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (!this.store.db.open) return;
      try { this.drain(); } catch { console.error("[mcp-submission] queue_unavailable"); }
    });
  }

  private drain(): void {
    while (this.active < 4) {
      const row = this.store.db.transaction(() => {
        const next = this.store.db.prepare(`select q.* from mcp_operation_submissions q
          join mcp_operations qo on qo.id=q.operation_id where q.state='queued' and not exists (
            select 1 from mcp_operation_submissions r join mcp_operations ro on ro.id=r.operation_id
            where r.state='running' and ro.server_id=qo.server_id and ro.user_id=qo.user_id
              and ro.conversation_id=qo.conversation_id
          ) order by q.rowid limit 1`).get() as McpSubmission | undefined;
        if (!next) return null;
        return this.store.db.prepare(`update mcp_operation_submissions set state='running', updated_at=?
          where operation_id=? and idempotency_key=? and state='queued'`).run(new Date().toISOString(), next.operation_id, next.idempotency_key).changes ? next : null;
      })();
      if (!row) return;
      this.active++;
      void this.process(row).catch(() => {
        if (!this.store.db.open) return;
        this.store.db.prepare(`update mcp_operation_submissions set state='interrupted', error_code='processing_interrupted', updated_at=?
          where operation_id=? and idempotency_key=? and state='running'`).run(new Date().toISOString(), row.operation_id, row.idempotency_key);
        this.interrupted(row);
      }).catch(() => { console.error("[mcp-submission] interruption_persistence_failed"); })
        .finally(() => { this.active--; this.schedule(); });
    }
  }
}
