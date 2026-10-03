import type { AppSnapshot } from "@tyr-ai/contracts";
import { trimRuntimeEventsForRealtime } from "./runtimeRealtime";

const LEGACY_SYNC_MESSAGE_LIMIT = 100;

export function sanitizeWorkspaceSyncPayload(workspaceCache: AppSnapshot): AppSnapshot {
  return {
    ...workspaceCache,
    messages: (workspaceCache.messages ?? []).length > LEGACY_SYNC_MESSAGE_LIMIT ? [] : workspaceCache.messages ?? [],
    runtimeExecutionEvents: trimRuntimeEventsForRealtime(workspaceCache.runtimeExecutionEvents ?? []),
    executionBlocks: []
  };
}
