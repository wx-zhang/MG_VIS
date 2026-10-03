import type { CrossWorkspaceMessageRecord, RuntimeExecutionEventRecord, RuntimeExecutionRecord, WorkspaceBridgeRequestState, WorkspaceBridgeRequestStatusPayload } from "@tyr-ai/contracts";

export const BRIDGE_RESULT_REVIEW_GRACE_MS = 120_000;

/** Shared with both Bridge ends. Labels are server-authored, never worker text. */
export function workspaceBridgeProgress(input: {
  request: CrossWorkspaceMessageRecord;
  state: WorkspaceBridgeRequestState;
  updatedAt: string;
  executions: RuntimeExecutionRecord[];
  events: RuntimeExecutionEventRecord[];
  replies: CrossWorkspaceMessageRecord[];
  hasOpenChild: boolean;
  childNeedsAttention: boolean;
  nowMs?: number;
}): NonNullable<WorkspaceBridgeRequestStatusPayload["progress"]> {
  const eventLabels: Record<string, string> = {
    queued: "Execution queued", delivered: "Sent to Device", delivery_acknowledged: "Device accepted the request",
    turn_started: "Execution started", tool_call: "Tool step started", tool_output: "Tool step returned",
    turn_completed: "Execution finished", failed: "Execution failed", stalled: "Execution stopped reporting progress",
    cancelled: "Execution cancelled", approval_request: "Approval requested"
  };
  const replyLabels: Record<string, string> = {
    ack: "Request accepted", progress: "TYR progress received", question: "TYR requested information",
    action_request: "TYR reported a remaining step", answer: "Information received", instruction: "Instruction received",
    continue: "Continuation requested", final: "Result returned", error: "Failure returned"
  };
  const events = [
    { kind: "request", label: "Bridge request received", at: input.request.createdAt },
    ...input.events.flatMap((event) => eventLabels[event.kind]
      ? [{ kind: event.kind, label: eventLabels[event.kind]!, at: event.at }]
      : event.kind === "diagnostic" && event.title === "Final reply received"
        ? [{ kind: "final_received", label: "Final Agent result saved", at: event.at }] : []),
    ...input.replies.flatMap((reply) => reply.responseKind && replyLabels[reply.responseKind]
      ? [{ kind: reply.responseKind, label: replyLabels[reply.responseKind]!, at: reply.createdAt }] : [])
  ].sort((a, b) => a.at.localeCompare(b.at));
  const lastEventAt = [input.updatedAt, ...input.executions.map((e) => e.updatedAt), ...events.map((e) => e.at)].sort().at(-1)!;
  const stale = (input.nowMs ?? Date.now()) - Date.parse(lastEventAt) > BRIDGE_RESULT_REVIEW_GRACE_MS;
  const active = input.executions.some((e) => ["queued", "delivered", "running", "waiting_approval"].includes(e.status));
  const latestInteraction = input.replies.filter((reply) =>
    ["question", "action_request", "answer", "instruction", "continue", "progress"].includes(reply.responseKind ?? ""))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  const waitingForInformation = latestInteraction?.responseKind === "question" || latestInteraction?.responseKind === "action_request";
  let stage: NonNullable<WorkspaceBridgeRequestStatusPayload["progress"]>["stage"] = input.state === "blocked_on_peer_approval"
    ? "waiting_approval" : input.state;
  let summary: string;
  if (input.state === "completed") summary = "The Bridge result was returned.";
  else if (input.state === "failed") summary = input.executions.length > 0 && input.executions.every((e) => e.status === "completed")
    ? "Local execution finished, but the Bridge result could not be returned successfully. Review the request diagnostics."
    : "The Bridge request failed.";
  else if (input.state === "blocked_on_peer_approval") summary = "Waiting for approval in a connected workspace.";
  else if (waitingForInformation) {
    // Only peer TYR-reviewed, already published text may describe the missing information.
    stage = "needs_attention"; summary = latestInteraction.content;
  }
  else if (input.childNeedsAttention) {
    stage = "needs_attention"; summary = "A step in the connected workflow needs attention.";
  } else if (input.hasOpenChild) {
    stage = stale ? "needs_attention" : "running";
    summary = stale ? "No recent progress has been confirmed for a connected step. Its outcome is not yet confirmed. Review the request diagnostics."
      : "Waiting for a step in the connected workflow.";
  } else if (active) {
    stage = stale ? "needs_attention" : "running";
    summary = stale ? "The execution has stopped reporting progress. Its outcome is not yet confirmed. Review the request diagnostics."
      : "The connected workspace is processing the request.";
  } else if (input.executions.some((e) => e.status === "completed")) {
    stage = stale ? "needs_attention" : "reviewing_result";
    summary = stale ? "Execution finished, but the Bridge result has not been returned. Review the request diagnostics."
      : "Execution finished; TYR is reviewing the result.";
  } else if (stale) {
    stage = "needs_attention"; summary = "No execution progress has been confirmed. Review the request diagnostics.";
  } else summary = "Request delivered; waiting for execution progress.";
  return { stage, summary, diagnosticId: input.request.traceId ?? input.request.id, lastEventAt, events: events.slice(-20) };
}
