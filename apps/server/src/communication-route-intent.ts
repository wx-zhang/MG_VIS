import { createHash } from "node:crypto";
import { isCommunicationAgent, type MessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

export interface RoutePlanProposal {
  decision: "local" | "bridge" | "clarify";
  targetBridgeId: string | null;
  action: string;
  constraints: string[];
  evidenceKind: "current_request" | "prior_confirmation" | "owner_routing_config" | "unresolved";
  evidenceMessageId: string | null;
  clarification: string | null;
  /** Existing same-conversation work, or null for a genuinely independent request. */
  continuationRequestId?: string | null;
}

/** Server-only input for read-only planning; never attach root private history to a peer TYR turn. */
export interface RoutePlanningContext {
  currentWorkspaceName: string;
  requesterRole: "owner" | "member" | "bridge";
  inboundSourceWorkspaceName?: string;
  request: { messageId: string; content: string };
  /** The exact current Bridge hop; request remains the trusted root authority for another outbound hop. */
  inboundRequest?: { messageId: string; content: string };
  requesterClarifications?: Array<{ messageId: string; content: string }>;
  priorHumanMessages: Array<{ messageId: string; content: string }>;
  workspaceRoutingInstructions: { instructions: string; revision: number };
  localAgents: Array<{ id: string; name: string; displayName: string }>;
  bridges: Array<{ id: string; name: string }>;
  existingBridgeRequests?: Array<{ requestId: string; bridgeId: string; sourceMessageId: string; content: string; ended: boolean }>;
}

export interface CommunicationRouteIntent {
  sourceMessageId: string;
  serverId: string;
  requestingUserId: string;
  conversationId: string | null;
  /** restaurant_booking exists only on immutable legacy rows. */
  actionKind: "restaurant_booking" | "contact" | "none";
  allowedActions: Array<"bridge_send" | "ask_user" | "worker_continue">;
  targetBridgeId: string | null;
  evidenceKind: RoutePlanProposal["evidenceKind"];
  evidenceMessageId: string | null;
  requestHash: string;
  routingRevision: number;
  createdAt: string;
  /** null identifies a frozen row created before semantic route planning. */
  plan: RoutePlanProposal | null;
}

export interface CommunicationRoutePlanningInput {
  message: MessageRecord;
  serverId: string;
  requestingUserId: string;
  clarificationSource?: MessageRecord;
  trustedSystemTrigger?: boolean;
}

export function routePlanningWorkspaceName(store: TyrDb, serverId: string): string {
  const row = store.db.prepare("select name from servers where id = ?").get(serverId) as { name: string } | undefined;
  return row?.name ?? "Workspace";
}

export function routePlanningLocalAgents(store: TyrDb, serverId: string): RoutePlanningContext["localAgents"] {
  // Names establish the local/external boundary; do not expose credentials, runtime state or peer directories.
  return store.listAgents(serverId).filter((agent) => !isCommunicationAgent(agent))
    .map((agent) => ({ id: agent.id, name: agent.name, displayName: agent.displayName }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function routePlanningBridges(store: TyrDb, serverId: string, incomingBridgeId?: string): RoutePlanningContext["bridges"] {
  return store.listWorkspaceBridges(serverId)
    .filter((bridge) => bridge.status === "active" && bridge.permissions.includes("chat") &&
      (bridge.direction !== "one_way" || bridge.workspaceAId === serverId) &&
      bridge.id !== incomingBridgeId && bridge.peerWorkspace)
    .map((bridge) => ({ id: bridge.id, name: bridge.peerWorkspace!.name }));
}

export function trustedLocalRouteSource(store: TyrDb, input: CommunicationRoutePlanningInput): MessageRecord | null {
  const message = store.getMessage(input.message.id);
  const channel = message ? store.resolveTarget(message.channelId, input.serverId) : null;
  const identity = channel?.dmIdentity;
  const member = store.listServersForUser(input.requestingUserId).find((server) => server.id === input.serverId);
  if (!message || message.content !== input.message.content || !channel || channel.serverId !== input.serverId ||
      message.channelType !== "dm" || identity?.kind !== "human_agent" ||
      identity.humanUserId !== input.requestingUserId || !member || member.role === "guest" ||
      !store.canUserAccessChannel(input.requestingUserId, channel.id)) return null;
  if (message.senderType === "human") return message.senderId === input.requestingUserId ? message : null;
  if (message.senderType !== "system" || member.role !== "owner") return null;
  // Heartbeat is optional on installations that only include the core Bridge feature.
  const heartbeatTables = store.db.prepare(`select count(*) as count from sqlite_master
    where type = 'table' and name in ('tyr_heartbeats', 'tyr_heartbeat_runs')`).get() as { count: number };
  if (heartbeatTables.count !== 2) return null;
  const run = store.db.prepare(`select run.id from tyr_heartbeat_runs run
    join tyr_heartbeats heartbeat on heartbeat.id = run.heartbeat_id and heartbeat.server_id = run.server_id
    where heartbeat.id = ? and heartbeat.server_id = ? and heartbeat.tyr_agent_id = ? and run.source_message_id = ?`)
    .get(message.senderId, input.serverId, identity.agentId, message.id);
  return run ? message : null;
}

export function getCommunicationRoutePlanningContext(store: TyrDb, input: CommunicationRoutePlanningInput): RoutePlanningContext | null {
  const message = trustedLocalRouteSource(store, input);
  if (!message) return null;
  return {
    currentWorkspaceName: routePlanningWorkspaceName(store, input.serverId),
    requesterRole: store.listServersForUser(input.requestingUserId).find((server) => server.id === input.serverId)?.role === "owner" ? "owner" : "member",
    request: { messageId: message.id, content: message.content },
    priorHumanMessages: message.senderType === "human" ? store.listMessages(message.channelId, 100)
      .filter((prior) => prior.conversationId === message.conversationId && prior.senderType === "human" &&
        prior.senderId === input.requestingUserId && prior.seq < message.seq)
      .map((prior) => ({ messageId: prior.id, content: prior.content })) : [],
    workspaceRoutingInstructions: store.getWorkspaceRoutingInstructions(input.serverId),
    localAgents: routePlanningLocalAgents(store, input.serverId),
    existingBridgeRequests: (store.db.prepare(`select request.id, request.bridge_id, request.origin_message_id, request.content,
        (request.resolved_by_terminal_id is not null or exists
          (select 1 from cross_workspace_messages terminal where terminal.terminal_request_id = request.id)) as ended
      from cross_workspace_messages request join messages source on source.id = request.origin_message_id
      where request.source_workspace_id = ? and request.source_capability_user_id = ? and request.sender_user_id = ?
        and request.origin_channel_id = ? and request.origin_conversation_id is ?
        and request.response_kind is null and request.parent_bridge_request_id is null
        and source.seq < ? order by source.seq desc, request.created_at desc limit 20`)
      .all(input.serverId, input.requestingUserId, input.requestingUserId, message.channelId, message.conversationId ?? null, message.seq) as Array<{ id: string; bridge_id: string; origin_message_id: string; content: string; ended: number }>).map((row) => ({
        requestId: row.id, bridgeId: row.bridge_id, sourceMessageId: row.origin_message_id, content: row.content, ended: Boolean(row.ended)
      })),
    bridges: routePlanningBridges(store, input.serverId)
  };
}

function unresolvedPlan(clarification = "Please clarify the intended next step and connected workspace."): RoutePlanProposal {
  return { decision: "clarify", targetBridgeId: null, action: "Clarify the original request", constraints: [],
    evidenceKind: "unresolved", evidenceMessageId: null, clarification };
}

function normalizedRoutePlan(proposal: unknown): RoutePlanProposal | null {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return null;
  const value = proposal as Record<string, unknown>;
  const fields = ["decision", "targetBridgeId", "action", "constraints", "evidenceKind", "evidenceMessageId", "clarification",
    ...(Object.hasOwn(value, "continuationRequestId") ? ["continuationRequestId"] : [])];
  if (Object.keys(value).length !== fields.length || Object.keys(value).some((key) => !fields.includes(key)) ||
      typeof value.decision !== "string" || !["local", "bridge", "clarify"].includes(value.decision) ||
      !(value.targetBridgeId === null || (typeof value.targetBridgeId === "string" && value.targetBridgeId.trim())) ||
      typeof value.action !== "string" || !value.action.trim() || value.action.length > 2_000 ||
      !Array.isArray(value.constraints) || value.constraints.length > 20 ||
      value.constraints.some((constraint) => typeof constraint !== "string" || !constraint.trim() || constraint.length > 1_000) ||
      typeof value.evidenceKind !== "string" || !["current_request", "prior_confirmation", "owner_routing_config", "unresolved"].includes(value.evidenceKind) ||
      !(value.evidenceMessageId === null || (typeof value.evidenceMessageId === "string" && value.evidenceMessageId.trim())) ||
      !(value.clarification === null || (typeof value.clarification === "string" && value.clarification.trim() && value.clarification.length <= 2_000)) ||
      !(value.continuationRequestId === undefined || value.continuationRequestId === null ||
        (typeof value.continuationRequestId === "string" && value.continuationRequestId.length <= 256 && value.continuationRequestId.trim()))) return null;
  const plan = value as unknown as RoutePlanProposal;
  if (((plan.evidenceKind === "current_request" || plan.evidenceKind === "prior_confirmation")
        ? !plan.evidenceMessageId : plan.evidenceMessageId !== null) ||
      (plan.decision === "bridge" && (plan.evidenceKind === "unresolved" || !plan.targetBridgeId || plan.clarification !== null)) ||
      (plan.decision === "local" && (plan.targetBridgeId !== null || plan.clarification !== null)) ||
      (plan.decision === "clarify" && (plan.targetBridgeId !== null || !plan.clarification))) return null;
  const normalized = { ...plan, action: plan.action.trim(), constraints: plan.constraints.map((constraint) => constraint.trim()),
    clarification: plan.clarification?.trim() ?? null };
  // The exact action and every constraint must fit the Bridge tool without truncation.
  if ([normalized.action, ...normalized.constraints.map((constraint) => `Constraint: ${constraint}`)].join("\n").length > 12_000) return null;
  return normalized;
}

/** Validate model structure and server-owned references, never infer authority from natural-language keywords. */
export function validateRoutePlanProposal(context: RoutePlanningContext, proposal: unknown): RoutePlanProposal {
  if (proposal === undefined && context.bridges.length === 0) {
    return { decision: "local", targetBridgeId: null, action: "Handle the request within this workspace", constraints: [],
      evidenceKind: "current_request", evidenceMessageId: context.request.messageId, clarification: null };
  }
  const plan = normalizedRoutePlan(proposal);
  if (!plan) return unresolvedPlan();
  if ((context.existingBridgeRequests?.length && !Object.hasOwn(plan, "continuationRequestId")) ||
      (plan.continuationRequestId && (plan.decision !== "bridge" || !context.existingBridgeRequests?.some((request) =>
        request.requestId === plan.continuationRequestId && request.bridgeId === plan.targetBridgeId)))) {
    return unresolvedPlan("Does this continue an existing workspace request, or start independent work? Please identify the request.");
  }
  const evidenceValid = plan.evidenceKind === "current_request"
    ? plan.evidenceMessageId === context.request.messageId || Boolean(context.requesterClarifications?.some(item => item.messageId === plan.evidenceMessageId))
    : plan.evidenceKind === "prior_confirmation"
      ? context.priorHumanMessages.some((message) => message.messageId === plan.evidenceMessageId)
      : plan.evidenceKind === "owner_routing_config"
        ? Boolean(context.workspaceRoutingInstructions.instructions.trim())
        : true;
  if (!evidenceValid || (plan.decision === "bridge" && !context.bridges.some((bridge) => bridge.id === plan.targetBridgeId))) return unresolvedPlan();
  return plan;
}

export function storedRoutePlan(value: unknown): RoutePlanProposal | null {
  if (value === null || value === undefined) return null;
  try {
    return normalizedRoutePlan(JSON.parse(String(value))) ?? unresolvedPlan();
  } catch { return unresolvedPlan(); }
}

type RouteIntentAuthority = Pick<CommunicationRouteIntent,
  "actionKind" | "allowedActions" | "targetBridgeId" | "evidenceKind" | "evidenceMessageId" | "plan">;

export function routeIntentAuthorityForPlan(plan: RoutePlanProposal): RouteIntentAuthority {
  return {
    actionKind: plan.decision === "local" ? "none" : "contact",
    allowedActions: plan.decision === "local" ? [] : plan.decision === "bridge"
      ? ["bridge_send", "ask_user", "worker_continue"] : ["ask_user", "worker_continue"],
    targetBridgeId: plan.targetBridgeId, evidenceKind: plan.evidenceKind, evidenceMessageId: plan.evidenceMessageId, plan
  };
}

/** Legacy rows stay frozen; malformed or inconsistent new plans never inherit permissive old columns. */
export function storedRouteIntentAuthority(row: Record<string, unknown>): RouteIntentAuthority {
  let allowedActions: RouteIntentAuthority["allowedActions"] = [];
  try { allowedActions = JSON.parse(String(row.allowed_actions_json)) as RouteIntentAuthority["allowedActions"]; } catch { /* fail closed */ }
  const saved: RouteIntentAuthority = {
    actionKind: row.action_kind as RouteIntentAuthority["actionKind"], allowedActions,
    targetBridgeId: row.target_bridge_id ? String(row.target_bridge_id) : null,
    evidenceKind: row.evidence_kind as RouteIntentAuthority["evidenceKind"],
    evidenceMessageId: row.evidence_message_id ? String(row.evidence_message_id) : null,
    plan: storedRoutePlan(row.plan_json)
  };
  if (!saved.plan) return saved;
  const planned = routeIntentAuthorityForPlan(saved.plan);
  return saved.actionKind === planned.actionKind && saved.targetBridgeId === planned.targetBridgeId &&
    saved.evidenceKind === planned.evidenceKind && saved.evidenceMessageId === planned.evidenceMessageId &&
    Array.isArray(saved.allowedActions) && saved.allowedActions.length === planned.allowedActions.length &&
    planned.allowedActions.every((action) => saved.allowedActions.includes(action))
    ? planned : routeIntentAuthorityForPlan(unresolvedPlan());
}

function rowIntent(row: Record<string, unknown>): CommunicationRouteIntent {
  return {
    sourceMessageId: String(row.source_message_id), serverId: String(row.server_id),
    requestingUserId: String(row.requesting_user_id), conversationId: row.conversation_id ? String(row.conversation_id) : null,
    ...storedRouteIntentAuthority(row),
    requestHash: String(row.request_hash), routingRevision: Number(row.routing_revision), createdAt: String(row.created_at)
  };
}

export function getCommunicationRouteIntent(store: TyrDb, sourceMessageId: string): CommunicationRouteIntent | null {
  const row = store.db.prepare("select * from communication_route_intents where source_message_id = ?")
    .get(sourceMessageId) as Record<string, unknown> | undefined;
  return row ? rowIntent(row) : null;
}

export function restaurantClarificationForMessage(store: TyrDb, input: {
  message: MessageRecord;
  serverId: string;
  assistantAgentId: string;
}): { source: MessageRecord; restaurantName: string } | null {
  const { message, serverId, assistantAgentId } = input;
  if (message.senderType !== "human" || !message.conversationId) return null;
  const previous = store.listMessages(message.channelId, 100)
    .filter((candidate) => candidate.conversationId === message.conversationId && candidate.seq < message.seq)
    .at(-1);
  const sourceId = previous?.result?.communicationRequest?.sourceMessageId;
  // 只有同一会话里 TYR 刚提出的餐厅澄清能补充授权；Agent 回文和旧对话不能代替 Human 选择。
  if (previous?.senderType !== "agent" || previous.senderId !== assistantAgentId ||
      previous.result?.title !== "TYR needs a restaurant" || previous.result.status !== "partial" || !sourceId) return null;
  const source = store.getMessage(sourceId);
  const frozen = source ? getCommunicationRouteIntent(store, source.id) : null;
  if (!source || source.channelId !== message.channelId || source.conversationId !== message.conversationId ||
      source.senderType !== "human" || source.senderId !== message.senderId || source.seq >= previous.seq ||
      frozen?.serverId !== serverId || frozen.actionKind !== "restaurant_booking" || frozen.targetBridgeId ||
      store.listCrossWorkspaceRequestsForSourceMessage(source.id).length > 0) return null;
  // A short reply such as "Sable." is still an explicit restaurant choice.
  const selection = message.content.trim().replace(/^@/u, "").replace(/[.!?。！？]+$/u, "").trim();
  const matches = store.listWorkspaceBridges(serverId).filter((bridge) => bridge.status === "active" &&
    bridge.peerWorkspace?.name?.toLocaleLowerCase() === selection.toLocaleLowerCase());
  if (matches.length !== 1) return null;
  const selected = matches[0]!;
  const savedReply = getCommunicationRouteIntent(store, message.id);
  if (savedReply && (savedReply.actionKind !== "restaurant_booking" || savedReply.targetBridgeId !== selected.id)) return null;
  return { source, restaurantName: selected.peerWorkspace!.name };
}

export function resumedRestaurantBookingContent(clarification: { source: MessageRecord; restaurantName: string }): string {
  return `Original booking request (${clarification.source.createdAt}): ${clarification.source.content}\nRestaurant confirmed by the user: ${clarification.restaurantName}.`;
}

/** 已发出的 Bridge 步骤在终态回到原 DM 后仍算完成，后续本地 worker 不应重新发送。 */
export function completedFrozenBridgeStep(store: TyrDb, intent: {
  targetBridgeId: string | null;
  sourceMessageId?: string;
  parentRequestId?: string;
}): boolean {
  if (!intent.targetBridgeId) return false;
  const requests = intent.parentRequestId
    ? store.listCrossWorkspaceChildRequests(intent.parentRequestId)
    : intent.sourceMessageId
      ? store.listCrossWorkspaceRequestsForSourceMessage(intent.sourceMessageId)
      : [];
  return requests.some((request) => request.bridgeId === intent.targetBridgeId && Boolean(request.conversationId) &&
    store.listCrossWorkspaceMessages(request.bridgeId, { conversationId: request.conversationId! })
      .some((response) => response.terminalRequestId === request.id && response.responseKind === "final" && Boolean(response.originMessageId)));
}

export function ensureCommunicationRouteIntent(store: TyrDb, input: CommunicationRoutePlanningInput & {
  proposal?: RoutePlanProposal;
}): CommunicationRouteIntent {
  const existing = getCommunicationRouteIntent(store, input.message.id);
  if (existing) {
    if (existing.serverId !== input.serverId || existing.requestingUserId !== input.requestingUserId) {
      throw new Error("communication_route_source_not_authorized");
    }
    return existing;
  }
  const intent = resolveCommunicationRouteIntent(store, input);
  store.db.prepare(`insert or ignore into communication_route_intents (
    source_message_id, server_id, requesting_user_id, conversation_id, action_kind,
    allowed_actions_json, target_bridge_id, evidence_kind, evidence_message_id,
    request_hash, routing_revision, created_at, plan_json
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(intent.sourceMessageId, intent.serverId, intent.requestingUserId, intent.conversationId,
      intent.actionKind, JSON.stringify(intent.allowedActions), intent.targetBridgeId, intent.evidenceKind,
      intent.evidenceMessageId, intent.requestHash, intent.routingRevision, intent.createdAt, JSON.stringify(intent.plan));
  return getCommunicationRouteIntent(store, input.message.id)!;
}

export function resolveCommunicationRouteIntent(store: TyrDb, input: CommunicationRoutePlanningInput & {
  proposal?: RoutePlanProposal;
}): CommunicationRouteIntent {
  const context = getCommunicationRoutePlanningContext(store, input);
  if (!context) throw new Error("communication_route_source_not_authorized");
  const message = store.getMessage(input.message.id)!;
  const plan = validateRoutePlanProposal(context, input.proposal);
  return {
    sourceMessageId: message.id, serverId: input.serverId, requestingUserId: input.requestingUserId,
    conversationId: message.conversationId ?? null,
    ...routeIntentAuthorityForPlan(plan),
    requestHash: createHash("sha256").update(message.content.trim()).digest("hex"),
    routingRevision: context.workspaceRoutingInstructions.revision, createdAt: new Date().toISOString(), plan
  };
}
