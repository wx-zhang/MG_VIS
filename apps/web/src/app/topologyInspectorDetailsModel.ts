import { DEFAULT_RUNTIME_PERMISSION_MODE, RUNTIMES, isCommunicationAgent, runtimeDisplayName, type AgentRecord, type AppSnapshot, type DeviceRecord, type MachineRecord, type RuntimeReport, type ServerInviteRecord, type UserRecord } from "@tyr-ai/contracts";
import { agentMachineSummary, agentOwnerLabel, agentRuntimeSummary, permissionModeTitle } from "../agentProfile";
import { fallbackHumanProfile, humanProfileFacts, humanRoleActionState, humanServerRole, memberRoleLabel } from "../humanProfile";
import { machineCredentialControlsVisible, machineOwnerControlsVisible, sharedResourceLabel } from "../resourceAccess";
import { agentStatusLabel, liveStatusLabel } from "./workspaceUtils";
import { runtimeHealthLabel } from "../runtimeHealth";
import { agentVisibleInTopology, type ChannelMemberIndex, type TopologyGraphNode, type TopologyRow } from "../topology";

export type TopologyInspectorSectionId =
  | "server-overview"
  | "server-counts"
  | "machine-info"
  | "machine-connect-command"
  | "machine-runtimes"
  | "machine-agents"
  | "machine-actions"
  | "agent-profile"
  | "agent-contact-methods"
  | "agent-communication"
  | "agent-runtime"
  | "agent-permissions"
  | "agent-sharing"
  | "agent-lifecycle"
  | "agent-reminders"
  | "agent-workspace"
  | "agent-activity"
  | "agent-skills"
  | "human-profile"
  | "human-description"
  | "human-role-access"
  | "human-created-agents"
  | "human-granted-resources"
  | "device-profile"
  | "shared-zone-overview"
  | "workspace-bridge-overview"
  | "workspace-bridge-permissions";

export type TopologyInspectorField = {
  label: string;
  value: string;
};

export type TopologyInspectorSectionModel = {
  id: TopologyInspectorSectionId;
  title: string;
  summary?: string;
  fields: TopologyInspectorField[];
  actions: string[];
  ownerOnly?: boolean;
};

export type TopologyInspectorModel = {
  badge: string;
  title: string;
  subtitle: string;
  tone: "server" | "machine" | "agent" | "human" | "channel" | "shared" | "device" | "empty";
  sections: TopologyInspectorSectionModel[];
};

type InspectorModelInput = {
  node?: TopologyGraphNode;
  snapshot: AppSnapshot;
  channelMemberIndex?: ChannelMemberIndex;
  memberInvites?: ServerInviteRecord[];
};

export function topologyInspectorModelForNode({ node, snapshot, channelMemberIndex = {}, memberInvites = [] }: InspectorModelInput): TopologyInspectorModel {
  if (!node) {
    return {
      badge: "NO SELECTION",
      title: "Select a node",
      subtitle: "Choose a topology graph node to inspect configuration.",
      tone: "empty",
      sections: []
    };
  }

  if (node.kind === "server") return serverInspectorModel(snapshot, memberInvites);
  if (node.kind === "shared-zone") return sharedZoneInspectorModel(snapshot);
  if (node.kind === "workspace-bridge" && node.bridge) return workspaceBridgeInspectorModel(node);

  const row = node.row;
  if (row?.kind === "machine") return machineInspectorModel(row.machine, snapshot);
  if (row?.kind === "agent") return agentInspectorModel(row.agent, snapshot);
  if (row?.kind === "human") return humanInspectorModel(row.human, snapshot, row, memberInvites);
  if (row?.kind === "device") return deviceInspectorModel(row.device, snapshot);

  return {
    badge: "NODE CONFIG",
    title: node.label,
    subtitle: node.subtitle,
    tone: "empty",
    sections: []
  };
}

function workspaceBridgeInspectorModel(node: TopologyGraphNode): TopologyInspectorModel {
  const bridge = node.bridge;
  if (!bridge) {
    return {
      badge: "BRIDGE DETAILS",
      title: "Workspace Bridge",
      subtitle: "",
      tone: "shared",
      sections: []
    };
  }

  return {
    badge: "BRIDGE DETAILS",
    title: "Workspace Bridge",
    subtitle: `${bridge.peerWorkspaceName} / ${bridgeStatusLabel(bridge.status)} · ${bridgeDirectionLabel(bridge.direction)}`,
    tone: "shared",
    sections: [
      section("workspace-bridge-overview", "Bridge overview", [
        field("Status", bridgeStatusLabel(bridge.status)),
        field("Direction", bridgeDirectionLabel(bridge.direction)),
        field("Peer workspace", bridge.peerWorkspaceName),
        field("Scope", bridge.scope)
      ]),
      section("workspace-bridge-permissions", "Permissions", [
        field("Allowed", bridge.permissions.length ? bridge.permissions.join(", ") : "None")
      ])
    ]
  };
}

