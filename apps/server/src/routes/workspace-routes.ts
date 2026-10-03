import type express from "express";
import { isCommunicationAgent, type ChannelType, type CrossWorkspaceMessageRecord, type RuntimeExecutionRecord, type TopologyExecutionOpenTarget, type TopologyLiveExecutionRecord, type TopologyLiveWorkPayload, type TopologyWorkspaceBridgeMessageRecord, type WorkspaceNavigationSection } from "@tyr-ai/contracts";
import type { ServerRouteContext } from "../server-context";
import { canUserAccessRuntimeExecutionSource, runtimeExecutionSourceChannelId } from "../conversation-source-access";
import { sanitizeHumanVisibleText, sanitizeHumanVisibleValue } from "../output-disclosure";
import { runtimeUpdateAvailable, withLatestRuntimeSha } from "../runtime-release";
import {
  TOPOLOGY_ACTIVE_EXECUTION_WINDOW_MS,
  TOPOLOGY_TERMINAL_FLOW_WINDOW_MS,
  topologyCommunicationChainIdForExecution,
  topologyCommunicationFlowForExecution,
  topologyDelegationSourceAgentIdForExecution,
  topologyExecutionHasVisibleFlow,
  topologyExecutionIsLive
} from "../topology-communication-flow";
import { topologyExecutionHasVisibleActivity, topologyLiveActivityForExecution } from "../topology-live-activity";
import { topologyBridgeJourneys } from "../topology-bridge-journey";
import { workspaceBridgeRefForExecution } from "../workspace-bridge-delivery";

const TOPOLOGY_LIVE_WORK_LIMIT = 500;
const TOPOLOGY_BRIDGE_MESSAGE_LIMIT_PER_BRIDGE = 12;

