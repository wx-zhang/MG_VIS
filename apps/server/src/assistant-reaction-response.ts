import type { AssistantToolLoopStep } from "./assistant-llm";

export const REACTION_ONLY_RESPONSE = "[REACTION_ONLY]";

export function isSuccessfulReaction(step: AssistantToolLoopStep): boolean {
  return (step.call?.name ?? step.rawCall.name) === "react_to_message" && !step.errorCode &&
    (step.result?.status === "completed" || step.result?.status === "noop");
}

/** Empty model output is valid only when a native reaction has actually succeeded. */
export function canFinishWithReaction(steps: AssistantToolLoopStep[]): boolean {
  return steps.some((step) => isSuccessfulReaction(step) && step.result?.status === "completed") &&
    steps.every(isSuccessfulReaction);
}

export function isReactionConfirmation(content: string, steps: AssistantToolLoopStep[]): boolean {
  const text = content.trim();
  if (text === REACTION_ONLY_RESPONSE) return true;
  return steps.some((step) => {
    if (step.result?.message.trim() === text) return true;
    const args = step.rawCall.arguments;
    const emoji = args && typeof args === "object" && "emoji" in args ? args.emoji : undefined;
    // Providers sometimes emit the same emoji instead of an empty final answer.
    // Compare only the successfully applied emoji, never classify arbitrary prose by keywords.
    return typeof emoji === "string" && Boolean(emoji) && text.replaceAll("\uFE0F", "") === emoji.replaceAll("\uFE0F", "");
  });
}
