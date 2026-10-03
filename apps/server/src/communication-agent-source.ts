import type { MessageRecord } from "@tyr-ai/contracts";
import type { McpContinuationAuthorizationErrorCode } from "./mcp-persistence";

export interface HeartbeatExecutionPolicy {
  kind: "heartbeat";
  heartbeatId: string;
  runId: string;
  scheduledFor: string;
}

export interface CommunicationAgentSourceContext {
  source: "web" | "telegram" | "email" | "mcp";
  sourceConversationKey: string;
  sourceEventKey: string;
  externalRef?: string;
  // External MCP identity/scopes are server-populated and never accepted from the model.
  clientId?: string;
  grantId?: string;
  grantedScopes?: string[];
  // The server-owned original message binds every asynchronous step to its MCP authority.
  mcpAuthorityMessageId?: string;
  mcpAuthorizationError?: McpContinuationAuthorizationErrorCode;
  // MCP 的只读工具必须在 TYR 工具执行层再次收紧，不能只依赖客户端 annotations。
  accessMode?: "read_only" | "manage" | "workspace_bridge";
  // Bridge ID 只用于服务端选择当前连接及其权限，不能由模型或客户端改写上下文范围。
  workspaceBridgeId?: string;
  // capabilityUserId 决定目标 TYR 的执行能力；requestingUser* 始终保留真实发送者身份。
  capabilityUserId?: string;
  requestingUserId?: string;
  requestingUserName?: string;
  requestingUserDisplayName?: string;
  requestingUserAvatarUrl?: string | null;
  bridgeTraceId?: string;
  parentBridgeRequestId?: string;
  bridgeContinuationAttemptId?: string;
  // Server-owned binding for a question/follow-up turn. Omitting replyToRequestId
  // later in the same turn must not turn the old request into new work.
  bridgeFollowupRequestId?: string;
  bridgeHopCount?: number;
  // Server-owned count of completed TYR -> worker -> TYR continuations for the same original request.
  continuationStepCount?: number;
  // A worker asked for missing information. Do not send it the same original request again
  // during this continuation; a later Human or authenticated Bridge result creates a new turn.
  awaitingEvidenceFromAgentId?: string;
  // A failed Bridge dependency can be reported or handled locally, but never retried automatically on the same route.
  failedBridgeId?: string;
  // 系统定时触发的签名上下文只在 server 内构造，用于限制 worker 指令与共享文件预授权。
  systemTrigger?: HeartbeatExecutionPolicy;
}

export function webCommunicationAgentSourceContext(
  message: Pick<MessageRecord, "id" | "channelId">
): CommunicationAgentSourceContext {
  // Web DM 直接使用 server 真源 ID，后续草稿隔离和幂等无需生成额外标识。
  return {
    source: "web",
    sourceConversationKey: message.channelId,
    sourceEventKey: message.id
  };
}
