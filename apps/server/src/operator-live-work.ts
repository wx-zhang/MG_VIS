import {
  isCommunicationAgent,
  type CrossWorkspaceMessageRecord,
  type RuntimeExecutionRecord,
  type TopologyLiveExecutionRecord,
  type TopologyLiveWorkPayload,
  type TopologyWorkspaceBridgeMessageRecord
} from "@tyr-ai/contracts";

import type { ServerRouteContext } from "./server-context";
import {
  TOPOLOGY_ACTIVE_EXECUTION_WINDOW_MS,
  TOPOLOGY_TERMINAL_FLOW_WINDOW_MS,
  topologyCommunicationChainIdForExecution,
  topologyCommunicationFlowForExecution,
  topologyDelegationSourceAgentIdForExecution,
  topologyExecutionHasVisibleFlow,
  topologyExecutionIsLive
} from "./topology-communication-flow";
import { topologyBridgeJourneys } from "./topology-bridge-journey";
import { topologyExecutionHasVisibleActivity, topologyLiveActivityForExecution } from "./topology-live-activity";
import { workspaceBridgeRefForExecution } from "./workspace-bridge-delivery";

const LIVE_WORK_LIMIT = 500;
const BRIDGE_MESSAGE_LIMIT_PER_BRIDGE = 12;

type ExecutionContext = {
  execution: RuntimeExecutionRecord;
  workspaceId: string;
};

/**
 * Global Operator 只观察选中 Workspace 的执行状态与交互方向。这里故意不投影
 * 私人 DM 正文、真实 channel/message id、runtime detail 或 thinking summary。
 */
export function operatorLiveWorkPayload(ctx: Pick<ServerRouteContext, "store">, serverId: string): TopologyLiveWorkPayload {
  const { store } = ctx;
  const nowMs = Date.now();
  const activeUpdatedAfter = new Date(nowMs - TOPOLOGY_ACTIVE_EXECUTION_WINDOW_MS).toISOString();
  const terminalUpdatedAfter = new Date(nowMs - TOPOLOGY_TERMINAL_FLOW_WINDOW_MS).toISOString();
  const bridgeTopology = store.workspaceBridgeTopology(serverId);
  const directPeers = bridgeTopology.peerWorkspaceTopologies.filter((peer) => (
    (peer.distance ?? 1) === 1 && peer.bridge?.status === "active"
  ));
  const directActiveBridgeIds = new Set(directPeers.map((peer) => peer.bridgeId));
  const listExecutions = (workspaceId: string): ExecutionContext[] => store.listTopologyRuntimeExecutions({
    serverId: workspaceId,
    activeUpdatedAfter,
    terminalUpdatedAfter,
    limit: 1_000
  }).map((execution) => ({ execution, workspaceId }));

  const localExecutionContexts = listExecutions(serverId);
  // 对端只参与已验证的 direct Bridge journey；不能借 Operator live-work 浏览对端普通执行。
  const bridgeExecutionContexts = directPeers.flatMap((peer) => listExecutions(peer.workspace.id)
    .filter(({ execution }) => {
      const ref = workspaceBridgeRefForExecution(execution);
      return Boolean(ref && ref.bridgeId === peer.bridgeId && directActiveBridgeIds.has(ref.bridgeId));
    }));
  const journeyExecutionContexts = [...localExecutionContexts, ...bridgeExecutionContexts];
  const activeExecutions = localExecutionContexts.filter(({ execution }) => topologyExecutionIsLive(execution, nowMs));
  const flowExecutions = localExecutionContexts.filter(({ execution }) => topologyExecutionHasVisibleFlow(execution, nowMs));
  const activityExecutions = localExecutionContexts.filter(({ execution }) => topologyExecutionHasVisibleActivity(execution, nowMs));
  const visibleExecutions = activeExecutions.slice(0, LIVE_WORK_LIMIT);

  const workspaceIds = new Set([serverId, ...directPeers.map((peer) => peer.workspace.id)]);
  const pendingApprovalByExecutionId = new Map(
    [...workspaceIds].flatMap((workspaceId) => store.listRuntimeApprovals({ serverId: workspaceId, limit: 2_000 }))
      .filter((approval) => approval.status === "pending" && approval.executionId)
      .map((approval) => [approval.executionId as string, approval.id])
  );
  const eventExecutionIds = Array.from(new Set([
    ...visibleExecutions.map(({ execution }) => execution.id),
    ...activityExecutions.slice(0, LIVE_WORK_LIMIT).map(({ execution }) => execution.id),
    ...journeyExecutionContexts.map(({ execution }) => execution.id)
  ]));
  const runtimeEventsByExecutionId = new Map<string, ReturnType<typeof store.listTopologyRuntimeExecutionEvents>>();
  for (const event of store.listTopologyRuntimeExecutionEvents(eventExecutionIds)) {
    const events = runtimeEventsByExecutionId.get(event.executionId) ?? [];
    events.push(event);
    runtimeEventsByExecutionId.set(event.executionId, events);
  }
  const runtimeEventsForExecution = (executionId: string) => runtimeEventsByExecutionId.get(executionId) ?? [];
  const controllerAgent = store.listAgents(serverId).find((agent) => isCommunicationAgent(agent));
  const chainIdByExecutionId = new Map<string, string>();
  const chainIdForExecution = (execution: RuntimeExecutionRecord): string => {
    const cached = chainIdByExecutionId.get(execution.id);
    if (cached) return cached;
    const chainId = topologyCommunicationChainIdForExecution(execution, (executionId) => store.getRuntimeExecution(executionId));
    chainIdByExecutionId.set(execution.id, chainId);
    return chainId;
  };

  const projectedFlows = flowExecutions.flatMap(({ execution }) => {
    const sourceExecution = execution.sourceExecutionId ? store.getRuntimeExecution(execution.sourceExecutionId) : null;
    const executionMessage = store.getMessage(execution.messageId);
    const delegationSourceAgentId = topologyDelegationSourceAgentIdForExecution({
      execution,
      message: executionMessage,
      channel: executionMessage ? store.resolveTarget(executionMessage.channelId, serverId) : null
    });
    const bridgeRef = workspaceBridgeRefForExecution(execution);
    const projected = topologyCommunicationFlowForExecution({
      execution,
      sourceExecution,
      chainId: chainIdForExecution(execution),
      delegationSourceAgentId,
      bridgeControllerAgentId: bridgeRef ? controllerAgent?.id : undefined,
      bridgeRequestMessageId: bridgeRef?.requestMessageId,
      workspaceId: serverId
    });
    return projected ? [projected] : [];
  });
  const projectedActivities = activityExecutions.slice(0, LIVE_WORK_LIMIT).flatMap(({ execution }) => {
    const projected = topologyLiveActivityForExecution({
      execution,
      events: runtimeEventsForExecution(execution.id),
      pendingApprovalId: pendingApprovalByExecutionId.get(execution.id),
      workspaceId: serverId,
      nowMs
    });
    // thinking summary may contain private runtime output; Operator only needs the semantic activity phase.
    return projected ? [{ ...projected, summary: undefined }] : [];
  });
  const bridgeMessages = [...new Map(
    directPeers.flatMap((peer) => store.listCrossWorkspaceMessagesPage(peer.bridgeId, {
      limit: BRIDGE_MESSAGE_LIMIT_PER_BRIDGE
    }).messages).map((message) => [message.id, message] as const)
  ).values()];
  const projectedBridgeJourneys = topologyBridgeJourneys({
    messages: bridgeMessages,
    executions: journeyExecutionContexts.flatMap(({ execution }) => {
      const ref = workspaceBridgeRefForExecution(execution);
      if (!ref || !directActiveBridgeIds.has(ref.bridgeId)) return [];
      return [{
        execution,
        bridgeRequestMessageId: ref.requestMessageId,
        events: runtimeEventsForExecution(execution.id),
        pendingApprovalId: pendingApprovalByExecutionId.get(execution.id)
      }];
    }),
    nowMs
  });

  return {
    executions: visibleExecutions.map(({ execution }) => operatorLiveExecution(store, execution, serverId)),
    flows: projectedFlows.slice(0, LIVE_WORK_LIMIT),
    activities: projectedActivities,
    bridgeMessages: bridgeMessages.map(topologyWorkspaceBridgeMessage),
    bridgeJourneys: projectedBridgeJourneys.slice(0, LIVE_WORK_LIMIT),
    truncated: activeExecutions.length > LIVE_WORK_LIMIT
      || projectedFlows.length > LIVE_WORK_LIMIT
      || activityExecutions.length > LIVE_WORK_LIMIT
  };
}

