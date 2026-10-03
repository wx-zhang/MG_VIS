import type { AssistantToolLoopResult, AssistantToolLoopStep } from "./assistant-llm";

export function isEvidenceSelection(step: AssistantToolLoopStep): boolean {
  return (step.call?.name ?? step.rawCall.name) === "select_result_evidence";
}

/** A validated replacement supersedes only failed selections, never another failed operation. */
export function effectiveAssistantToolSteps(result: AssistantToolLoopResult): AssistantToolLoopStep[] {
  const last = result.steps.filter(isEvidenceSelection).at(-1);
  return last?.result?.status === "completed"
    ? result.steps.filter((step) => !isEvidenceSelection(step) || step === last)
    : result.steps;
}
