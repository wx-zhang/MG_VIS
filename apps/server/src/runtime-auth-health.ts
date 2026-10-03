import type { AgentRecord, RuntimeAuthStatus, RuntimeId } from "@tyr-ai/contracts";

export interface RuntimeAuthHealthUpdate {
  machineId: string;
  runtime: RuntimeId;
  authStatus: RuntimeAuthStatus;
  reason: string;
}

const LOGIN_REQUIRED_PATTERNS = [
  /please\s+run\s+\/login\b/i,
  /\blogin\s+required\b/i,
  /\bauthentication\s+required\b/i,
  /\bnot\s+authenticated\b/i,
  /\bunauthenticated\b/i,
  /\baccess\s+token\s+could\s+not\s+be\s+refreshed\b/i,
  /\bplease\s+(?:log\s+in|login)\b/i
] as const;

export function runtimeAuthHealthFromError(
  agent: Pick<AgentRecord, "machineId" | "runtime"> | null | undefined,
  detail?: string | null
): RuntimeAuthHealthUpdate | null {
  const reason = detail?.trim();
  if (!agent || !reason) return null;
  if (!agent.machineId || !agent.runtime) return null;
  // 只识别明确的 CLI 登录/认证错误，避免任务内容里普通提到 login 时污染 runtime health。
  if (!LOGIN_REQUIRED_PATTERNS.some((pattern) => pattern.test(reason))) return null;
  return {
    machineId: agent.machineId,
    runtime: agent.runtime,
    authStatus: "login_required",
    reason
  };
}
