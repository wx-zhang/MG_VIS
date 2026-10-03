import type { RuntimeApprovalRecord } from "@tyr-ai/contracts";

export function runtimeApprovalActivityText(approval: Pick<RuntimeApprovalRecord, "status" | "title" | "detail">): string {
  const prefix = approval.status === "pending" ? "Pending approval"
    : approval.status === "approved" ? "Approved approval"
      : approval.status === "rejected" ? "Rejected approval"
        : "Custom approval";
  return `${prefix}: ${approval.title} ${approval.detail}`.trim();
}
