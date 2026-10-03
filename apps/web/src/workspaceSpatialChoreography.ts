import type {
  WorkspaceSpatialFlowChain,
  WorkspaceSpatialFlowSignal,
  WorkspaceSpatialScene,
  WorkspaceSpatialWorkspace
} from "./workspaceSpatial";

// 最长的跨 Device hop 会经过四段物理 route；下一 hop 只在前一接力基本到站后开始。
export const WORKSPACE_SPATIAL_CHAIN_STEP_DELAY_SECONDS = 1.72;
export const WORKSPACE_SPATIAL_ROUTE_STAGE_DELAY_SECONDS = 0.42;
export const WORKSPACE_SPATIAL_CHAIN_PACKET_DURATION_SECONDS = 0.56;
export const WORKSPACE_SPATIAL_CHAIN_COMPACT_PACKET_DURATION_SECONDS = 0.46;
export const WORKSPACE_SPATIAL_MESSAGE_JOURNEY_MIN_DURATION_SECONDS = 2.1;

export type WorkspaceSpatialFlowCue = {
  flowId: string;
  chainId: string;
  segmentId: string;
  chainRank: number;
  stepIndex: number;
  stepCount: number;
  delaySeconds: number;
  emphasized: boolean;
  gapBefore: boolean;
};

export type WorkspaceSpatialRouteSignal = {
  id: string;
  flowId: string;
  executionId: string;
  chainId: string;
  tone: WorkspaceSpatialFlowSignal["tone"];
  reverse: boolean;
  continuous: boolean;
  routeKind: "dispatch" | "agent";
  routeId: string;
  delaySeconds: number;
  emphasized: boolean;
  chainStepIndex: number;
  chainStepCount: number;
  gapBefore: boolean;
};

export type WorkspaceSpatialMessageJourneySignal = {
  id: string;
  flowId: string;
  executionId: string;
  chainId: string;
  tone: WorkspaceSpatialFlowSignal["tone"];
  sourceAgentId?: string;
  targetAgentId: string;
  /** 路径始终按稳定端点顺序生成；真实方向只由 reverse 控制。 */
  pathSourceAgentId?: string;
  pathTargetAgentId: string;
  reverse: boolean;
  continuous: boolean;
  status?: WorkspaceSpatialFlowSignal["status"];
  bridgeRequestMessageId?: string;
  createdAt: string;
  updatedAt: string;
  delaySeconds: number;
  durationSeconds: number;
  emphasized: boolean;
  chainStepIndex: number;
  chainStepCount: number;
  gapBefore: boolean;
};

type FlowSegmentPosition = {
  segmentId: string;
  stepIndex: number;
  gapBefore: boolean;
};

export type WorkspaceSpatialFeaturedChain = {
  chainId: string;
  workspaceId: string;
  updatedAt: string;
};

export function workspaceSpatialFeaturedChain(scene: WorkspaceSpatialScene): WorkspaceSpatialFeaturedChain | null {
  const candidates = [scene.current, ...scene.peers].flatMap((workspace) => (
    workspace.flowChains.flatMap((chain): WorkspaceSpatialFeaturedChain[] => {
      if (chain.flows.length === 0) return [];
      return [{
        chainId: chain.id,
        workspaceId: workspace.id,
        updatedAt: chain.flows.reduce(
          (latest, flow) => latest > flow.updatedAt ? latest : flow.updatedAt,
          ""
        )
      }];
    })
  ));
  return candidates.sort((left, right) => (
    right.updatedAt.localeCompare(left.updatedAt)
    // 同一时刻优先当前 Workspace，最后用稳定 id 消除渲染抖动。
    || Number(left.workspaceId !== scene.current.id) - Number(right.workspaceId !== scene.current.id)
    || left.chainId.localeCompare(right.chainId)
  ))[0] ?? null;
}

