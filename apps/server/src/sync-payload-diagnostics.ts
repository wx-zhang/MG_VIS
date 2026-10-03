const DEFAULT_SYNC_PAYLOAD_WARNING_BYTES = 250_000;
const DEFAULT_SYNC_PAYLOAD_WARNING_THROTTLE_MS = 30_000;
const syncPayloadWarningTimes = new Map<string, number>();

export type SyncPayloadDiagnostics = {
  kind: string;
  bytes: number;
  messages: number;
  executionBlocks: number;
  runtimeApprovals: number;
  runtimeExecutionEvents: number;
  safetyAssessments: number;
  governanceDecisions: number;
  agents: number;
  tasks: number;
  legacyWorkspacePayloadSuspected?: boolean;
};

type SyncPayloadShape = {
  currentUser?: unknown;
  currentServer?: unknown;
  capabilities?: unknown;
  summary?: unknown;
  defaults?: unknown;
  unreadCounts?: unknown;
  messages?: unknown[];
  blocks?: unknown[];
  executionBlocks?: unknown[];
  runtimeApprovals?: unknown[];
  runtimeExecutionEvents?: unknown[];
  safetyAssessments?: unknown[];
  governanceDecisions?: unknown[];
  agents?: unknown[] | { items?: unknown[] };
  tasks?: unknown[] | { items?: unknown[] };
};

function listLength(value: unknown[] | { items?: unknown[] } | undefined): number {
  if (Array.isArray(value)) return value.length;
  return value?.items?.length ?? 0;
}

export function syncPayloadDiagnostics(kind: string, payload: SyncPayloadShape): SyncPayloadDiagnostics {
  const diagnostics: SyncPayloadDiagnostics = {
    kind,
    bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    messages: payload.messages?.length ?? 0,
    executionBlocks: payload.executionBlocks?.length ?? payload.blocks?.length ?? 0,
    runtimeApprovals: payload.runtimeApprovals?.length ?? 0,
    runtimeExecutionEvents: payload.runtimeExecutionEvents?.length ?? 0,
    safetyAssessments: payload.safetyAssessments?.length ?? 0,
    governanceDecisions: payload.governanceDecisions?.length ?? 0,
    agents: listLength(payload.agents),
    tasks: listLength(payload.tasks)
  };
  if (kind === "workspace-bootstrap" && diagnostics.runtimeExecutionEvents > 0) diagnostics.legacyWorkspacePayloadSuspected = true;
  return diagnostics;
}

export function warnIfLargeSyncPayload(kind: string, payload: SyncPayloadShape, options: number | { thresholdBytes?: number; throttleMs?: number; userId?: string; nowMs?: number; extra?: Record<string, unknown> } = {}): void {
  const thresholdBytes = typeof options === "number" ? options : options.thresholdBytes ?? DEFAULT_SYNC_PAYLOAD_WARNING_BYTES;
  const throttleMs = typeof options === "number" ? DEFAULT_SYNC_PAYLOAD_WARNING_THROTTLE_MS : options.throttleMs ?? DEFAULT_SYNC_PAYLOAD_WARNING_THROTTLE_MS;
  const userId = typeof options === "number" ? "" : options.userId ?? "";
  const nowMs = typeof options === "number" ? Date.now() : options.nowMs ?? Date.now();
  const diagnostics = syncPayloadDiagnostics(kind, payload);
  if (diagnostics.bytes <= thresholdBytes) return;
  const warningKey = `${kind}:${userId}`;
  const lastWarnedAt = syncPayloadWarningTimes.get(warningKey) ?? 0;
  if (lastWarnedAt && nowMs - lastWarnedAt < throttleMs) return;
  syncPayloadWarningTimes.set(warningKey, nowMs);
  const extra = typeof options === "number" ? undefined : options.extra;
  console.warn(`[sync:${kind}] large payload`, extra ? { ...diagnostics, ...extra } : diagnostics);
}
