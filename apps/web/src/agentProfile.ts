import {
  AGENT_ACTIVE_CAPABILITIES,
  AGENT_PLANNED_CAPABILITIES,
  DEFAULT_RUNTIME_PERMISSION_MODE,
  isCommunicationAgent,
  runtimeDisplayName,
  type AgentCapability,
  type AgentRecord,
  type AgentScopes,
  type MachineRecord,
  type RuntimePermissionMode,
  type RuntimeResourceGrant,
  type RuntimeResourceGrantKind,
  type RuntimeResourceGrantScope,
  type UserRecord
} from "@tyr-ai/contracts";

export type AgentProfileDraft = {
  displayName: string;
  description: string;
  model: string;
  permissionMode: RuntimePermissionMode;
  runtimeResourceGrants: RuntimeResourceGrant[];
};

export type AgentProfileApplyState = {
  status: "applied" | "pending" | "failed";
  label: "Applied" | "Pending" | "Failed";
  detail: string;
};

export function agentProfileApplyState(agent: AgentRecord): AgentProfileApplyState {
  const revision = agent.profileRevision ?? 1;
  const appliedRevision = agent.profileAppliedRevision ?? 0;
  if (agent.profileApplyError) {
    return { status: "failed", label: "Failed", detail: `Runtime could not apply revision ${revision}.` };
  }
  if (appliedRevision >= revision) {
    return { status: "applied", label: "Applied", detail: `Runtime is using revision ${revision}.` };
  }
  // Pending 表示服务端已保存但 Runtime 尚未用新上下文回报 ACK，不是定时分发延迟。
  return { status: "pending", label: "Pending", detail: `Saved on server; applies after a fresh Runtime context confirms revision ${revision}.` };
}

export type AgentPermissionPresetId = "default" | "read-only" | "autonomous";

export type AgentPermissionPreset = {
  id: AgentPermissionPresetId;
  label: string;
  text: string;
  capabilities: AgentCapability[];
};

const PERMISSION_MODE_LABELS: Record<RuntimePermissionMode, string> = {
  "dev-full-access": "Full Access (Advanced)",
  "workspace-write": "Balanced (Recommended)",
  "read-only": "Read Only"
};

const REASONING_LABELS: Record<NonNullable<AgentRecord["reasoningEffort"]>, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh"
};

const RUNTIME_RESOURCE_GRANT_SCOPES_BY_KIND: Record<RuntimeResourceGrantKind, RuntimeResourceGrantScope[]> = {
  directory: ["read", "write"],
  network_domain: ["connect"],
  service_account: ["use"],
  device: ["use"],
  mcp_server: ["use"]
};

export const AGENT_PERMISSION_PRESETS: AgentPermissionPreset[] = [
  {
    id: "default",
    label: "Default",
    text: "Use the system default wired capability set.",
    capabilities: [...AGENT_ACTIVE_CAPABILITIES]
  },
  {
    id: "read-only",
    label: "Observer scopes",
    text: "Tyr service scopes for receiving and reading context; this does not set local Runtime Access.",
    capabilities: ["inbox:receive", "server:read", "message:read", "attachment:view"]
  },
  {
    id: "autonomous",
    label: "Autonomous",
    text: "Can use every capability currently wired in the product.",
    capabilities: [...AGENT_ACTIVE_CAPABILITIES]
  }
];

