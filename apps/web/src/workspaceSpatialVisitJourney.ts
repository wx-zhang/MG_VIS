import type { TopologyBridgeJourneyPhase } from "@tyr-ai/contracts";
import type { WorkspaceSpatialWorkspace } from "./workspaceSpatial";

export type WorkspaceSpatialVisitStage = "outbound" | "handoff" | "waiting" | "awaiting_handoff" | "receiving" | "returning" | "arrived" | "complete";
export type WorkspaceSpatialVisitOutcome = "completed" | "failed" | "cancelled";
export type WorkspaceSpatialVisitBubbleMode = "primary" | "secondary" | "hidden";
export type WorkspaceSpatialVisitFact = {
  id: string;
  phase: TopologyBridgeJourneyPhase;
  createdAt: string;
  updatedAt: string;
};
export type WorkspaceSpatialVisitState = {
  progress: number;
  stage: WorkspaceSpatialVisitStage;
  stageAt: number;
  outcome?: WorkspaceSpatialVisitOutcome;
  factUpdatedAt: string;
  stageElapsedMs?: number;
  requestExchanged?: boolean;
  visualStarted?: boolean;
  dependentVisitIds?: string[];
};

export type WorkspaceSpatialAgentVisit = WorkspaceSpatialVisitFact & {
  executionId: string;
  workspaceId: string;
  sourceAgentId: string;
  targetAgentId: string;
  actorMode: "direct" | "clone";
  bridgeRequestMessageId?: string;
};

/** 每座 Server Bridge 只保留一个来源 Workspace 的外派角色；角色是否为分身由服务端 Journey 事实决定。 */
export function workspaceSpatialSelectBridgeCloneCandidates<T extends { placedBridge: { bridge: { id: string } } }>(
  candidates: readonly T[],
  limit = 4
): T[] {
  const bridgeIds = new Set<string>();
  return candidates.filter(({ placedBridge }) => {
    if (bridgeIds.has(placedBridge.bridge.id)) return false;
    bridgeIds.add(placedBridge.bridge.id);
    return true;
  }).slice(0, Math.max(0, limit));
}

/** 只消费服务端已验证的 TYR 调度关系；每个 execution 独立，不能按角色或 chain 合并并行请求。 */
export function workspaceSpatialAgentVisits(workspace: WorkspaceSpatialWorkspace): WorkspaceSpatialAgentVisit[] {
  const controllers = new Set(workspace.controllers.map((agent) => agent.id));
  const workers = new Set(workspace.rooms.flatMap((room) => room.visibleAgents.map((agent) => agent.id)));
  return (workspace.visitFlows ?? workspace.flows).flatMap((flow): WorkspaceSpatialAgentVisit[] => {
    const source = flow.sourceAgentId;
    const target = flow.targetAgentId;
    const controller = source && controllers.has(source) ? source : controllers.has(target) ? target : undefined;
    const worker = controller === source ? target : source;
    if (!controller || !worker || !workers.has(worker) || !flow.status) return [];
    // return execution 是另一轮运行，不能被误画成 TYR 再次拜访 worker。
    if (flow.requestSourceExecutionId) return [];
    const phase: TopologyBridgeJourneyPhase = flow.status === "completed"
      ? flow.resultReceivedAt ? "completed" : "returning"
      : flow.status === "failed" || flow.status === "stalled" ? "failed"
        : flow.status === "cancelled" ? "cancelled"
          : flow.status === "waiting_approval" ? "waiting_approval"
            : flow.status === "running" ? "running" : "received";
    return [{ id: `agent-visit:${flow.executionId}`, executionId: flow.executionId, workspaceId: workspace.id,
      sourceAgentId: controller, targetAgentId: worker, bridgeRequestMessageId: flow.bridgeRequestMessageId,
      // 旧服务端没有 actorMode 时按单路原身处理，不能把普通本地派单误画成分身。
      actorMode: flow.actorMode ?? "direct",
      phase, createdAt: flow.createdAt, updatedAt: flow.resultReceivedAt ?? flow.updatedAt }];
  });
}

/** 已收到终态的请求保留到归位；窗口外的未知请求不伪装成仍在执行，也不补造结果。 */
export function reconcileWorkspaceSpatialVisits<T extends WorkspaceSpatialVisitFact>(
  facts: readonly T[], retained: Map<string, T>, states: Map<string, WorkspaceSpatialVisitState>, nowMs: number, observedSinceMs = nowMs
): T[] {
  for (const fact of facts) {
    const previous = retained.get(fact.id);
    if (!previous || fact.updatedAt >= previous.updatedAt) retained.set(fact.id, fact);
    if (!states.has(fact.id)) states.set(fact.id, workspaceSpatialVisitInitialState(fact, nowMs, Date.parse(fact.createdAt) < observedSinceMs));
    const state = states.get(fact.id)!;
    if (!state.visualStarted && state.stage === "outbound" && workspaceSpatialVisitOutcome(fact.phase)) {
      states.set(fact.id, workspaceSpatialVisitInitialState(fact, nowMs));
    }
  }
  const visibleIds = new Set(facts.map((fact) => fact.id));
  for (const [id, fact] of retained) {
    if (states.get(id)?.stage === "complete" || !visibleIds.has(id) && !workspaceSpatialVisitOutcome(fact.phase)) retained.delete(id);
  }
  return [...retained.values()];
}

