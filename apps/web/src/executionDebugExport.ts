import { governanceDecisionExplanation, type AgentToolOperationObservability, type ExecutionBlockRecord, type GovernanceDecisionRecord, type MachineRecord, type RuntimeApprovalRecord, type RuntimeExecutionDebugExport, type RuntimeExecutionRecord, type RuntimeReport, type SafetyAssessmentRecord } from "@tyr-ai/contracts";
import type { TaskExecutionTimeline } from "./executionView";

type ClientDebugExportInput = {
  prompt?: string;
  timelines: TaskExecutionTimeline[];
  approvals: RuntimeApprovalRecord[];
  safetyAssessments: SafetyAssessmentRecord[];
  governanceDecisions?: GovernanceDecisionRecord[];
  executionBlocks?: ExecutionBlockRecord[];
  environment?: RuntimeExecutionDebugExport["environment"];
  exportedAt?: string;
};

type DownloadAnchorLike = {
  href: string;
  download: string;
  click: () => void;
  remove: () => void;
};

type DownloadDocumentLike = {
  body: {
    append: (node: DownloadAnchorLike) => void;
  };
  createElement: (tagName: "a") => DownloadAnchorLike;
};

type DownloadUrlLike = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

export type DownloadJsonEnvironment = {
  BlobCtor?: typeof Blob;
  URL?: DownloadUrlLike;
  document?: DownloadDocumentLike;
};

type DebugMachineInput = MachineRecord & { runtimes?: RuntimeReport[] };

export function buildRuntimeDebugEnvironment(machines: DebugMachineInput[], latestRuntimeSha?: string): NonNullable<RuntimeExecutionDebugExport["environment"]> {
  return {
    latestRuntimeSha,
    machines: machines.map((machine) => ({
      id: machine.id,
      name: machine.name,
      runtimeSha: machine.runtimeSha,
      runtimeMarker: machine.runtimeMarker,
      runtimeMarkerMtime: machine.runtimeMarkerMtime,
      daemonVersion: machine.daemonVersion,
      status: machine.status,
      runtimeReports: machine.runtimes ?? []
    }))
  };
}

export function buildClientExecutionDebugExport(input: ClientDebugExportInput): RuntimeExecutionDebugExport {
  const executions = input.timelines.map((timeline) => timeline.execution).filter((execution): execution is RuntimeExecutionRecord => Boolean(execution));
  const events = input.timelines.flatMap((timeline) => timeline.events);
  const operationObservability = events.flatMap((event) => operationObservabilityFromPayload(event.payload));
  const governanceExplanations = (input.governanceDecisions ?? []).map(governanceDecisionExplanation);
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    exportedAt,
    executions,
    events,
    operationObservability,
    executionBlocks: input.executionBlocks ?? [],
    approvals: input.approvals,
    safetyAssessments: input.safetyAssessments,
    governanceDecisions: input.governanceDecisions ?? [],
    governancePolicySnapshots: [],
    governancePolicyConfigAudit: [],
    governanceExplanations,
    auditEvents: [],
    environment: input.environment ?? {
      latestRuntimeSha: undefined,
      machines: []
    },
    stats: {
      source: "client-visible",
      executionCount: executions.length,
      eventCount: events.length,
      blockCount: input.executionBlocks?.length ?? 0,
      approvalCount: input.approvals.length,
      safetyAssessmentCount: input.safetyAssessments.length,
      governanceDecisionCount: input.governanceDecisions?.length ?? 0,
      governancePolicySnapshotCount: 0,
      governancePolicyConfigAuditCount: 0,
      governanceExplanationCount: governanceExplanations.length,
      auditEventCount: 0,
      requestedExecutionIds: executions.map((execution) => execution.id)
    },
    clientContext: {
      prompt: input.prompt
    }
  };
}

function operationObservabilityFromPayload(payload: unknown): AgentToolOperationObservability[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const value = (payload as { operationObservability?: unknown }).operationObservability;
  return isAgentToolOperationObservability(value) ? [value] : [];
}

function isAgentToolOperationObservability(value: unknown): value is AgentToolOperationObservability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.operationId === "string"
    && typeof item.runtimeId === "string"
    && typeof item.selectedTransport === "string"
    && typeof item.actualTransport === "string"
    && typeof item.preferredTransport === "string"
    && Array.isArray(item.fallbackTransports)
    && Array.isArray(item.degradedTransports);
}

export function executionDebugExportFilename(input: Pick<RuntimeExecutionDebugExport, "exportedAt"> & { executions: Array<Pick<RuntimeExecutionRecord, "id">> }): string {
  const executionLabel = input.executions[0]?.id ?? "visible";
  const timestamp = input.exportedAt.replace(/[:.]/g, "");
  return `tyr-execution-debug-${executionLabel}-${timestamp}.json`;
}

export function downloadJsonFile(filename: string, data: unknown, environment: DownloadJsonEnvironment = {}): void {
  const BlobCtor = environment.BlobCtor ?? Blob;
  const urlApi = environment.URL ?? URL;
  const doc = environment.document ?? document as unknown as DownloadDocumentLike;
  const blob = new BlobCtor([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = urlApi.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  doc.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    urlApi.revokeObjectURL(url);
  }
}