function sameCapabilities(left: readonly AgentCapability[], right: readonly AgentCapability[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((capability) => right.includes(capability));
}

export function agentPermissionPresetCapabilities(presetId: AgentPermissionPresetId): AgentCapability[] {
  return [...(AGENT_PERMISSION_PRESETS.find((preset) => preset.id === presetId)?.capabilities ?? AGENT_ACTIVE_CAPABILITIES)];
}

export function agentPermissionPresetForCapabilities(capabilities: readonly AgentCapability[], mode: AgentScopes["mode"]): AgentPermissionPresetId | "custom" {
  const normalized = AGENT_ACTIVE_CAPABILITIES.filter((capability) => capabilities.includes(capability));
  if (mode === "default" && sameCapabilities(normalized, agentPermissionPresetCapabilities("default"))) return "default";
  for (const preset of AGENT_PERMISSION_PRESETS.filter((item) => item.id !== "default")) {
    if (sameCapabilities(normalized, preset.capabilities)) return preset.id;
  }
  return "custom";
}

export function agentCapabilityPlanningState(capability: AgentCapability): { disabled: boolean; badge: string; reason: string } | null {
  if (!AGENT_PLANNED_CAPABILITIES.includes(capability as (typeof AGENT_PLANNED_CAPABILITIES)[number])) return null;
  return {
    disabled: true,
    badge: "planned",
    reason: "Planned capability. It is not wired to runtime enforcement yet."
  };
}

export function agentPermissionDraftChanged(scopes: AgentScopes, draft: readonly AgentCapability[], preset: AgentPermissionPresetId | "custom"): boolean {
  const normalizedDraft = AGENT_ACTIVE_CAPABILITIES.filter((capability) => draft.includes(capability));
  if (preset === "default" && scopes.mode !== "default") return true;
  if (preset !== "default" && scopes.mode === "default") return true;
  return !sameCapabilities(normalizedDraft, scopes.granted);
}

export function agentProfileDraft(agent: AgentRecord): AgentProfileDraft {
  return {
    displayName: agent.displayName,
    description: agent.description ?? "",
    model: agent.model ?? "",
    permissionMode: agent.permissionMode ?? DEFAULT_RUNTIME_PERMISSION_MODE,
    runtimeResourceGrants: normalizeRuntimeResourceGrants(agent.runtimeResourceGrants ?? [])
  };
}

export function defaultRuntimeResourceGrant(): RuntimeResourceGrant {
  return {
    kind: "directory",
    target: "",
    scopes: ["read"]
  };
}

export function runtimeResourceGrantScopeOptions(kind: RuntimeResourceGrantKind): RuntimeResourceGrantScope[] {
  return [...RUNTIME_RESOURCE_GRANT_SCOPES_BY_KIND[kind]];
}

export function normalizeRuntimeResourceGrants(grants: readonly RuntimeResourceGrant[]): RuntimeResourceGrant[] {
  return grants.flatMap((grant) => {
    const target = grant.target.trim();
    if (!target) return [];
    const allowedScopes = runtimeResourceGrantScopeOptions(grant.kind);
    const requestedScopes = new Set(grant.scopes.filter((scope) => allowedScopes.includes(scope)));
    if (requestedScopes.size === 0) return [];
    const label = grant.label?.trim();
    // UI draft normalization mirrors server-side policy: only owner-entered non-empty resources with valid scopes are persisted.
    return [{
      kind: grant.kind,
      ...(label ? { label } : {}),
      target,
      scopes: allowedScopes.filter((scope) => requestedScopes.has(scope))
    }];
  });
}

export function runtimeResourceGrantsForPermissionMode(
  grants: readonly RuntimeResourceGrant[],
  permissionMode: RuntimePermissionMode
): RuntimeResourceGrant[] {
  if (permissionMode !== "read-only") return [...grants];
  return grants.map((grant) => grant.kind !== "directory"
    ? grant
    : { ...grant, scopes: ["read"] });
}

export function normalizeAgentProfileDraft(draft: AgentProfileDraft): AgentProfileDraft {
  const runtimeResourceGrants = normalizeRuntimeResourceGrants(draft.runtimeResourceGrants);
  return {
    // 空 Model 表示交还 runtime 默认值；runtime/session/workspace 仍保持只读。
    displayName: draft.displayName.trim(),
    description: draft.description.trim(),
    model: draft.model.trim(),
    permissionMode: draft.permissionMode,
    runtimeResourceGrants: runtimeResourceGrantsForPermissionMode(runtimeResourceGrants, draft.permissionMode)
  };
}

export function agentProfileDraftChanged(agent: AgentRecord, draft: AgentProfileDraft): boolean {
  const normalized = normalizeAgentProfileDraft(draft);
  const currentDescription = agent.description?.trim() ?? "";
  return normalized.displayName !== agent.displayName.trim()
    || normalized.description !== currentDescription
    || normalized.model !== (agent.model ?? "")
    || normalized.permissionMode !== (agent.permissionMode ?? DEFAULT_RUNTIME_PERMISSION_MODE)
    || JSON.stringify(normalized.runtimeResourceGrants) !== JSON.stringify(normalizeRuntimeResourceGrants(agent.runtimeResourceGrants ?? []));
}

export function permissionModeTitle(mode: RuntimePermissionMode = DEFAULT_RUNTIME_PERMISSION_MODE): string {
  return PERMISSION_MODE_LABELS[mode];
}

export function agentRuntimeSummary(agent: AgentRecord): string {
  if (isCommunicationAgent(agent)) return "Server-hosted message hub";
  const model = agent.model || "Default";
  const reasoning = REASONING_LABELS[agent.reasoningEffort ?? "medium"];
  return `${runtimeDisplayName(agent.runtime ?? "codex")} · ${model} · ${reasoning} · ${permissionModeTitle(agent.permissionMode)}`;
}

export function agentMachineSummary(machine?: MachineRecord, agent?: AgentRecord): { title: string; detail: string; warning: string | null } {
  if (agent && isCommunicationAgent(agent)) {
    return {
      title: "Workspace",
      detail: "Server-hosted communication identity",
      warning: null
    };
  }
  const hostMachine = machine ?? agent?.hostMachine;
  if (!hostMachine) {
    return {
      title: "Missing device",
      detail: "No daemon connection",
      warning: "No linked device found."
    };
  }
  return {
    title: hostMachine.name,
    detail: `${hostMachine.status} · daemon ${hostMachine.daemonVersion || "unknown"} · ${hostMachine.os || "unknown os"} · ${hostMachine.hostname || "unknown host"}`,
    warning: hostMachine.status === "offline" ? "Device is offline." : null
  };
}

export function agentOwnerLabel(agent: AgentRecord, humans: UserRecord[], currentUser: UserRecord): string {
  const owner = humans.find((human) => human.id === agent.ownerUserId) ?? (currentUser.id === agent.ownerUserId ? currentUser : undefined);
  return owner?.displayName ?? "Unknown owner";
}

export function canManageAgentRuntimeView(agent: AgentRecord | undefined | null, machine: MachineRecord | undefined | null, currentUserId: string): agent is AgentRecord {
  if (isCommunicationAgent(agent)) return false;
  const bridgeTargetMatches = Boolean(
    agent?.bridgeAccess?.fullAccess &&
    machine?.bridgeAccess?.fullAccess &&
    agent.bridgeAccess.targetWorkspaceId === machine.bridgeAccess.targetWorkspaceId
  );
  return Boolean(agent && machine && (bridgeTargetMatches || (agent.ownerUserId === currentUserId && machine.ownerUserId === currentUserId)));
}

export function agentLifecycleWarning(agent: AgentRecord, machine?: MachineRecord): string | null {
  if (isCommunicationAgent(agent)) return null;
  if (!machine && agent.hostMachine) {
    return agent.hostMachine.status === "offline" ? "Shared host device is offline. Runtime controls remain owner-only." : null;
  }
  if (!machine) return "No linked device found. Start and restart actions will fail until the agent is attached to a device.";
  // Agent 生命周期依赖 daemon 在线；离线时允许查看配置，但启动/重启无法立即落地。
  if (machine.status === "offline") return "Device is offline. Start, stop, and restart will wait until the daemon reconnects.";
  if (agent.status === "error") return "Agent is in error state. Restart can create a fresh runtime session.";
  return null;
}

export function agentLastErrorSummary(agent: AgentRecord): string | null {
  const lastError = agent.lastError?.trim();
  return lastError ? `Last runtime error: ${lastError}` : null;
}