export const WORKSPACE_SPATIAL_VISIT_HANDOFF_MS = 800;
export const WORKSPACE_SPATIAL_LOCAL_VISIT_HANDOFF_MS = 600;
const ARRIVAL_RESULT_MS = 1_250;

export function workspaceSpatialVisitOutcome(phase: TopologyBridgeJourneyPhase): WorkspaceSpatialVisitOutcome | undefined {
  return phase === "completed" || phase === "failed" || phase === "cancelled" ? phase : undefined;
}

export function workspaceSpatialVisitInitialState(fact: WorkspaceSpatialVisitFact, nowMs: number, restoring = false): WorkspaceSpatialVisitState {
  const terminal = workspaceSpatialVisitOutcome(fact.phase);
  // 首次快照恢复在交流点；后续新请求即使投递较慢，也必须实际走过去。
  return {
    progress: terminal ? 0 : restoring ? 1 : 0,
    stage: terminal ? "complete" : restoring ? "waiting" : "outbound",
    stageAt: nowMs, stageElapsedMs: 0, requestExchanged: restoring,
    ...(terminal ? { outcome: terminal } : {}), factUpdatedAt: fact.updatedAt
  };
}

/** 依赖只属于同一 Bridge request；其他 Workspace 的并行工作不会阻塞本次交接。 */
export function workspaceSpatialVisitCanReceive(state: WorkspaceSpatialVisitState, states: ReadonlyMap<string, WorkspaceSpatialVisitState>): boolean {
  return (state.dependentVisitIds ?? []).every((id) => {
    const child = states.get(id);
    return !child || !child.visualStarted || child.progress <= 0.002 && (child.stage === "arrived" || child.stage === "complete");
  });
}

/** 每条请求有独立状态；只计实际渲染时间，刷新、后台暂停不能跳过已经开始的交流。 */
export function workspaceSpatialVisitFrame(state: WorkspaceSpatialVisitState, fact: WorkspaceSpatialVisitFact, input: {
  nowMs: number; deltaSeconds: number; routeLength: number; outboundLimit?: number;
  reduceMotion?: boolean; exchangeDurationMs?: number; canReceive?: boolean; holdAtHome?: boolean;
}): WorkspaceSpatialVisitState {
  const next = { ...state };
  if (next.stage === "complete") return next;
  next.visualStarted = true;
  const elapsed = Math.min(Math.max(input.deltaSeconds, 0), 0.1) * 1000;
  next.stageElapsedMs = (next.stageElapsedMs ?? 0) + elapsed;
  const exchangeMs = input.exchangeDurationMs ?? WORKSPACE_SPATIAL_VISIT_HANDOFF_MS;
  const moveTo = (stage: WorkspaceSpatialVisitStage) => { next.stage = stage; next.stageAt = input.nowMs; next.stageElapsedMs = 0; };
  if (fact.updatedAt >= next.factUpdatedAt) {
    next.factUpdatedAt = fact.updatedAt;
    next.outcome ??= workspaceSpatialVisitOutcome(fact.phase);
  }
  // 已开始的请求交流必须完整结束，早到结果不能把它截断。
  if (next.stage === "handoff" && next.stageElapsedMs! >= exchangeMs) {
    next.requestExchanged = true;
    moveTo("waiting");
  }
  if (next.outcome && ["outbound", "waiting", "awaiting_handoff"].includes(next.stage)) {
    if (next.outcome !== "completed") moveTo("returning");
    else if (input.canReceive === false) {
      if (next.stage !== "awaiting_handoff") moveTo("awaiting_handoff");
    } else moveTo("receiving");
  }
  if (next.stage === "receiving" && next.stageElapsedMs! >= exchangeMs) moveTo("returning");
  if (next.stage === "arrived" && next.stageElapsedMs! >= ARRIVAL_RESULT_MS && !input.holdAtHome) moveTo("complete");
  const target = next.stage === "outbound" ? input.outboundLimit ?? 1 : next.stage === "returning" ? 0 : next.progress;
  if (target !== next.progress) {
    const step = input.routeLength > 0 ? 3.2 * elapsed / 1000 / input.routeLength : 1;
    next.progress = input.reduceMotion || Math.abs(target - next.progress) <= step
      ? target : next.progress + Math.sign(target - next.progress) * step;
  }
  if (next.stage === "outbound" && next.progress >= 0.998) moveTo("handoff");
  if (next.stage === "returning" && next.progress <= 0.002) moveTo("arrived");
  return next;
}

/** 双方共用同一有限进度：发言者抬手，接收者点头，结束时自然收回。 */
export function workspaceSpatialVisitExchangePose(progress: number, speaker: boolean) {
  const p = Math.min(1, Math.max(0, progress));
  const envelope = Math.sin(Math.PI * p);
  return { armPitch: speaker ? -0.85 * envelope : -0.18 * envelope,
    forearmPitch: -0.55 * envelope, headPitch: speaker ? 0.06 * envelope : 0.22 * Math.sin(Math.PI * p) ** 2 };
}

