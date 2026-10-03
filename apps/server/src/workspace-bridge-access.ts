import type { WorkspaceBridgeOperationalAccess } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

export interface WorkspaceBridgeCapability extends WorkspaceBridgeOperationalAccess {
  requestingUserId: string;
}

/**
 * 只解析请求方当前 Workspace 与目标 Workspace 之间的直接 active Bridge。
 * 对端的其他连接不能授予拓扑或远端资源权限；Guest 不获得 Bridge capability，
 * 每次鉴权都重建直接连接视图，使撤销立即生效。
 */
export function resolveWorkspaceBridgeCapability(
  store: Pick<TyrDb, "getActiveServerIdForUser" | "listServersForUser" | "workspaceBridgeTopology">,
  requestingUserId: string,
  targetWorkspaceId: string
): WorkspaceBridgeCapability | null {
  const sourceWorkspaceId = store.getActiveServerIdForUser(requestingUserId);
  if (!sourceWorkspaceId || sourceWorkspaceId === targetWorkspaceId) return null;
  const sourceMembership = store.listServersForUser(requestingUserId)
    .find((server) => server.id === sourceWorkspaceId);
  if (!sourceMembership || sourceMembership.role === "guest") return null;
  const peer = store.workspaceBridgeTopology(sourceWorkspaceId).peerWorkspaceTopologies
    .find((item) => item.workspace.id === targetWorkspaceId);
  if (!peer) return null;
  return {
    fullAccess: true,
    requestingUserId,
    sourceWorkspaceId,
    targetWorkspaceId,
    capabilityUserId: peer.workspace.ownerUserId,
    bridgePath: peer.bridgePath ?? [peer.bridgeId],
    distance: peer.distance ?? 1
  };
}