export function workspaceSpatialFlowCues(chains: WorkspaceSpatialFlowChain[]): WorkspaceSpatialFlowCue[] {
  return chains.flatMap((chain, chainRank) => {
    const flowByExecutionId = new Map(chain.flows.map((flow) => [flow.executionId, flow]));
    const positionByFlowId = new Map<string, FlowSegmentPosition>();
    const visiting = new Set<string>();
    let cycleDetected = false;

    const resolvePosition = (flow: WorkspaceSpatialFlowSignal): FlowSegmentPosition => {
      const cached = positionByFlowId.get(flow.id);
      if (cached) return cached;
      if (visiting.has(flow.id)) {
        cycleDetected = true;
        return { segmentId: flow.executionId, stepIndex: 0, gapBefore: true };
      }
      visiting.add(flow.id);
      const source = flow.sourceExecutionId ? flowByExecutionId.get(flow.sourceExecutionId) : undefined;
      let position: FlowSegmentPosition;
      if (source) {
        const sourcePosition = resolvePosition(source);
        position = {
          segmentId: sourcePosition.segmentId,
          stepIndex: sourcePosition.stepIndex + 1,
          gapBefore: false
        };
      } else {
        // Human 根 execution 可以没有 Flow；缺失的非根 execution 必须开启独立可见分段。
        const gapBefore = Boolean(flow.sourceExecutionId && flow.sourceExecutionId !== chain.id);
        position = { segmentId: flow.executionId, stepIndex: 0, gapBefore };
      }
      visiting.delete(flow.id);
      positionByFlowId.set(flow.id, position);
      return position;
    };

    chain.flows.forEach(resolvePosition);
    if (cycleDetected) {
      // 异常环没有可信先后关系；全部作为独立段同时呈现，绝不构造循环动画。
      chain.flows.forEach((flow) => positionByFlowId.set(flow.id, {
        segmentId: flow.executionId,
        stepIndex: 0,
        gapBefore: true
      }));
    }

    const stepCountBySegmentId = new Map<string, number>();
    for (const position of positionByFlowId.values()) {
      stepCountBySegmentId.set(
        position.segmentId,
        Math.max(stepCountBySegmentId.get(position.segmentId) ?? 1, position.stepIndex + 1)
      );
    }

    return chain.flows.map((flow) => {
      const position = positionByFlowId.get(flow.id) ?? {
        segmentId: flow.executionId,
        stepIndex: 0,
        gapBefore: true
      };
      return {
        flowId: flow.id,
        chainId: chain.id,
        segmentId: position.segmentId,
        chainRank,
        stepIndex: position.stepIndex,
        stepCount: stepCountBySegmentId.get(position.segmentId) ?? 1,
        delaySeconds: position.stepIndex * WORKSPACE_SPATIAL_CHAIN_STEP_DELAY_SECONDS,
        emphasized: chainRank === 0,
        gapBefore: position.gapBefore
      };
    });
  });
}

export function workspaceSpatialRouteSignals(workspace: WorkspaceSpatialWorkspace): WorkspaceSpatialRouteSignal[] {
  const cueByFlowId = new Map(workspaceSpatialFlowCues(workspace.flowChains).map((cue) => [cue.flowId, cue]));
  const controllerIds = new Set(workspace.controllers.map((agent) => agent.id));
  const roomIdByAgentId = new Map(workspace.rooms.flatMap((room) => (
    room.agents.map((agent) => [agent.id, room.id] as const)
  )));
  const signals: WorkspaceSpatialRouteSignal[] = [];

  const append = (
    flow: WorkspaceSpatialFlowSignal,
    cue: WorkspaceSpatialFlowCue,
    routeKind: WorkspaceSpatialRouteSignal["routeKind"],
    routeId: string,
    reverse: boolean,
    stageIndex: number
  ) => {
    signals.push({
      id: `${flow.id}:${routeKind}:${routeId}:${reverse ? "out" : "in"}`,
      flowId: flow.id,
      executionId: flow.executionId,
      chainId: flow.chainId,
      tone: flow.tone,
      reverse,
      continuous: flow.continuous,
      routeKind,
      routeId,
      delaySeconds: cue.delaySeconds + stageIndex * WORKSPACE_SPATIAL_ROUTE_STAGE_DELAY_SECONDS,
      emphasized: cue.emphasized,
      chainStepIndex: cue.stepIndex,
      chainStepCount: cue.stepCount,
      gapBefore: cue.gapBefore
    });
  };

  for (const flow of workspace.flows) {
    const cue = cueByFlowId.get(flow.id);
    if (!cue) continue;
    const sourceRoomId = flow.sourceAgentId ? roomIdByAgentId.get(flow.sourceAgentId) : undefined;
    const targetRoomId = roomIdByAgentId.get(flow.targetAgentId);
    const sourceIsController = Boolean(flow.sourceAgentId && controllerIds.has(flow.sourceAgentId));
    const targetIsController = controllerIds.has(flow.targetAgentId);
    let stageIndex = 0;

    if (sourceRoomId && flow.sourceAgentId) {
      append(flow, cue, "agent", flow.sourceAgentId, true, stageIndex);
      stageIndex += 1;
    }

    if (sourceIsController && targetRoomId) {
      append(flow, cue, "dispatch", targetRoomId, false, stageIndex);
      stageIndex += 1;
    } else if (sourceRoomId && targetIsController) {
      append(flow, cue, "dispatch", sourceRoomId, true, stageIndex);
      stageIndex += 1;
    } else if (sourceRoomId && targetRoomId && sourceRoomId !== targetRoomId) {
      // 跨 Device delegation 使用现有 workspace relay；同房间协作只经过共享 gateway，不绕行 TYR。
      append(flow, cue, "dispatch", sourceRoomId, true, stageIndex);
      stageIndex += 1;
      append(flow, cue, "dispatch", targetRoomId, false, stageIndex);
      stageIndex += 1;
    }

    if (targetRoomId) {
      append(flow, cue, "agent", flow.targetAgentId, false, stageIndex);
    }
  }

  return signals;
}