function operatorLiveExecution(
  store: ServerRouteContext["store"],
  execution: RuntimeExecutionRecord,
  workspaceId: string
): TopologyLiveExecutionRecord {
  const sourceExecution = execution.sourceExecutionId ? store.getRuntimeExecution(execution.sourceExecutionId) : null;
  const sourceAgent = sourceExecution ? store.getAgent(sourceExecution.agentId) : null;
  const targetAgent = store.getAgent(execution.agentId);
  return {
    id: execution.id,
    agentId: execution.agentId,
    machineId: execution.machineId,
    runtime: execution.runtime,
    status: execution.status as TopologyLiveExecutionRecord["status"],
    taskId: execution.taskId,
    sourceExecutionId: execution.sourceExecutionId,
    sourceAgentId: sourceAgent?.id,
    sourceAgentName: sourceAgent?.displayName,
    // Pseudo identifiers preserve the renderer contract without disclosing a private DM locator.
    sourceChannelId: `operator-workspace:${workspaceId}`,
    sourceChannelType: "dm",
    sourceMessageId: `operator-execution:${execution.id}`,
    title: targetAgent ? `${targetAgent.displayName} execution` : "Workspace execution",
    workspaceId,
    sourceLabel: sourceAgent ? `Delegated by ${sourceAgent.displayName}` : "Workspace activity",
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt
  };
}

function topologyWorkspaceBridgeMessage(message: CrossWorkspaceMessageRecord): TopologyWorkspaceBridgeMessageRecord {
  return {
    id: message.id,
    bridgeId: message.bridgeId,
    sourceWorkspaceId: message.sourceWorkspaceId,
    targetWorkspaceId: message.targetWorkspaceId,
    senderCommsAgentId: message.senderCommsAgentId,
    receiverCommsAgentId: message.receiverCommsAgentId,
    outcome: message.outcome,
    responseKind: message.responseKind,
    peerMessageId: message.peerMessageId,
    replyToMessageId: message.replyToMessageId,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt ?? message.createdAt
  };
}
