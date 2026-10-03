const FIXTURE_AT = "2026-09-01T08:00:00.000Z";

const DEFAULT_OPTIONS = Object.freeze({
  mode: "mixed",
  currentDeviceCount: 16,
  currentAgentsPerDevice: 2,
  clusterAgentCount: 20,
  peerDeviceCount: 4,
  peerAgentsPerDevice: 2,
  activeChainCount: 6
});

function padded(value) {
  return String(value).padStart(2, "0");
}

function at(offsetSeconds) {
  return new Date(Date.parse(FIXTURE_AT) + offsetSeconds * 1000).toISOString();
}

function makeAgent({ id, workspaceId, ownerUserId, machineId, name, displayName, kind = "standard", status = "online" }) {
  return {
    id,
    serverId: workspaceId,
    kind,
    ownerUserId,
    machineId,
    name,
    displayName,
    runtime: "codex",
    status,
    authToken: `${id}-fixture-token`,
    createdAt: FIXTURE_AT,
    updatedAt: FIXTURE_AT,
    access: "owner"
  };
}

function makeMachine({ id, workspaceId, ownerUserId, index, status, agents }) {
  return {
    id,
    serverId: workspaceId,
    ownerUserId,
    name: index === 0 ? "Primary Compute Hall" : `Compute Node ${padded(index + 1)}`,
    hostname: `${id}.local`,
    os: index % 2 === 0 ? "macOS" : "Linux",
    daemonVersion: "m9-fixture",
    latestDaemonVersion: "m9-fixture",
    status,
    apiKey: `${id}-fixture-key`,
    createdAt: FIXTURE_AT,
    lastSeenAt: FIXTURE_AT,
    agentCount: agents.length,
    availableRuntimes: ["codex"],
    runtimeReports: [],
    runtimes: [],
    agents,
    access: "owner"
  };
}

function buildWorkspaceResources({ prefix, workspaceId, ownerUserId, deviceCount, agentsPerDevice, clusterAgentCount = 0, offlineLastDevice = false }) {
  const machines = [];
  const agents = [];
  const agentsByMachineId = new Map();
  for (let deviceIndex = 0; deviceIndex < deviceCount; deviceIndex += 1) {
    const machineId = `${prefix}-device-${padded(deviceIndex + 1)}`;
    const agentCount = deviceIndex === 0 && clusterAgentCount > 0 ? clusterAgentCount : agentsPerDevice;
    const machineAgents = Array.from({ length: agentCount }, (_, agentIndex) => makeAgent({
      id: `${machineId}-agent-${padded(agentIndex + 1)}`,
      workspaceId,
      ownerUserId,
      machineId,
      name: `${prefix}-agent-${padded(deviceIndex + 1)}-${padded(agentIndex + 1)}`,
      displayName: `${prefix === "stress" ? "Runtime" : "Peer"} ${padded(deviceIndex + 1)}.${padded(agentIndex + 1)}`
    }));
    const status = offlineLastDevice && deviceIndex === deviceCount - 1 ? "offline" : "online";
    agents.push(...machineAgents);
    agentsByMachineId.set(machineId, machineAgents);
    machines.push(makeMachine({ id: machineId, workspaceId, ownerUserId, index: deviceIndex, status, agents: machineAgents }));
  }
  return { machines, agents, agentsByMachineId };
}

function activity({ id, executionId, workspaceId, agent, kind, status = "running", continuous = true, offsetSeconds }) {
  return {
    id,
    executionId,
    workspaceId,
    agentId: agent.id,
    machineId: agent.machineId,
    kind,
    status,
    continuous,
    createdAt: at(offsetSeconds),
    updatedAt: at(offsetSeconds)
  };
}