export function workspaceSpatialMessageJourneySignals(
  workspace: WorkspaceSpatialWorkspace
): WorkspaceSpatialMessageJourneySignal[] {
  const routeSignals = workspaceSpatialRouteSignals(workspace);
  const controllerIds = new Set(workspace.controllers.map((agent) => agent.id));
  const cueByFlowId = new Map(workspaceSpatialFlowCues(workspace.flowChains).map((cue) => [cue.flowId, cue]));
  const routeSignalsByFlowId = new Map<string, WorkspaceSpatialRouteSignal[]>();
  for (const routeSignal of routeSignals) {
    const current = routeSignalsByFlowId.get(routeSignal.flowId) ?? [];
    current.push(routeSignal);
    routeSignalsByFlowId.set(routeSignal.flowId, current);
  }

  const visibleFlowByLane = new Map<string, WorkspaceSpatialFlowSignal>();
  const tonePriority: Record<WorkspaceSpatialFlowSignal["tone"], number> = { error: 0, response: 1, request: 2 };
  for (const flow of workspace.flows) {
    const laneEndpoints = flow.sourceAgentId
      ? [flow.sourceAgentId, flow.targetAgentId].sort().join(":")
      : `source-less:${flow.executionId}:${flow.targetAgentId}`;
    const laneKey = `${flow.chainId}:${laneEndpoints}`;
    const current = visibleFlowByLane.get(laneKey);
    if (
      !current
      || flow.updatedAt > current.updatedAt
      || (flow.updatedAt === current.updatedAt && tonePriority[flow.tone] < tonePriority[current.tone])
      || (flow.updatedAt === current.updatedAt && flow.tone === current.tone && flow.id > current.id)
    ) {
      visibleFlowByLane.set(laneKey, flow);
    }
  }

  // 服务端可为审计保留 terminal Flow；同一 chain 的同一对端在视觉上只能由最新阶段占用一条 lane。
  return [...visibleFlowByLane.values()].flatMap((flow): WorkspaceSpatialMessageJourneySignal[] => {
    const cue = cueByFlowId.get(flow.id);
    if (!cue) return [];
    const flowRouteSignals = routeSignalsByFlowId.get(flow.id) ?? [];
    const firstStageDelay = flowRouteSignals.reduce(
      (earliest, signal) => Math.min(earliest, signal.delaySeconds),
      cue.delaySeconds
    );
    const lastStageDelay = flowRouteSignals.reduce(
      (latest, signal) => Math.max(latest, signal.delaySeconds),
      cue.delaySeconds
    );
    let pathSourceAgentId = flow.sourceAgentId;
    let pathTargetAgentId = flow.targetAgentId;
    let reverse = false;
    if (pathSourceAgentId) {
      const sourceIsController = controllerIds.has(pathSourceAgentId);
      const targetIsController = controllerIds.has(pathTargetAgentId);
      // TYR 与房间之间固定以 TYR 为物理通道起点；其余端点按稳定 id 排序。
      // 这样 response 只反转能量方向，不会重新选择另一侧直角拐点。
      const canonicalOrderIsReversed = sourceIsController !== targetIsController
        ? targetIsController
        : pathSourceAgentId.localeCompare(pathTargetAgentId) > 0;
      if (canonicalOrderIsReversed) {
        [pathSourceAgentId, pathTargetAgentId] = [pathTargetAgentId, pathSourceAgentId];
        reverse = true;
      }
    }
    return [{
      // queued/delivered/running 是同一出站阶段；稳定身份避免每次状态更新都把信息点重置到起点。
      // 请求、执行和响应属于同一条物理消息旅程；tone 变化只改变方向/结果色，不重挂载整条线路。
      id: `message-journey:${flow.executionId}`,
      flowId: flow.id,
      executionId: flow.executionId,
      chainId: flow.chainId,
      tone: flow.tone,
      sourceAgentId: flow.sourceAgentId,
      targetAgentId: flow.targetAgentId,
      pathSourceAgentId,
      pathTargetAgentId,
      reverse,
      continuous: flow.continuous,
      status: flow.status,
      ...(flow.bridgeRequestMessageId ? { bridgeRequestMessageId: flow.bridgeRequestMessageId } : {}),
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
      delaySeconds: firstStageDelay,
      // 原来每段各播一个 packet；现在保留同样的总时间窗，但由一个实体连续跑完整条物理路径。
      durationSeconds: Math.max(
        WORKSPACE_SPATIAL_MESSAGE_JOURNEY_MIN_DURATION_SECONDS,
        lastStageDelay - firstStageDelay + WORKSPACE_SPATIAL_CHAIN_PACKET_DURATION_SECONDS
      ),
      emphasized: cue.emphasized,
      chainStepIndex: cue.stepIndex,
      chainStepCount: cue.stepCount,
      gapBefore: cue.gapBefore
    }];
  });
}