export function workspaceSpatialVisitLabel(state: Pick<WorkspaceSpatialVisitState, "stage" | "outcome">, target: string, phase: TopologyBridgeJourneyPhase): string {
  if (state.stage === "outbound") return `Walking to ${target}`;
  if (state.stage === "handoff") return `Talking to ${target}`;
  if (state.stage === "waiting") return phase === "waiting_approval" ? `Waiting for ${target} approval` : `Waiting for ${target}`;
  if (state.stage === "awaiting_handoff") return "Result ready";
  if (state.stage === "receiving") return "Receiving result";
  if (state.stage === "returning") return state.outcome === "failed" ? "Request failed · Returning home" : state.outcome === "cancelled" ? "Cancelled · Returning home" : "Returning home";
  return state.outcome === "failed" ? "Request failed" : state.outcome === "cancelled" ? "Cancelled" : "Done";
}

/** TYR 的每个过程阶段都保留可读提示；等待和归位使用紧凑气泡，把详细思考留给 Agent 主气泡。 */
export function workspaceSpatialVisitBubbleMode(
  stage: WorkspaceSpatialVisitStage,
  _localVisit: boolean
): WorkspaceSpatialVisitBubbleMode {
  if (stage === "complete") return "hidden";
  if (["waiting", "awaiting_handoff", "arrived"].includes(stage)) return "secondary";
  return "primary";
}

export function workspaceSpatialVisitActorLabel(input: {
  sourceOwnerName: string;
  targetWorkspaceName: string;
  localVisit: boolean;
  actorMode?: "direct" | "clone";
}): string {
  // 原身直接使用稳定的 TYR 身份；分身附带目标 Workspace，方便并行时区分各自去向。
  return input.localVisit
    ? `${input.sourceOwnerName} TYR`
    : input.actorMode === "direct"
      ? `${input.sourceOwnerName} TYR`
      : `${input.sourceOwnerName} · ${input.targetWorkspaceName}`;
}

export function workspaceSpatialVisitSecondaryLabel(
  state: Pick<WorkspaceSpatialVisitState, "stage" | "outcome">,
  target: string,
  phase: TopologyBridgeJourneyPhase,
  localVisit: boolean
): string {
  if (state.stage === "arrived") {
    if (state.outcome === "failed") return "Request failed · Returned";
    if (state.outcome === "cancelled") return "Cancelled · Returned";
    return "Returned";
  }
  if (state.stage === "awaiting_handoff") return "Result ready";
  // 本地拜访要说明正在等哪位 Agent；跨 Workspace 的角色名已经包含目标 Server，避免重复名称。
  if (localVisit) return phase === "waiting_approval" ? `Waiting for ${target} approval` : `Waiting for ${target}`;
  return "Waiting";
}

/** sessionStorage 只保存无正文的视觉检查点；刷新不会重播或重复触发服务端工作。 */
export function readWorkspaceSpatialVisits(storage: Pick<Storage, "getItem">, workspaceId: string): Map<string, WorkspaceSpatialVisitState> {
  try {
    const entries: unknown = JSON.parse(storage.getItem(`tyr:visits:v1:${workspaceId}`) ?? "[]");
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries.filter((entry): entry is [string, WorkspaceSpatialVisitState] => {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1] || typeof entry[1] !== "object") return false;
      const s = entry[1];
      return ["outbound", "handoff", "waiting", "awaiting_handoff", "receiving", "returning", "arrived", "complete"].includes(s.stage)
        && Number.isFinite(s.progress) && s.progress >= 0 && s.progress <= 1 && Number.isFinite(s.stageAt)
        && typeof s.factUpdatedAt === "string" && Number.isFinite(Date.parse(s.factUpdatedAt))
        && (s.stageElapsedMs === undefined || Number.isFinite(s.stageElapsedMs) && s.stageElapsedMs >= 0)
        && (s.requestExchanged === undefined || typeof s.requestExchanged === "boolean")
        && (s.visualStarted === undefined || typeof s.visualStarted === "boolean")
        && (s.dependentVisitIds === undefined || Array.isArray(s.dependentVisitIds) && s.dependentVisitIds.every((id: unknown) => typeof id === "string"))
        && (s.outcome === undefined || ["completed", "failed", "cancelled"].includes(s.outcome));
    }));
  } catch { return new Map(); }
}

export function saveWorkspaceSpatialVisits(storage: Pick<Storage, "setItem">, workspaceId: string, states: Map<string, WorkspaceSpatialVisitState>): void {
  // 限制历史检查点大小；活跃请求优先保留，避免结果提示长期占用浏览器存储。
  const entries = [...states].sort((a, b) => Number(a[1].stage === "complete") - Number(b[1].stage === "complete") || b[1].stageAt - a[1].stageAt).slice(0, 256);
  try { storage.setItem(`tyr:visits:v1:${workspaceId}`, JSON.stringify(entries)); } catch { /* 存储不可用时仍可运行当前帧。 */ }
}