function mixedLiveWork({ workspaceId, tyrId, runtimeAgents, clusterAgents, offlineAgents, activeChainCount }) {
  const flows = [];
  for (let chainIndex = 0; chainIndex < activeChainCount; chainIndex += 1) {
    const chainNumber = chainIndex + 1;
    const chainId = `stress-chain-${padded(chainNumber)}`;
    const rootExecutionId = `${chainId}-root`;
    const handoffExecutionId = `${chainId}-handoff`;
    const returnExecutionId = `${chainId}-return`;
    const source = runtimeAgents[(chainIndex * 5) % runtimeAgents.length];
    // 第一条链路故意命中聚合 Agent，验证隐藏人物仍只把链路落到所属 Device Room。
    const target = chainIndex === 0
      ? clusterAgents[clusterAgents.length - 1]
      : runtimeAgents[(chainIndex * 5 + 11) % runtimeAgents.length];
    const baseOffset = chainIndex * 6;
    flows.push(
      {
        id: `${chainId}-flow-root`,
        executionId: rootExecutionId,
        chainId,
        hopCount: 0,
        workspaceId,
        bridgePath: [],
        sourceAgentId: tyrId,
        targetAgentId: source.id,
        machineId: source.machineId,
        tone: "request",
        continuous: true,
        status: "running",
        createdAt: at(baseOffset),
        updatedAt: at(baseOffset + 1)
      },
      {
        id: `${chainId}-flow-handoff`,
        executionId: handoffExecutionId,
        chainId,
        sourceExecutionId: rootExecutionId,
        hopCount: 1,
        workspaceId,
        bridgePath: [],
        sourceAgentId: source.id,
        targetAgentId: target.id,
        machineId: target.machineId,
        tone: "request",
        continuous: true,
        status: "running",
        createdAt: at(baseOffset + 2),
        updatedAt: at(baseOffset + 3)
      },
      {
        id: `${chainId}-flow-return`,
        executionId: returnExecutionId,
        chainId,
        sourceExecutionId: handoffExecutionId,
        hopCount: 1,
        workspaceId,
        bridgePath: [],
        sourceAgentId: target.id,
        targetAgentId: source.id,
        machineId: source.machineId,
        tone: chainIndex === activeChainCount - 1 ? "error" : "response",
        continuous: chainIndex !== activeChainCount - 1,
        status: chainIndex === activeChainCount - 1 ? "failed" : "delivered",
        createdAt: at(baseOffset + 4),
        updatedAt: at(baseOffset + 5)
      }
    );
  }

  const activityAgents = [runtimeAgents[2], runtimeAgents[13], runtimeAgents[24]];
  const failedAgent = runtimeAgents[(activeChainCount * 5 + 11) % runtimeAgents.length];
  return {
    executions: [],
    flows,
    activities: [
      activity({ id: "stress-activity-thinking", executionId: "stress-exec-thinking", workspaceId, agent: activityAgents[0], kind: "thinking", offsetSeconds: 40 }),
      activity({ id: "stress-activity-tool", executionId: "stress-exec-tool", workspaceId, agent: activityAgents[1], kind: "tool_running", offsetSeconds: 41 }),
      activity({ id: "stress-activity-approval", executionId: "stress-exec-approval", workspaceId, agent: activityAgents[2], kind: "waiting_approval", status: "waiting_approval", offsetSeconds: 42 }),
      activity({ id: "stress-activity-hidden", executionId: "stress-exec-hidden", workspaceId, agent: clusterAgents[clusterAgents.length - 1], kind: "thinking", offsetSeconds: 43 }),
      activity({ id: "stress-activity-failed", executionId: "stress-exec-failed", workspaceId, agent: failedAgent, kind: "failed", status: "failed", continuous: false, offsetSeconds: 44 }),
      // Device offline 是硬边界；这条迟到 activity 必须保留审计事实但不能重新驱动画面。
      activity({ id: "stress-activity-offline-late", executionId: "stress-exec-offline-late", workspaceId, agent: offlineAgents[0], kind: "thinking", offsetSeconds: 45 })
    ],
    truncated: false
  };
}