function topologyWorkspaceBridgeMessage(message: CrossWorkspaceMessageRecord): TopologyWorkspaceBridgeMessageRecord {
  // 动画恢复投影严格排除正文、附件、账号与 conversation 元数据，避免 live-work 成为 Bridge 历史旁路。
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

export function registerWorkspaceRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { authUser, store, latestRuntimeSha = () => undefined } = ctx;

  app.get("/api/workspace/bootstrap", (req, res) => {
    res.json(withLatestRuntimeSha(store.workspaceBootstrap(authUser(req).id), latestRuntimeSha()));
  });

  app.get("/api/workspace/navigation", (req, res) => {
    const section = navigationSection(req.query.section);
    if (!section) {
      res.status(400).json({ error: "invalid_navigation_section" });
      return;
    }
    // Navigation rows are the only bootstrap-adjacent lists; every section is cursor paginated.
    const navigation = store.workspaceNavigation(authUser(req).id, {
      section,
      limit: positiveInt(req.query.limit),
      cursor: stringValue(req.query.cursor)
    });
    if (section === "machines") {
      const latest = latestRuntimeSha();
      res.json({
        ...navigation,
        items: navigation.items.map((item) => {
          const runtimeSha = typeof (item as { runtimeSha?: unknown }).runtimeSha === "string"
            ? (item as { runtimeSha?: string }).runtimeSha
            : undefined;
          return {
            ...item,
            latestRuntimeSha: latest,
            // Navigation is the Computers page data source, so it carries the same actionable release state as list APIs.
            runtimeUpdateAvailable: runtimeUpdateAvailable(runtimeSha, latest)
          };
        })
      });
      return;
    }
    res.json(navigation);
  });

  app.get("/api/topology/live-work", (req, res) => {
    const user = authUser(req);
    const serverId = store.getActiveServerIdForUser(user.id);
    if (!serverId) {
      res.json({ executions: [], flows: [], activities: [], bridgeMessages: [], bridgeJourneys: [], truncated: false } satisfies TopologyLiveWorkPayload);
      return;
    }

    const nowMs = Date.now();
    const membership = store.listServersForUser(user.id).find((server) => server.id === serverId);
    // Guest 的本地可见执行仍走原 ACL，但不能通过 Live Queue 获取 Bridge 对端或内部会话执行。
    const bridgeTopology = membership?.role === "owner" || membership?.role === "member"
      ? store.workspaceBridgeTopology(serverId)
      : { peerWorkspaceTopologies: [], workspaceBridgeTopologyEdges: [] };
    const directActiveBridgeIds = new Set(bridgeTopology.peerWorkspaceTopologies
      .filter((peer) => (peer.distance ?? 1) === 1 && peer.bridge?.status === "active")
      .map((peer) => peer.bridgeId));
    const workspaceContexts = [
      { workspaceId: serverId, bridgePath: undefined as string[] | undefined, local: true },
      ...bridgeTopology.peerWorkspaceTopologies.map((peer) => ({
        workspaceId: peer.workspace.id,
        bridgePath: peer.bridgePath ?? [peer.bridgeId],
        local: false
      }))
    ];
    const executionContexts = workspaceContexts.flatMap((workspace) => (
      store.listTopologyRuntimeExecutions({
        serverId: workspace.workspaceId,
        activeUpdatedAfter: new Date(nowMs - TOPOLOGY_ACTIVE_EXECUTION_WINDOW_MS).toISOString(),
        terminalUpdatedAfter: new Date(nowMs - TOPOLOGY_TERMINAL_FLOW_WINDOW_MS).toISOString(),
        limit: 1_000
      })
        // Bridge 落地执行位于内部 Agent-pair DM；仅当服务端 ref 证明它来自当前 Workspace 的直接 active Bridge 时，
        // 才允许目标 Workspace 看见本地 TYR -> worker 队列，其他内部 DM 继续受普通会话 ACL 隔离。
        .filter((execution) => {
          if (!workspace.local || canUserAccessRuntimeExecutionSource(store, user.id, execution)) return true;
          const bridgeRef = workspaceBridgeRefForExecution(execution);
          return Boolean(
            bridgeRef
            && bridgeRef.targetWorkspaceId === serverId
            && directActiveBridgeIds.has(bridgeRef.bridgeId)
          );
        })
        .map((execution) => ({ execution, workspaceId: workspace.workspaceId, bridgePath: workspace.bridgePath }))
    ));
    const activeExecutions = executionContexts.filter(({ execution }) => topologyExecutionIsLive(execution, nowMs));
    const flowExecutions = executionContexts.filter(({ execution }) => topologyExecutionHasVisibleFlow(execution, nowMs));
    const activityExecutions = executionContexts.filter(({ execution }) => topologyExecutionHasVisibleActivity(execution, nowMs));
    const visibleExecutions = activeExecutions.slice(0, TOPOLOGY_LIVE_WORK_LIMIT);
    const pendingApprovalByExecutionId = new Map(
      workspaceContexts.flatMap((workspace) => store.listRuntimeApprovals({ serverId: workspace.workspaceId, limit: 2_000 }))
        .filter((approval) => approval.status === "pending" && approval.executionId)
        .map((approval) => [approval.executionId as string, approval.id])
    );
    const eventExecutionIds = Array.from(new Set([
      ...visibleExecutions.map(({ execution }) => execution.id),
      ...activityExecutions.slice(0, TOPOLOGY_LIVE_WORK_LIMIT).map(({ execution }) => execution.id)
    ]));
    const runtimeEventsByExecutionId = new Map<string, ReturnType<typeof store.listTopologyRuntimeExecutionEvents>>();
    for (const event of store.listTopologyRuntimeExecutionEvents(eventExecutionIds)) {
      const events = runtimeEventsByExecutionId.get(event.executionId) ?? [];
      events.push(event);
      runtimeEventsByExecutionId.set(event.executionId, events);
    }
    // 批量查询已按 sequence 排序；无事件 execution 使用空数组保持原有投影回退语义。
    const runtimeEventsForExecution = (executionId: string) => runtimeEventsByExecutionId.get(executionId) ?? [];
    const controllerAgentIdByWorkspaceId = new Map(workspaceContexts.map((workspace) => [
      workspace.workspaceId,
      store.listAgents(workspace.workspaceId).find((agent) => isCommunicationAgent(agent))?.id
    ]));
    const chainIdByExecutionId = new Map<string, string>();
    const chainIdForExecution = (execution: RuntimeExecutionRecord): string => {
      const cached = chainIdByExecutionId.get(execution.id);
      if (cached) return cached;
      // chainId 只关联已存在的 execution lineage，不携带消息内容，也不扩大当前请求的可见节点范围。
      const chainId = topologyCommunicationChainIdForExecution(execution, (executionId) => store.getRuntimeExecution(executionId));
      chainIdByExecutionId.set(execution.id, chainId);
      return chainId;
    };

    const projectedFlows = flowExecutions.flatMap(({ execution, workspaceId, bridgePath }) => {
      const sourceExecution = execution.sourceExecutionId ? store.getRuntimeExecution(execution.sourceExecutionId) : null;
      const executionMessage = store.getMessage(execution.messageId);
      const delegationSourceAgentId = topologyDelegationSourceAgentIdForExecution({
        execution,
        message: executionMessage,
        channel: executionMessage ? store.resolveTarget(executionMessage.channelId, workspaceId) : null
      });
      const bridgeRef = workspaceBridgeRefForExecution(execution);
      const bridgeControllerAgentId = bridgeRef
        ? controllerAgentIdByWorkspaceId.get(workspaceId)
        : undefined;
      const projected = topologyCommunicationFlowForExecution({
        execution,
        sourceExecution,
        chainId: chainIdForExecution(execution),
        delegationSourceAgentId,
        bridgeControllerAgentId,
        bridgeRequestMessageId: bridgeRef?.requestMessageId,
        workspaceId,
        bridgePath
      });
      return projected ? [projected] : [];
    });
    const projectedActivities = activityExecutions.slice(0, TOPOLOGY_LIVE_WORK_LIMIT).flatMap(({ execution, workspaceId }) => {
      const projected = topologyLiveActivityForExecution({
        execution,
        events: runtimeEventsForExecution(execution.id),
        pendingApprovalId: pendingApprovalByExecutionId.get(execution.id),
        workspaceId,
        nowMs
      });
      return projected ? [projected] : [];
    });
    const bridgeMessages = [...new Map(
      bridgeTopology.peerWorkspaceTopologies
        .filter((peer) => directActiveBridgeIds.has(peer.bridgeId))
        .flatMap((peer) => (
          store.listCrossWorkspaceMessagesPage(peer.bridgeId, { limit: TOPOLOGY_BRIDGE_MESSAGE_LIMIT_PER_BRIDGE }).messages
        ))
        .map((message) => [message.id, message] as const)
    ).values()];
    const projectedBridgeJourneys = topologyBridgeJourneys({
      messages: bridgeMessages,
      executions: executionContexts.flatMap(({ execution }) => {
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
    const payload: TopologyLiveWorkPayload = {
      executions: visibleExecutions.flatMap(({ execution, workspaceId, bridgePath }) => {
        const projected = topologyLiveExecution(
          execution,
          pendingApprovalByExecutionId.get(execution.id),
          store,
          workspaceId,
          bridgePath,
          runtimeEventsForExecution(execution.id).at(-1)
        );
        return projected ? [projected] : [];
      }),
      flows: projectedFlows.slice(0, TOPOLOGY_LIVE_WORK_LIMIT),
      activities: projectedActivities.slice(0, TOPOLOGY_LIVE_WORK_LIMIT),
      bridgeMessages: bridgeMessages.map(topologyWorkspaceBridgeMessage),
      bridgeJourneys: projectedBridgeJourneys.slice(0, TOPOLOGY_LIVE_WORK_LIMIT),
      // 普通 source-less execution 不会生成通信流，也不能占满通信流的可见上限。
      truncated: activeExecutions.length > TOPOLOGY_LIVE_WORK_LIMIT
        || projectedFlows.length > TOPOLOGY_LIVE_WORK_LIMIT
        || activityExecutions.length > TOPOLOGY_LIVE_WORK_LIMIT
    };
    res.json(payload);
  });

  app.get("/api/topology/live-work/executions/:executionId/target", (req, res) => {
    const user = authUser(req);
    const serverId = store.getActiveServerIdForUser(user.id);
    const execution = store.getRuntimeExecution(req.params.executionId);
    if (!serverId || !execution) {
      res.status(404).json({ error: "topology_execution_target_not_found" });
      return;
    }

    const executionWorkspaceId = execution.serverId ?? store.getAgent(execution.agentId)?.serverId;
    if (executionWorkspaceId === serverId && canUserAccessRuntimeExecutionSource(store, user.id, execution)) {
      const sourceMessage = store.getMessage(execution.rootMessageId ?? execution.messageId)
        ?? store.getMessage(execution.messageId);
      const channelId = runtimeExecutionSourceChannelId(store, execution);
      if (!sourceMessage || !channelId || !isChannelType(sourceMessage.channelType)) {
        res.status(404).json({ error: "topology_execution_target_not_found" });
        return;
      }
      const approvalId = store.listRuntimeApprovals({ executionId: execution.id, limit: 1_000 })
        .find((approval) => approval.status === "pending")?.id;
      const target: TopologyExecutionOpenTarget = {
        kind: "conversation",
        executionId: execution.id,
        channelId,
        channelType: sourceMessage.channelType,
        messageId: sourceMessage.id,
        conversationId: sourceMessage.conversationId,
        approvalId
      };
      res.json(target);
      return;
    }

    const membership = store.listServersForUser(user.id).find((server) => server.id === serverId);
    // 本地私聊定位已在上方校验；跨 Workspace 的定位不能向 Guest 暴露 Bridge ID。
    if (membership?.role !== "owner" && membership?.role !== "member") {
      res.status(404).json({ error: "topology_execution_target_not_found" });
      return;
    }
    const bridgeTopology = store.workspaceBridgeTopology(serverId);
    const bridgeRef = workspaceBridgeRefForExecution(execution);
    const localBridgePeer = executionWorkspaceId === serverId && bridgeRef?.targetWorkspaceId === serverId
      ? bridgeTopology.peerWorkspaceTopologies.find((candidate) => (
          candidate.bridgeId === bridgeRef.bridgeId
          && (candidate.distance ?? 1) === 1
          && candidate.bridge?.status === "active"
        ))
      : undefined;
    if (localBridgePeer && bridgeRef) {
      // Bridge 内部 Agent-pair DM 不向 Human 暴露；本地 owner 从 Flow 回到直接 Bridge 审计面。
      const target: TopologyExecutionOpenTarget = {
        kind: "workspace_bridge",
        executionId: execution.id,
        bridgeId: bridgeRef.bridgeId
      };
      res.json(target);
      return;
    }
    const peer = bridgeTopology.peerWorkspaceTopologies.find((candidate) => (
      candidate.workspace.id === executionWorkspaceId
      && (candidate.distance ?? 1) === 1
    ));
    const bridge = peer
      ? store.getWorkspaceBridgeForServer(peer.bridgeId, serverId) ?? peer.bridge
      : null;
    const bridgeMatchesExecution = Boolean(
      peer
      && bridgeRef
      && bridgeRef.bridgeId === peer.bridgeId
      && new Set([bridgeRef.sourceWorkspaceId, bridgeRef.targetWorkspaceId]).has(serverId)
      && new Set([bridgeRef.sourceWorkspaceId, bridgeRef.targetWorkspaceId]).has(peer.workspace.id)
    );
    // 对端 Runtime source 仍是私有数据；这里只返回当前 Workspace 直接拥有的 active Bridge。
    if (!peer || !bridge || bridge.status !== "active" || !bridgeMatchesExecution) {
      res.status(404).json({ error: "topology_execution_target_not_found" });
      return;
    }
    const target: TopologyExecutionOpenTarget = {
      kind: "workspace_bridge",
      executionId: execution.id,
      bridgeId: peer.bridgeId
    };
    res.json(target);
  });

}

function topologyLiveExecution(
  execution: RuntimeExecutionRecord,
  pendingApprovalId: string | undefined,
  store: ServerRouteContext["store"],
  workspaceId: string,
  bridgePath?: string[],
  latestEvent?: ReturnType<ServerRouteContext["store"]["listRuntimeExecutionEvents"]>[number]
): TopologyLiveExecutionRecord | null {
  const sourceMessage = store.getMessage(execution.rootMessageId ?? execution.messageId)
    ?? store.getMessage(execution.messageId);
  const sourceChannelId = runtimeExecutionSourceChannelId(store, execution);
  if (!sourceMessage || !sourceChannelId) return null;

  const sourceChannelType = sourceMessage.channelType;
  if (!isChannelType(sourceChannelType)) return null;

  const sourceExecution = execution.sourceExecutionId ? store.getRuntimeExecution(execution.sourceExecutionId) : null;
  const sourceAgent = sourceExecution ? store.getAgent(sourceExecution.agentId) : null;
  const title = topologyExecutionTitle(sourceMessage.content);

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
    sourceChannelId,
    sourceChannelType,
    sourceConversationId: sourceMessage.conversationId,
    sourceMessageId: sourceMessage.id,
    title,
    sourceContent: sanitizeHumanVisibleText(sourceMessage.content),
    latestDetail: topologyExecutionLatestDetail(latestEvent),
    workspaceId,
    bridgePath,
    sourceLabel: sourceAgent ? `Delegated by ${sourceAgent.displayName}` : "Conversation request",
    pendingApprovalId,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt
  };
}

function topologyExecutionLatestDetail(event: ReturnType<ServerRouteContext["store"]["listRuntimeExecutionEvents"]>[number] | undefined): string | undefined {
  if (!event) return undefined;
  const detail = event.detail?.trim() || event.title?.trim();
  if (detail) return sanitizeHumanVisibleText(detail);
  if (event.payload === undefined || event.payload === null) return undefined;
  try {
    return JSON.stringify(sanitizeHumanVisibleValue(event.payload), null, 2);
  } catch {
    return "Execution state updated";
  }
}

function topologyExecutionTitle(content: string): string {
  const collapsed = sanitizeHumanVisibleText(content).replace(/\s+/g, " ").trim();
  if (!collapsed) return "Conversation request";
  return collapsed.length > 96 ? `${collapsed.slice(0, 93)}…` : collapsed;
}

function isChannelType(value: unknown): value is ChannelType {
  // 普通群聊已退出产品；即使历史记录仍在数据库，也不能通过 Topology 重新暴露其执行来源。
  return value === "dm" || value === "thread";
}

const NAVIGATION_SECTIONS = new Set<WorkspaceNavigationSection>(["dms", "agents", "machines", "humans", "resource-grants"]);

function navigationSection(value: unknown): WorkspaceNavigationSection | null {
  return typeof value === "string" && NAVIGATION_SECTIONS.has(value as WorkspaceNavigationSection)
    ? value as WorkspaceNavigationSection
    : null;
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