function deviceInspectorModel(device: DeviceRecord, snapshot: AppSnapshot): TopologyInspectorModel {
  return {
    badge: "MOBILE DEVICE CONFIG",
    title: device.displayName,
    subtitle: `${device.platform} / ${device.status}`,
    tone: "device",
    sections: [
      section("device-profile", "Mobile Device", [
        field("Status", device.status),
        field("Platform", `${device.platform} / ${device.deviceKind}`),
        field("Methods", device.capabilities.length),
        field("Last seen", formatDate(device.lastSeenAt))
      ])
    ]
  };
}

function serverInspectorModel(snapshot: AppSnapshot, _memberInvites: ServerInviteRecord[]): TopologyInspectorModel {
  const serverName = snapshot.currentServer?.name ?? "Current workspace";
  const currentRole = snapshot.currentServer?.role ?? "member";

  return {
    badge: "WORKSPACE CONFIG",
    title: serverName,
    subtitle: "",
    tone: "server",
    sections: [
      section("server-overview", "Workspace overview", [
        field("Name", serverName),
        field("Role", memberRoleLabel(currentRole)),
        field("Created", snapshot.currentServer?.createdAt ? formatDate(snapshot.currentServer.createdAt) : "Unknown")
      ], currentRole === "owner" ? ["Save name"] : []),
      section("server-counts", "Topology counts", [
        field("Devices", snapshot.machines.length),
        field("Agents", snapshot.agents.filter((agent) => agentVisibleInTopology(agent, snapshot.currentUser.id)).length)
      ])
    ]
  };
}

function machineInspectorModel(machine: MachineRecord, snapshot: AppSnapshot): TopologyInspectorModel {
  const owner = humanName(snapshot, machine.ownerUserId);
  const isOwner = machineOwnerControlsVisible(machine, snapshot.currentUser.id);
  const canViewCredential = machineCredentialControlsVisible(machine, snapshot.currentUser.id);
  const runtimes = machineRuntimes(machine);
  const agents = machineAgents(machine, snapshot);
  const latestDaemonVersion = machine.latestDaemonVersion ?? machine.daemonVersion;
  const runtimeBundle = machineRuntimeBundleStatus(machine);
  const sharedLabel = sharedResourceLabel(machine);

  return {
    badge: "DEVICE CONFIG",
    title: machine.name,
    subtitle: machine.hostname === machine.name ? "" : machine.hostname,
    tone: "machine",
    sections: [
      section("machine-info", "Daemon and host", [
        field("Name", machine.name),
        field("Owner", owner),
        field("Shared", sharedLabel || "Not shared"),
        field("Status", liveStatusLabel(machine.status)),
        field("Hostname", machine.hostname),
        field("Operating system", machine.os),
        field("Daemon version", machine.daemonVersion || "Unknown"),
        field("Latest version", `${latestDaemonVersion || "Unknown"}${latestDaemonVersion && latestDaemonVersion !== machine.daemonVersion ? " · update available" : ""}`),
        field("Runtime bundle", shortRuntimeSha(machine.runtimeSha)),
        field("Expected bundle", shortRuntimeSha(machine.latestRuntimeSha)),
        field("Bundle status", runtimeBundle),
        field("Created", formatDate(machine.createdAt)),
        field("Last seen", machine.lastSeenAt ? formatDate(machine.lastSeenAt) : "Never")
      ]),
      section("machine-agents", "Agents on this device", [
        field("Total", agents.length),
        field("Online", agents.filter((agent) => agent.status === "online" || agent.status === "working").length),
        field("Agents", agents.length ? agents.map((agent) => agent.displayName).join(", ") : "No agents")
      ], isOwner ? ["Start all", "Stop all", "Restart all", "Reset all", "Create Agent"] : []),
      section("machine-connect-command", "Connect command", [
        field("Availability", canViewCredential ? "Load reusable command" : "Device owner only"),
        field("Status", machineConnectorTokenStatus(machine))
      ], isOwner ? ["Copy command", "Regenerate command"] : [], true),
      section("machine-runtimes", "Detected runtimes", runtimeFields(runtimes)),
      section("machine-actions", "Danger zone", [
        field("Delete guard", agents.length > 0 ? "Remove agents before deleting" : "Ready")
      ], isOwner ? ["Delete Device"] : [], true)
    ]
  };
}

