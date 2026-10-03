import type { RuntimePermissionMode } from "@tyr-ai/contracts";

export interface GuardAgentContext {
  id: string;
  name: string;
  displayName: string;
  runtime: string | null;
  runtimeLabel: string;
  models: Array<{ id: string; label: string }>;
  availableRuntimes: Array<{ id: string; label: string }>;
}

export type GuardedAgentManagementIntent =
  | {
      kind: "update";
      agentReference?: string;
      field?: "name" | "description" | "permissionMode" | "model";
      value?: string;
      foreignRuntimeReference?: string;
    }
  | {
      kind: "unsupported_runtime_update";
      agentReference?: string;
      requestedRuntimeReference?: string;
    }
  | { kind: "not_management" };

const ACTION_ALIASES = [
  "change", "set", "update", "modify", "rename", "give",
  "修改", "更改", "改为", "设置", "改名", "重命名",
  "変更", "変えて", "設定", "改名",
  "변경", "바꿔", "설정", "이름변경"
];

const FIELD_ALIASES = {
  name: ["name", "rename", "名称", "名字", "改名", "重命名", "名前", "이름", "명칭", "이름변경"],
  description: ["description", "profile prompt", "描述", "简介", "説明", "紹介", "설명", "소개"],
  permissionMode: ["permission", "access", "权限", "访问权限", "権限", "アクセス", "권한", "접근 권한"],
  model: ["model", "模型", "モデル", "모델"],
  runtime: ["runtime", "运行时", "ランタイム", "런타임"]
} as const;

const PERMISSION_ALIASES: Record<RuntimePermissionMode, string[]> = {
  "read-only": ["read only", "read-only", "readonly", "只读", "只读权限", "読み取り専用", "閲覧のみ", "읽기 전용"],
  "workspace-write": ["workspace write", "workspace-write", "balanced", "工作区写入", "工作区写权限", "ワークスペース書き込み", "작업공간 쓰기"],
  "dev-full-access": ["full dev access", "full development access", "完整开发权限", "完全开发权限", "完全な開発アクセス", "전체 개발 권한"]
};

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAlias(content: string, alias: string): boolean {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return false;
  if (!/^[a-z0-9 .]+$/.test(normalizedAlias)) return content.includes(normalizedAlias);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedAlias)}(?=$|[^a-z0-9])`, "i").test(content);
}

function matchingAlias(content: string, aliases: readonly string[]): string | undefined {
  return [...aliases]
    .sort((left, right) => normalizeText(right).length - normalizeText(left).length)
    .find((alias) => containsAlias(content, alias));
}

export function normalizePermissionAlias(value: string): RuntimePermissionMode | undefined {
  const normalized = normalizeText(value);
  return (Object.entries(PERMISSION_ALIASES) as Array<[RuntimePermissionMode, string[]]>)
    .find(([, aliases]) => aliases.some((alias) => normalizeText(alias) === normalized))?.[0];
}

function permissionInMessage(content: string): RuntimePermissionMode | undefined {
  return (Object.entries(PERMISSION_ALIASES) as Array<[RuntimePermissionMode, string[]]>)
    .find(([, aliases]) => matchingAlias(content, aliases))?.[0];
}

function matchingAgent(content: string, agents: GuardAgentContext[]): GuardAgentContext | undefined {
  const aliases = agents.flatMap((agent) => [agent.name, agent.displayName, agent.id]
    .filter(Boolean)
    .map((alias) => ({ alias, agent })));
  return aliases
    .sort((left, right) => normalizeText(right.alias).length - normalizeText(left.alias).length)
    .find(({ alias }) => containsAlias(content, alias))?.agent;
}

function matchingRuntime(content: string, runtimes: GuardAgentContext["availableRuntimes"]): { id: string; label: string } | undefined {
  return runtimes
    .flatMap((runtime) => [runtime.label, runtime.id].map((alias) => ({ alias, runtime })))
    .sort((left, right) => normalizeText(right.alias).length - normalizeText(left.alias).length)
    .find(({ alias }) => containsAlias(content, alias))?.runtime;
}

function matchingModel(content: string, models: GuardAgentContext["models"]): string | undefined {
  return models
    .flatMap((model) => [model.label, model.id].map((alias) => ({ alias, model })))
    .sort((left, right) => normalizeText(right.alias).length - normalizeText(left.alias).length)
    .find(({ alias }) => containsAlias(content, alias))?.model.id;
}

export function guardAgentManagementMessage(input: {
  content: string;
  agents: GuardAgentContext[];
}): GuardedAgentManagementIntent {
  const content = normalizeText(input.content);
  if (!content || !matchingAlias(content, ACTION_ALIASES)) return { kind: "not_management" };

  const agent = matchingAgent(content, input.agents);
  if (!agent) return { kind: "not_management" };
  const agentReference = agent.name;

  if (matchingAlias(content, FIELD_ALIASES.runtime)) {
    const requestedRuntime = matchingRuntime(content, agent.availableRuntimes);
    return {
      kind: "unsupported_runtime_update",
      agentReference,
      ...(requestedRuntime ? { requestedRuntimeReference: requestedRuntime.label } : {})
    };
  }

  if (matchingAlias(content, FIELD_ALIASES.permissionMode)) {
    const value = permissionInMessage(content);
    return {
      kind: "update",
      agentReference,
      field: "permissionMode",
      ...(value ? { value } : {})
    };
  }

  if (matchingAlias(content, FIELD_ALIASES.model)) {
    const value = matchingModel(content, agent.models);
    if (value) return { kind: "update", agentReference, field: "model", value };
    const runtime = matchingRuntime(content, agent.availableRuntimes);
    const foreignRuntime = runtime && runtime.id !== agent.runtime ? runtime : undefined;
    return {
      kind: "update",
      agentReference,
      field: "model",
      ...(foreignRuntime ? { foreignRuntimeReference: foreignRuntime.label } : {})
    };
  }

  if (matchingAlias(content, FIELD_ALIASES.name)) {
    return { kind: "update", agentReference, field: "name" };
  }
  if (matchingAlias(content, FIELD_ALIASES.description)) {
    return { kind: "update", agentReference, field: "description" };
  }
  return { kind: "update", agentReference };
}
