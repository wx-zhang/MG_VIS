import type { AppSnapshot, TopologyLiveWorkPayload } from "@tyr-ai/contracts";

export type WorkspaceSpatialStressMode = "idle" | "mixed" | "offline-late";

export interface WorkspaceSpatialStressFixtureOptions {
  mode?: WorkspaceSpatialStressMode;
  currentWorkspaceId?: string;
  ownerUserId?: string;
}

export interface WorkspaceSpatialStressFixtureMeta {
  currentWorkspaceId: string;
  directPeerWorkspaceId: string;
  transitiveWorkspaceId: string;
  revokedWorkspaceId: string;
  activeBridgeId: string;
  offlineDeviceId: string;
  hiddenActiveAgentId: string;
  expectedWorkspaceCount: number;
  expectedDeviceCount: number;
  expectedAgentCount: number;
  expectedHiddenAgentCount: number;
  expectedChainCount: number;
  latestChainId: string | null;
}

export function workspaceSpatialStressFixture(options?: WorkspaceSpatialStressFixtureOptions): {
  snapshot: AppSnapshot;
  liveWork: TopologyLiveWorkPayload;
  meta: WorkspaceSpatialStressFixtureMeta;
};