export function workspaceSpatialStressFixture(input = {}) {
  // 规模是 M9 回归合同，不开放为调用方可调参数；只允许切换状态模式与复用当前登录身份。
  const options = {
    ...DEFAULT_OPTIONS,
    mode: input.mode ?? DEFAULT_OPTIONS.mode,
    currentWorkspaceId: input.currentWorkspaceId,
    ownerUserId: input.ownerUserId
  };
  // 浏览器 route fixture 复用当前登录身份，避免应用把测试 Workspace 判定为无权访问并反复重载。
  const workspaceId = options.currentWorkspaceId ?? "workspace-stress-current";
  const ownerUserId = options.ownerUserId ?? "user-stress-current";
  const peerWorkspaceId = "workspace-stress-peer";
  const peerOwnerUserId = "user-stress-peer";
  const currentResources = buildWorkspaceResources({
    prefix: "stress",
    workspaceId,
    ownerUserId,
    deviceCount: options.currentDeviceCount,
    agentsPerDevice: options.currentAgentsPerDevice,
    clusterAgentCount: options.clusterAgentCount,
    offlineLastDevice: true
  });
  const peerResources = buildWorkspaceResources({
    prefix: "peer",
    workspaceId: peerWorkspaceId,
    ownerUserId: peerOwnerUserId,
    deviceCount: options.peerDeviceCount,
    agentsPerDevice: options.peerAgentsPerDevice
  });
  const currentTyr = makeAgent({
    id: "stress-current-tyr",
    workspaceId,
    ownerUserId,
    machineId: null,
    name: "tyr",
    displayName: "TYR",
    kind: "communication",
    status: options.mode === "mixed" ? "working" : "online"
  });
  const peerTyr = makeAgent({
    id: "stress-peer-tyr",
    workspaceId: peerWorkspaceId,
    ownerUserId: peerOwnerUserId,
    machineId: null,
    name: "tyr",
    displayName: "Peer TYR",
    kind: "communication"
  });
  const activeBridge = {
    id: "stress-bridge-active",
    workspaceAId: workspaceId,
    workspaceBId: peerWorkspaceId,
    status: "active",
    direction: "bidirectional",
    scope: "workspace_topology",
    permissions: ["chat"],
    invitedByUserId: ownerUserId,
    invitedByDisplayName: "Stress Owner",
    approvedByAUserId: ownerUserId,
    approvedByBUserId: peerOwnerUserId,
    createdAt: FIXTURE_AT,
    acceptedAt: FIXTURE_AT,
    revokedAt: null,
    lastActivityAt: options.mode === "mixed" ? at(46) : null
  };
  const revokedBridge = {
    ...activeBridge,
    id: "stress-bridge-revoked",
    workspaceBId: "workspace-stress-revoked",
    status: "revoked",
    acceptedAt: at(-60),
    revokedAt: at(-30),
    lastActivityAt: null
  };
  const transitiveBridge = {
    ...activeBridge,
    id: "stress-bridge-transitive",
    workspaceAId: peerWorkspaceId,
    workspaceBId: "workspace-stress-transitive",
    lastActivityAt: null
  };
  const currentAgents = [currentTyr, ...currentResources.agents];
  const peerAgents = [peerTyr, ...peerResources.agents];
  const offlineDeviceId = currentResources.machines[currentResources.machines.length - 1].id;
  const offlineAgents = currentResources.agentsByMachineId.get(offlineDeviceId);
  const clusterDeviceId = currentResources.machines[0].id;
  const clusterAgents = currentResources.agentsByMachineId.get(clusterDeviceId);
  const liveWork = options.mode === "mixed"
    ? mixedLiveWork({
        workspaceId,
        tyrId: currentTyr.id,
        runtimeAgents: currentResources.agents,
        clusterAgents,
        offlineAgents,
        activeChainCount: options.activeChainCount
      })
    : options.mode === "offline-late"
      ? {
          executions: [],
          flows: [],
          activities: [activity({
            id: "stress-activity-offline-late",
            executionId: "stress-exec-offline-late",
            workspaceId,
            agent: offlineAgents[0],
            kind: "thinking",
            offsetSeconds: 45
          })],
          truncated: false
        }
      : { executions: [], flows: [], activities: [], truncated: false };
  const crossWorkspaceMessages = options.mode === "mixed" ? [{
    id: "stress-bridge-message",
    bridgeId: activeBridge.id,
    conversationId: "stress-bridge-conversation",
    clientRequestId: "stress-client-request",
    retryOfMessageId: null,
    responseKind: null,
    terminalRequestId: null,
    originConversationKey: null,
    originChannelId: null,
    originConversationId: null,
    originMessageId: null,
    sourceWorkspaceId: workspaceId,
    targetWorkspaceId: peerWorkspaceId,
    senderUserId: ownerUserId,
    senderUserName: "stress-owner",
    senderUserDisplayName: "Stress Owner",
    sourceCapabilityUserId: ownerUserId,
    targetCapabilityUserId: peerOwnerUserId,
    originalSenderUserId: ownerUserId,
    traceId: "stress-trace",
    parentBridgeRequestId: null,
    hopCount: 0,
    senderCommsAgentId: currentTyr.id,
    receiverCommsAgentId: peerTyr.id,
    initiatedBy: "human",
    content: "Sanitized stress fixture request",
    outcome: "pending",
    localMessageId: null,
    peerMessageId: null,
    replyToMessageId: null,
    createdAt: at(46)
  }] : [];

  return {
    snapshot: {
      currentUser: {
        id: ownerUserId,
        name: "stress-owner",
        displayName: "Stress Owner",
        createdAt: FIXTURE_AT
      },
      currentServer: {
        id: workspaceId,
        name: "M9 Operations Campus",
        slug: "m9-operations-campus",
        ownerId: ownerUserId,
        onboardingAgentId: currentTyr.id,
        plan: "pro",
        planDowngradedAt: null,
        role: "owner",
        createdAt: FIXTURE_AT
      },
      machines: currentResources.machines,
      agents: currentAgents,
      humans: [],
      channels: [],
      conversations: [],
      messages: [],
      devices: [],
      deviceGrants: [],
      deviceAccessRules: [],
      deviceCommands: [],
      tasks: [],
      savedMessageIds: [],
      unreadCounts: {},
      reminders: [],
      runtimeApprovals: [],
      runtimeExecutions: [],
      runtimeExecutionEvents: [],
      executionGroups: [],
      agentRuns: [],
      executionBlocks: [],
      executionArtifacts: [],
      safetyAssessments: [],
      governanceDecisions: [],
      resourceGrantSummaries: [],
      incomingServerInvites: [],
      workspaceBridges: [activeBridge, revokedBridge],
      incomingWorkspaceBridges: [],
      crossWorkspaceMessages,
      peerWorkspaceTopologies: [
        {
          bridgeId: activeBridge.id,
          bridge: activeBridge,
          distance: 1,
          bridgePath: [activeBridge.id],
          workspace: {
            id: peerWorkspaceId,
            name: "Direct Review Workspace",
            ownerUserId: peerOwnerUserId,
            ownerDisplayName: "Peer Owner",
            onboardingAgentId: peerTyr.id
          },
          assistant: peerTyr,
          machines: peerResources.machines,
          agents: peerAgents,
          devices: []
        },
        {
          bridgeId: transitiveBridge.id,
          bridge: transitiveBridge,
          distance: 2,
          bridgePath: [activeBridge.id, transitiveBridge.id],
          workspace: {
            id: "workspace-stress-transitive",
            name: "Hidden Transitive Workspace",
            ownerUserId: "user-stress-transitive",
            ownerDisplayName: "Hidden Owner",
            onboardingAgentId: null
          },
          assistant: null,
          machines: [],
          agents: [],
          devices: []
        },
        {
          bridgeId: revokedBridge.id,
          bridge: revokedBridge,
          distance: 1,
          bridgePath: [revokedBridge.id],
          workspace: {
            id: "workspace-stress-revoked",
            name: "Revoked Workspace",
            ownerUserId: "user-stress-revoked",
            ownerDisplayName: "Revoked Owner",
            onboardingAgentId: null
          },
          assistant: null,
          machines: [],
          agents: [],
          devices: []
        }
      ],
      workspaceBridgeTopologyEdges: []
    },
    liveWork,
    meta: {
      currentWorkspaceId: workspaceId,
      directPeerWorkspaceId: peerWorkspaceId,
      transitiveWorkspaceId: "workspace-stress-transitive",
      revokedWorkspaceId: "workspace-stress-revoked",
      activeBridgeId: activeBridge.id,
      offlineDeviceId,
      hiddenActiveAgentId: clusterAgents[clusterAgents.length - 1].id,
      expectedWorkspaceCount: 2,
      expectedDeviceCount: currentResources.machines.length + peerResources.machines.length,
      expectedAgentCount: currentAgents.length + peerAgents.length,
      expectedHiddenAgentCount: Math.max(0, clusterAgents.length - 8),
      expectedChainCount: options.mode === "mixed" ? options.activeChainCount : 0,
      latestChainId: options.mode === "mixed" ? `stress-chain-${padded(options.activeChainCount)}` : null
    }
  };
}
