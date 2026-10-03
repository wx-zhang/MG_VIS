export interface CommunicationWorkerOutcome {
  status: "completed" | "partial" | "failed";
  needsInformation: boolean;
}

/** Only explicit protocol state is interpreted here; narrative text is not an authorization. */
export function communicationWorkerOutcome(content: string, eventKind?: string): CommunicationWorkerOutcome {
  let value: unknown;
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      value = (parsed as { status?: unknown; outcome?: unknown }).status ??
        (parsed as { outcome?: unknown }).outcome;
    }
  } catch {
    // Older runtimes use a top-level Status/Outcome line rather than a JSON object.
    value = content.match(/^\s*(?:status|outcome)\s*:\s*([a-z_]+)\b/im)?.[1];
  }
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (["failed", "error", "cancelled"].includes(status)) return { status: "failed", needsInformation: false };
  const needsInformation = eventKind === "question" || status === "needs_information";
  if (needsInformation || eventKind === "action_request" || eventKind === "progress" ||
      ["pending", "partial", "waiting", "in_progress", "action_required"].includes(status)) {
    return { status: "partial", needsInformation };
  }
  return { status: "completed", needsInformation: false };
}
