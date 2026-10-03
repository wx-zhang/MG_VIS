import {
  TYR_ASSISTANT_AGENT_DETAILS_FIELDS,
  runtimeDisplayName,
  type AgentRecord,
  type MachineRecord,
  type RuntimePermissionMode,
  type TyrAssistantAgentDetailsField
} from "@tyr-ai/contracts";

export const AGENT_DETAILS_FIELDS = TYR_ASSISTANT_AGENT_DETAILS_FIELDS;
export type AgentDetailsField = TyrAssistantAgentDetailsField;

export interface AgentDetailsCandidate {
  agent: Pick<AgentRecord,
    "id" | "name" | "displayName" | "description" | "runtime" |
    "model" | "permissionMode" | "status"
  >;
  machine: Pick<MachineRecord, "id" | "name"> | null;
}

export interface AgentDetailsQueryIntent {
  agentReference: string;
  field: AgentDetailsField;
}

export type AgentDetailsQueryMatch =
  | { kind: "resolved"; intent: AgentDetailsQueryIntent }
  | { kind: "ambiguous"; field: AgentDetailsField; agentReferences: string[] }
  | { kind: "not_query" };

const QUERY_ALIASES = [
  "tell me", "what", "which", "why", "show", "current", "has", "have", "does",
  "为什么", "什么", "多少", "显示", "查看", "当前",
  "どの", "表示", "現在", "なぜ", "何",
  "무엇", "어떤", "보여", "현재", "왜"
] as const;

const MUTATION_ALIASES = [
  "change", "set", "update", "rename", "give",
  "修改", "更改", "设置", "改名", "重命名",
  "変更", "設定", "改名",
  "변경", "설정", "이름변경"
] as const;

const FIELD_ALIASES: Record<AgentDetailsField, readonly string[]> = {
  summary: ["configuration", "세부 정보", "settings", "details", "profile", "详情", "设置", "詳細", "설정"],
  name: ["handle", "names", "name", "名称", "名字", "名前", "이름", "명칭"],
  description: ["profile prompt", "description", "描述", "简介", "説明", "紹介", "설명", "소개"],
  permissionMode: ["permissions", "permission", "접근 권한", "access", "权限", "権限", "アクセス", "권한"],
  model: ["model", "模型", "モデル", "모델"],
  runtime: ["runtime", "运行时", "ランタイム", "런타임"],
  status: ["status", "state", "状态", "状態", "상태"],
  computer: ["computer", "machine", "电脑", "计算机", "コンピューター", "컴퓨터"],
  id: ["identifier", "stable id", "agent id", "id", "标识", "識別子", "식별자"]
};

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeReference(value: string): string {
  return normalizeText(value).replace(/^@/, "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAlias(content: string, alias: string): boolean {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return false;
  if (!/^[a-z0-9@_. -]+$/.test(normalizedAlias)) return content.includes(normalizedAlias);
  // ASCII alias 必须有字符边界，避免把 set 误命中 settings、id 误命中普通单词片段。
  return new RegExp(`(^|[^a-z0-9_])${escapeRegExp(normalizedAlias)}(?=$|[^a-z0-9_])`, "i").test(content);
}

function hasAnyAlias(content: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => containsAlias(content, alias));
}

function matchedField(content: string): AgentDetailsField | undefined {
  return (Object.entries(FIELD_ALIASES) as Array<[AgentDetailsField, readonly string[]]>)
    .flatMap(([field, aliases]) => aliases.map((alias) => ({ field, alias })))
    .sort((left, right) => normalizeText(right.alias).length - normalizeText(left.alias).length)
    .find(({ alias }) => containsAlias(content, alias))?.field;
}

function identityAliases(candidate: AgentDetailsCandidate): string[] {
  return [candidate.agent.id, candidate.agent.name, candidate.agent.displayName]
    .map(normalizeText)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function mentionedCandidates(content: string, candidates: AgentDetailsCandidate[]): AgentDetailsCandidate[] {
  return candidates.filter((candidate) => identityAliases(candidate).some((alias) => containsAlias(content, alias)));
}

export function parseAgentDetailsQuery(input: {
  content: string;
  candidates: AgentDetailsCandidate[];
}): AgentDetailsQueryMatch {
  const content = normalizeText(input.content);
  if (!content || hasAnyAlias(content, MUTATION_ALIASES)) return { kind: "not_query" };
  if (!hasAnyAlias(content, QUERY_ALIASES)) return { kind: "not_query" };
  const field = matchedField(content);
  if (!field) return { kind: "not_query" };

  const candidates = mentionedCandidates(content, input.candidates);
  if (candidates.length === 0) return { kind: "not_query" };
  if (candidates.length > 1) {
    return {
      kind: "ambiguous",
      field,
      agentReferences: candidates.map((candidate) => candidate.agent.id)
    };
  }
  return {
    kind: "resolved",
    intent: {
      // 解析后立即转 stable ID，后续 formatter 不再依赖用户输入的大小写或 display name。
      agentReference: candidates[0]!.agent.id,
      field
    }
  };
}

export function resolveAgentDetailsCandidates(
  reference: string,
  candidates: AgentDetailsCandidate[]
): AgentDetailsCandidate[] {
  const normalized = normalizeReference(reference);
  if (!normalized) return [];
  return candidates.filter((candidate) => [
    candidate.agent.id,
    candidate.agent.name,
    candidate.agent.displayName
  ].some((value) => normalizeReference(value) === normalized));
}

function permissionLabel(value: RuntimePermissionMode | undefined): string {
  if (value === "read-only") return "Read-only access";
  if (value === "dev-full-access") return "Full development access";
  return "Balanced workspace access";
}

export function formatAgentDetailsReply(candidate: AgentDetailsCandidate, field: AgentDetailsField): string {
  const { agent, machine } = candidate;
  if (field === "permissionMode") {
    const value = agent.permissionMode ?? "workspace-write";
    return `${agent.displayName}'s permission: ${permissionLabel(value)} (${value}).`;
  }
  if (field === "name") {
    return [
      `Display name: ${agent.displayName}`,
      `Handle: @${agent.name}`,
      "The handle is derived from the display name for mentions and commands; it is not the stable Agent ID."
    ].join("\n");
  }
  if (field === "id") return `Stable ID: ${agent.id}`;
  if (field === "description") return `${agent.displayName}'s description: ${agent.description || "none"}`;
  if (field === "model") return `${agent.displayName}'s model: ${agent.model || "default"}`;
  if (field === "runtime") {
    return `${agent.displayName}'s runtime: ${agent.runtime ? runtimeDisplayName(agent.runtime) : "none"}`;
  }
  if (field === "status") return `${agent.displayName}'s status: ${agent.status}`;
  if (field === "computer") return `${agent.displayName}'s device: ${machine?.name ?? "none"}`;
  return [
    `Display name: ${agent.displayName}`,
    `Handle: @${agent.name}`,
    `Status: ${agent.status}`,
    `Runtime: ${agent.runtime ? runtimeDisplayName(agent.runtime) : "none"}`,
    `Model: ${agent.model || "default"}`,
    `Permission: ${permissionLabel(agent.permissionMode)} (${agent.permissionMode ?? "workspace-write"})`,
    `Description: ${agent.description || "none"}`,
    `Device: ${machine?.name ?? "none"}`
  ].join("\n");
}

export function formatAgentDetailsAmbiguousReply(candidates: AgentDetailsCandidate[]): string {
  return [
    "I found more than one matching Agent:",
    ...candidates.map((candidate) => `- ${candidate.agent.displayName} (@${candidate.agent.name})`),
    "Use the exact @handle and try again."
  ].join("\n");
}
