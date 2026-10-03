import type { DaemonInbound, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { GovernanceApprovalNormalization } from "./governance-runtime";

export type RuntimeApprovalGovernanceApplication = {
  approval: GovernanceApprovalNormalization["approval"];
  daemonResolve?: Extract<DaemonInbound, { type: "agent:runtime_approval:resolve" }>;
};

export function runtimeApprovalGovernanceApplication(
  normalized: GovernanceApprovalNormalization,
  execution?: RuntimeExecutionRecord | null
): RuntimeApprovalGovernanceApplication {
  if (normalized.autoResolved) {
    return {
      approval: normalized.approval,
      daemonResolve: runtimeApprovalResolveMessage(normalized.approval, "approve", execution)
    };
  }
  if (normalized.autoRejected) {
    return {
      approval: normalized.approval,
      daemonResolve: runtimeApprovalResolveMessage(normalized.approval, "reject", execution)
    };
  }
  return { approval: normalized.approval };
}

function runtimeApprovalResolveMessage(
  approval: GovernanceApprovalNormalization["approval"],
  decision: "approve" | "reject",
  execution?: RuntimeExecutionRecord | null
): Extract<DaemonInbound, { type: "agent:runtime_approval:resolve" }> {
  return {
    type: "agent:runtime_approval:resolve",
    agentId: approval.agentId,
    approvalId: approval.id,
    requestId: approval.requestId,
    ...(execution ? {
      executionId: execution.id,
      ...(execution.runtimeContextKey && execution.runtimeSessionRecordId ? {
        contextKey: execution.runtimeContextKey,
        sessionRecordId: execution.runtimeSessionRecordId
      } : {})
    } : {}),
    decision
  };
}