function agentInspectorModel(agent: AgentRecord, snapshot: AppSnapshot): TopologyInspectorModel {
  const machine = agent.machineId ? snapshot.machines.find((item) => item.id === agent.machineId) : undefined;
  const canManage = Boolean(!isCommunicationAgent(agent) && machine && agent.ownerUserId === snapshot.currentUser.id && machine.ownerUserId === snapshot.currentUser.id);
  const machineSummary = agentMachineSummary(machine, agent);
  const ownerLabel = agentOwnerLabel(agent, snapshot.humans, snapshot.currentUser);
  const existingGrants = snapshot.resourceGrantSummaries.filter((grant) => grant.resourceType === "agent" && grant.resourceId === agent.id);

  if (isCommunicationAgent(agent)) {
    return {
      badge: "COMMUNICATION AGENT",
      title: agent.displayName,
      subtitle: "Server-hosted communication",
      tone: "agent",
      sections: [
        section("agent-profile", "Profile", [
          field("Display name", agent.displayName),
          field("Agent Profile Prompt", agent.description || "Not set")
        ]),
        section("agent-contact-methods", "Contact TYR", [
          field("Email", agent.communicationEmailAddress || "Not assigned"),
          field("Telegram", "Loaded from account binding")
        ]),
        section("agent-communication", "Communication", [
          field("Status", agentStatusLabel(agent.status)),
          field("Execution", "Server-hosted"),
          field("Device", "No device required"),
          field("Runtime summary", agentRuntimeSummary(agent)),
          field("Owner", ownerLabel)
        ]),
        section("agent-activity", "Agent History", [
          field("Ledger", "Server-hosted communication history")
        ])
      ]
    };
  }

  return {
    badge: "AGENT CONFIG",
    title: agent.displayName,
    subtitle: `@${agent.name}`,
    tone: "agent",
    sections: [
      section("agent-profile", "Profile", [
        field("Display name", agent.displayName),
        field("Handle", `@${agent.name}`),
        field("Agent Profile Prompt", agent.description || "Not set")
      ], canManage ? ["Save Profile", "Discard"] : []),
      section("agent-runtime", "Runtime", [
        field("Status", agentStatusLabel(agent.status)),
        field("Runtime", agent.runtime ? runtimeDisplayName(agent.runtime) : "No runtime"),
        field("Model", agent.model || "Default"),
        field("Reasoning", agent.reasoningEffort ?? "Default"),
        field("Runtime access", permissionModeTitle(agent.permissionMode ?? DEFAULT_RUNTIME_PERMISSION_MODE)),
        field("Device", machineSummary.title),
        field("Runtime summary", agentRuntimeSummary(agent)),
        field("Workspace", agent.workspacePath || "No workspace attached"),
        field("Owner", ownerLabel)
      ]),
      section("agent-permissions", "Tyr capabilities", [
        field("Authorization", "Independent from Runtime Access"),
        field("Management", canManage ? "Editable" : "Owner only")
      ], canManage ? ["Save permissions", "Use default"] : []),
      ...(canManage && existingGrants.length > 0 ? [section("agent-sharing", "Existing Access", [
        field("Active grants", existingGrants.length),
        field("Grantees", existingGrants.map((grant) => `${grant.granteeDisplayName} (${grant.scopes.join(", ")})`).join(", "))
      ])] : []),
      section("agent-lifecycle", "Lifecycle", [
        field("Status", agentStatusLabel(agent.status)),
        field("Device status", machine ? liveStatusLabel(machine.status) : "Missing")
      ], canManage ? [agent.status === "offline" ? "Start Agent" : "Stop Agent", "Restart Agent", "Delete Agent"] : [], true),
      section("agent-reminders", "Reminders", [
        field("Scheduled", snapshot.reminders.filter((item) => item.ownerAgentId === agent.id).length)
      ]),
      section("agent-workspace", "Workspace", [
        field("Path", agent.workspacePath || "No workspace attached")
      ], canManage ? ["Refresh files"] : []),
      section("agent-activity", "Agent History", [
        field("Ledger", "Messages, delegations, executions, and runtime events")
      ]),
      section("agent-skills", "Skills", [
        field("Source", "Runtime detected skills")
      ], canManage ? ["Refresh"] : [])
    ]
  };
}

