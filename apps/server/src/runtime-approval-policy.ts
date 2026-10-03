import type { RuntimeApprovalKind, RuntimeApprovalRecord, RuntimeExecutionEventKind, RuntimeExecutionEventRecord, RuntimeExecutionStatus, RuntimePermissionMode } from "@tyr-ai/contracts";
import { classifyRuntimeApproval, type RuntimeApprovalClassification } from "@tyr-ai/governance";

export type ServerRuntimeApprovalNormalization = {
  approval: RuntimeApprovalRecord;
  classification: RuntimeApprovalClassification;
  autoResolved: boolean;
  runtimeAccessBlocked: boolean;
};

export type RuntimeApprovalExecutionEvent = {
  kind: RuntimeExecutionEventKind;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  executionStatus: RuntimeExecutionStatus;
};

export function normalizeServerRuntimeApproval(
  approval: RuntimeApprovalRecord,
  now = new Date().toISOString(),
  permissionMode?: RuntimePermissionMode
): ServerRuntimeApprovalNormalization {
  const classification = classifyRuntimeApproval({
    actionKind: approval.kind,
    payload: approvalPayloadForClassification(approval)
  });
  const runtimeAccessBlocked = runtimeApprovalConflictsWithReadOnly(permissionMode, approval.kind, classification);
  const autoApprovable = !runtimeAccessBlocked && (classification === "readonly" || classification === "low_risk_workflow");
  const approvalWithPolicyMetadata = {
    ...approval,
    payload: approvalPayloadWithPolicyMetadata(approval, classification, autoApprovable, runtimeAccessBlocked)
  };
  if (runtimeAccessBlocked && approval.status === "pending") {
    return {
      approval: {
        ...approvalWithPolicyMetadata,
        status: "rejected",
        decision: "reject",
        resolvedAt: approval.resolvedAt ?? now
      },
      classification,
      autoResolved: false,
      runtimeAccessBlocked: true
    };
  }
  if (!autoApprovable || approval.status !== "pending") {
    return { approval: approvalWithPolicyMetadata, classification, autoResolved: false, runtimeAccessBlocked };
  }
  return {
    approval: {
      ...approvalWithPolicyMetadata,
      status: "approved",
      decision: "approve",
      resolvedAt: approval.resolvedAt ?? now
    },
    classification,
    autoResolved: true,
    runtimeAccessBlocked: false
  };
}

export function runtimeApprovalConflictsWithReadOnly(
  permissionMode: RuntimePermissionMode | undefined,
  kind: RuntimeApprovalKind,
  classification: RuntimeApprovalClassification
): boolean {
  if (permissionMode !== "read-only") return false;
  if (kind === "file_change" || kind === "permissions") return true;
  if (kind === "command") return classification !== "readonly" && classification !== "low_risk_workflow";
  // MCP/external tools remain governed by Tyr capability scopes, which are independent of local Runtime Access.
  return false;
}

export function runtimeApprovalExecutionEvent(approval: RuntimeApprovalRecord, classification: RuntimeApprovalClassification): RuntimeApprovalExecutionEvent {
  const payload = approvalEventPayload(approval, classification);
  if (approval.status === "pending") {
    return {
      kind: "approval_request",
      title: approval.title,
      detail: approval.detail,
      payload,
      executionStatus: "waiting_approval"
    };
  }
  if (runtimeAccessBlockedPayload(payload)) {
    return {
      kind: "approval_resolved",
      title: "Blocked by Runtime Access",
      detail: "Read Only Runtime Access blocked this mutation. Change Runtime Access, restart the Agent, and resend the request.",
      payload: { ...payload, failureClassification: "runtime_access_read_only" },
      executionStatus: "failed"
    };
  }
  return {
    kind: "approval_resolved",
    title: "Approval resolved",
    detail: `Runtime approval ${approval.decision ?? approval.status}: ${approval.title}`,
    payload,
    executionStatus: "running"
  };
}

export function runtimeAccessBlockedPayload(payload: unknown): boolean {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).runtimeAccessBlocked === true
  );
}

export function hasRecordedApprovalResolvedEvent(
  events: Array<Pick<RuntimeExecutionEventRecord, "kind" | "payload">>,
  payload: unknown
): boolean {
  const approvalId = approvalIdFromPayload(payload);
  if (!approvalId) return false;
  return events.some((event) => event.kind === "approval_resolved" && approvalIdFromPayload(event.payload) === approvalId);
}

function approvalPayloadForClassification(approval: RuntimeApprovalRecord): unknown {
  const payload = approval.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  if (approval.kind === "command") return { command: approval.detail };
  return payload;
}

function approvalEventPayload(approval: RuntimeApprovalRecord, classification: RuntimeApprovalClassification): Record<string, unknown> {
  const nonBlocking = classification === "readonly" || classification === "low_risk_workflow";
  const metadata = {
    approvalId: approval.id,
    requestId: approval.requestId,
    approvalStatus: approval.status,
    approvalClassification: classification,
    approvalNonBlocking: nonBlocking,
    decision: approval.decision
  };
  if (approval.payload && typeof approval.payload === "object" && !Array.isArray(approval.payload)) {
    return { ...(approval.payload as Record<string, unknown>), ...metadata };
  }
  return {
    value: approval.payload,
    command: approval.kind === "command" ? approval.detail : undefined,
    ...metadata
  };
}

function approvalIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).approvalId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function approvalPayloadWithPolicyMetadata(
  approval: RuntimeApprovalRecord,
  classification: RuntimeApprovalClassification,
  nonBlocking: boolean,
  runtimeAccessBlocked: boolean
): Record<string, unknown> {
  // 这两个字段是 UI 展示语义：自动通过的只读/低风险命令不再表现为阻断型审批。
  const metadata = {
    approvalClassification: classification,
    approvalNonBlocking: nonBlocking,
    runtimeAccessBlocked
  };
  if (approval.payload && typeof approval.payload === "object" && !Array.isArray(approval.payload)) {
    return { ...(approval.payload as Record<string, unknown>), ...metadata };
  }
  return {
    value: approval.payload,
    command: approval.kind === "command" ? approval.detail : undefined,
    ...metadata
  };
}
