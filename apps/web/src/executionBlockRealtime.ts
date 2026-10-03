import type { ExecutionBlockRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";

export function mergeExecutionBlocksFromSnapshot(
  currentItems: ExecutionBlockRecord[],
  snapshotItems: ExecutionBlockRecord[],
  executions: RuntimeExecutionRecord[]
): ExecutionBlockRecord[] {
  const snapshotIds = new Set(snapshotItems.map((item) => item.id));
  const activeRunIds = new Set(executions.filter(isActiveExecution).map((execution) => `run:${execution.id}`));
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const preservedDurableBlocks = currentItems.filter((item) => !snapshotIds.has(item.id) && !isLiveAssistantPreview(item));
  const guardedSnapshotItems = snapshotItems.map((item) => {
    const current = currentById.get(item.id);
    return current ? upsertExecutionBlockGuarded([current], item)[0] : item;
  });
  const maxSnapshotSequence = Math.max(0, ...preservedDurableBlocks.map((item) => item.groupSequence), ...guardedSnapshotItems.map((item) => item.groupSequence));
  const preservedLivePreviews = currentItems.filter((item) =>
    isLiveAssistantPreview(item) &&
    !snapshotIds.has(item.id) &&
    item.runId &&
    activeRunIds.has(item.runId)
  ).map((item, index) => item.groupSequence > maxSnapshotSequence
    ? item
    : { ...item, groupSequence: maxSnapshotSequence + index + 1 });
  return [...preservedDurableBlocks, ...preservedLivePreviews, ...guardedSnapshotItems]
    .reduce<ExecutionBlockRecord[]>((items, block) => upsertExecutionBlockGuarded(items, block), [])
    .sort(compareExecutionBlocks);
}

export function upsertExecutionBlockGuarded(items: ExecutionBlockRecord[], incoming: ExecutionBlockRecord): ExecutionBlockRecord[] {
  const existing = items.find((item) => item.id === incoming.id);
  if (!existing) return [...items, incoming];
  const next = mergeExecutionBlock(existing, incoming);
  return items.map((item) => item.id === incoming.id ? next : item);
}

export function mergeExecutionBlockRealtimePatches(currentItems: ExecutionBlockRecord[], incomingBlocks: ExecutionBlockRecord[]): ExecutionBlockRecord[] {
  const patchesById = new Map<string, ExecutionBlockRecord>();
  for (const block of incomingBlocks) {
    const existing = patchesById.get(block.id);
    patchesById.set(block.id, existing ? mergeExecutionBlock(existing, block) : block);
  }
  return [...patchesById.values()]
    .reduce<ExecutionBlockRecord[]>((items, block) => upsertExecutionBlockGuarded(items, block), currentItems)
    .sort(compareExecutionBlocks);
}

export function executionContentVersion(blocks: ExecutionBlockRecord[]): string {
  return [...blocks]
    .sort(compareExecutionBlocks)
    .map((block) => [
      block.id,
      block.status ?? "",
      block.updatedAt,
      block.bodyPreview?.length ?? 0,
      block.rawEventIds?.length ?? 0
    ].join(":"))
    .join("|");
}

function mergeExecutionBlock(existing: ExecutionBlockRecord, incoming: ExecutionBlockRecord): ExecutionBlockRecord {
  const incomingTime = Date.parse(incoming.updatedAt);
  const existingTime = Date.parse(existing.updatedAt);
  const incomingIsOlder = Number.isFinite(incomingTime) && Number.isFinite(existingTime) && incomingTime < existingTime;
  const assistantTextWouldShrink = isAssistantBlock(existing, incoming) && (incoming.bodyPreview?.length ?? 0) < (existing.bodyPreview?.length ?? 0);
  if (incomingIsOlder && !isTerminalStatus(incoming.status)) return existing;
  if (assistantTextWouldShrink) {
    // preview 和 durable upsert 可能乱序到达；终态可以更新状态，但不能把已显示文本回退成更短版本。
    if (isTerminalStatus(incoming.status)) return { ...existing, ...incoming, bodyPreview: existing.bodyPreview };
    return existing;
  }
  return { ...existing, ...incoming };
}

function isLiveAssistantPreview(block: ExecutionBlockRecord): boolean {
  return block.kind === "assistant_message" &&
    block.status === "running" &&
    (block.rawEventIds?.length ?? 0) === 0;
}

function isActiveExecution(execution: RuntimeExecutionRecord): boolean {
  return execution.status !== "completed" &&
    execution.status !== "failed" &&
    execution.status !== "cancelled" &&
    execution.status !== "stalled";
}

function compareExecutionBlocks(a: ExecutionBlockRecord, b: ExecutionBlockRecord): number {
  return a.groupSequence - b.groupSequence ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id);
}

function isAssistantBlock(existing: ExecutionBlockRecord, incoming: ExecutionBlockRecord): boolean {
  return existing.kind === "assistant_message" && incoming.kind === "assistant_message";
}

function isTerminalStatus(status: ExecutionBlockRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "approved" || status === "rejected" || status === "blocked";
}