function humanInspectorModel(human: UserRecord, snapshot: AppSnapshot, row: Extract<TopologyRow, { kind: "human" }>, _memberInvites: ServerInviteRecord[]): TopologyInspectorModel {
  const currentUserServerRole = snapshot.currentServer?.role ?? "member";
  const profile = fallbackHumanProfile(human, snapshot.currentUser, currentUserServerRole);
  const facts = humanProfileFacts(profile);
  const roleActions = humanRoleActionState(profile, snapshot.currentUser, snapshot.currentServer);
  const relatedGrants = snapshot.resourceGrantSummaries.filter((grant) => grant.granteeUserId === human.id);

  return {
    badge: row.shared ? "SHARED HUMAN" : "HUMAN CONFIG",
    title: human.displayName,
    subtitle: human.email ?? `@${human.name}`,
    tone: "human",
    sections: [
      section("human-profile", "Profile", [
        field("Name", human.name),
        field("Display name", human.displayName),
        field("Email", human.email ?? "No email"),
        field("Role", memberRoleLabel(humanServerRole(human, snapshot.currentUser, currentUserServerRole))),
        ...facts.map(([label, value]) => field(label, value))
      ]),
      section("human-description", "Description", [
        field("Description", human.description || "No description")
      ], human.id === snapshot.currentUser.id ? ["Edit description"] : []),
      section("human-role-access", "Workspace membership", [
        field("Role", memberRoleLabel(humanServerRole(human, snapshot.currentUser, currentUserServerRole))),
        field("Membership", profile.membershipStatus),
        field("Visibility", human.membershipVisible === false ? "Limited" : "Visible")
      ], roleActions.canRemove ? ["Remove member"] : []),
      section("human-created-agents", "Created agents", [
        field("Total", snapshot.agents.filter((agent) => agent.ownerUserId === human.id).length)
      ]),
      section("human-granted-resources", "Resource access", [
        field("Resource grants", relatedGrants.length),
        field("Grant placement", row.grantSummary ? `${row.grantSummary.resourceType} · ${row.grantSummary.scopes.join(", ")}` : "Workspace membership")
      ])
    ]
  };
}

function sharedZoneInspectorModel(snapshot: AppSnapshot): TopologyInspectorModel {
  return {
    badge: "SHARED ACCESS",
    title: "Resources shared with this workspace",
    subtitle: "Explicit grants only · Bridge workspaces stay separate",
    tone: "shared",
    sections: [
      section("shared-zone-overview", "Shared overview", [
        field("Shared devices", snapshot.machines.filter((machine) => machine.access?.shared).length)
      ])
    ]
  };
}

function bridgeStatusLabel(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function bridgeDirectionLabel(value: string): string {
  return value === "bidirectional" ? "Two-way" : "One-way";
}

function section(id: TopologyInspectorSectionId, title: string, fields: TopologyInspectorField[], actions: string[] = [], ownerOnly = false): TopologyInspectorSectionModel {
  return { id, title, fields, actions, ownerOnly };
}

function field(label: string, value: string | number | null | undefined): TopologyInspectorField {
  return { label, value: value === null || typeof value === "undefined" || value === "" ? "None" : String(value) };
}

function humanName(snapshot: AppSnapshot, humanId: string): string {
  return snapshot.humans.find((human) => human.id === humanId)?.displayName ?? (snapshot.currentUser.id === humanId ? snapshot.currentUser.displayName : "Unknown owner");
}

function machineRuntimes(machine: MachineRecord): RuntimeReport[] {
  return (machine as MachineRecord & { runtimes?: RuntimeReport[] }).runtimes ?? [];
}

function machineAgents(machine: MachineRecord, snapshot: AppSnapshot): AgentRecord[] {
  return ((machine as MachineRecord & { agents?: AgentRecord[] }).agents ?? snapshot.agents.filter((agent) => agent.machineId === machine.id))
    .filter((agent) => !isCommunicationAgent(agent));
}

function runtimeFields(runtimes: RuntimeReport[]): TopologyInspectorField[] {
  if (runtimes.length === 0) return RUNTIMES.map((runtime) => field(runtime.displayName, "not installed"));
  return RUNTIMES.map((runtime) => {
    const report = runtimes.find((item) => item.runtime === runtime.id);
    if (!report) return field(runtime.displayName, "not installed");
    const models = report.models?.length ? ` · ${report.models.length} models` : "";
    return field(runtime.displayName, `${runtimeHealthLabel(report)}${models}`);
  });
}

function shortRuntimeSha(value: string | null | undefined): string {
  return value ? value.slice(0, 12) : "Unknown";
}

function machineRuntimeBundleStatus(machine: Pick<MachineRecord, "runtimeSha" | "latestRuntimeSha" | "runtimeUpdateAvailable">): string {
  if (machine.runtimeUpdateAvailable === true) return "Update required";
  if (!machine.runtimeSha || !machine.latestRuntimeSha) return "Unknown";
  return machine.runtimeSha === machine.latestRuntimeSha ? "Current" : "Update required";
}

function machineConnectorTokenStatus(machine: MachineRecord): string {
  if (machine.connectorTokenRevokedAt) return "Revoked";
  if (machine.connectorTokenIssuedAt) return "Issued";
  if (machine.apiKeyUsedAt) return "Bootstrap consumed";
  return "Bootstrap pending";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
