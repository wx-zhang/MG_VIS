import type { AppSnapshot, TopologyExecutionOpenTarget, WorkspaceBridgeRecord } from "@tyr-ai/contracts";
import { chatPathForChannel } from "./routing";

export function topologyExecutionConversationPath(target: TopologyExecutionOpenTarget): string | null {
  if (target.kind !== "conversation") return null;
  return chatPathForChannel(
    { id: target.channelId, type: target.channelType },
    target.messageId,
    target.conversationId,
    target.approvalId
  );
}

export function topologyExecutionBridge(
  snapshot: Pick<AppSnapshot, "workspaceBridges" | "incomingWorkspaceBridges" | "workspaceBridgeTopologyEdges">,
  bridgeId: string
): WorkspaceBridgeRecord | undefined {
  return (snapshot.workspaceBridges ?? []).find((item) => item.id === bridgeId)
    ?? (snapshot.incomingWorkspaceBridges ?? []).find((item) => item.id === bridgeId)
    ?? (snapshot.workspaceBridgeTopologyEdges ?? []).find((item) => item.bridgeId === bridgeId)?.bridge;
}
