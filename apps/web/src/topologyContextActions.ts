import { isCommunicationAgent, type AppSnapshot, type MachineRecord } from "@tyr-ai/contracts";
import { canManageAgentRuntimeView } from "./agentProfile";
import { agentCanOpenDm, agentIsChannelOnlyIdentity, hasBridgeFullAccess, machineCredentialControlsVisible, machineOwnerControlsVisible } from "./resourceAccess";
import type { TopologyGraphEdge, TopologyGraphNode } from "./topology";

export type TopologyContextMenuActionId =
  | "inspect"
  | "refresh-topology"
  | "fit-view"
  | "connect-computer"
  | "create-agent"
  | "start-all-agents"
  | "stop-all-agents"
  | "restart-all-agents"
  | "copy-connect-command"
  | "reset-all-agents"
  | "delete-computer"
  | "message-agent"
  | "start-agent"
  | "stop-agent"
  | "restart-agent"
  | "view-agent-activity"
  | "open-agent-workspace"
  | "reset-agent"
  | "delete-agent"
  | "copy-human-email"
  | "view-human-resource-access"
  | "remove-human"
  | "open-pinned-agent-dm"
  | "view-device-grants"
  | "delete-device"
  | "inspect-relation-source"
  | "inspect-relation-target"
  | "view-relation-grant"
  | "bulk-start-agents"
  | "bulk-stop-agents"
  | "bulk-restart-agents"
  | "bulk-message-first-agent"
  | "bulk-start-computers"
  | "bulk-stop-computers"
  | "bulk-restart-computers"
  | "clear-selection";

export type TopologyContextMenuAction = {
  id: TopologyContextMenuActionId;
  label: string;
  group?: "inspect" | "open" | "manage" | "lifecycle" | "danger";
  danger?: boolean;
  disabledReason?: string;
};

export type TopologyContextMenuTarget =
  | { kind: "pane" }
  | { kind: "node"; node: TopologyGraphNode }
  | { kind: "edge"; edge: TopologyGraphEdge; nodes: TopologyGraphNode[] }
  | { kind: "selection"; nodes: TopologyGraphNode[] };

export function topologyContextActionsForTarget(input: {
  target: TopologyContextMenuTarget;
  snapshot: AppSnapshot;
}): TopologyContextMenuAction[] {
  if (input.target.kind === "pane") return paneActions(input.snapshot);
  if (input.target.kind === "node") return nodeActions(input.target.node, input.snapshot);
  if (input.target.kind === "edge") return edgeActions(input.target.edge, input.target.nodes);
  return selectionActions(input.target.nodes, input.snapshot);
}

function paneActions(snapshot: AppSnapshot): TopologyContextMenuAction[] {
  const actions: TopologyContextMenuAction[] = [
    action("refresh-topology", "Refresh topology", "open"),
    action("fit-view", "Fit to view", "open"),
    action("connect-computer", "Connect Device", "manage")
  ];
  if (snapshot.machines.some((machine) => machineOwnerControlsVisible(machine, snapshot.currentUser.id))) {
    actions.push(action("create-agent", "Create Agent", "manage"));
  }
  return actions;
}

function nodeActions(node: TopologyGraphNode, snapshot: AppSnapshot): TopologyContextMenuAction[] {
  if (node.kind === "server") return serverActions(snapshot);
  const row = node.row;
  if (!row) return [action("inspect", "Inspect", "inspect")];
  if (row.kind === "machine") return machineActions(row.machine, snapshot);
  if (row.kind === "agent") return agentActions(row.agent, snapshot);
  if (row.kind === "channel") return [];
  if (row.kind === "human") return humanActions(row.human.id, row.human.email, snapshot);
  if (row.kind === "device") return deviceActions(row.device.id, row.device.ownerUserId, snapshot);
  return [action("inspect", "Inspect", "inspect")];
}

function serverActions(snapshot: AppSnapshot): TopologyContextMenuAction[] {
  const actions = [
    action("inspect", "Inspect workspace", "inspect"),
    action("refresh-topology", "Refresh topology", "open"),
    action("fit-view", "Fit to view", "open"),
    action("connect-computer", "Connect Device", "manage")
  ];
  return actions;
}

function machineActions(machine: MachineRecord, snapshot: AppSnapshot): TopologyContextMenuAction[] {
  const actions = [action("inspect", "Inspect Device", "inspect")];
  if (!machineOwnerControlsVisible(machine, snapshot.currentUser.id)) return actions;
  return [
    ...actions,
    action("create-agent", "Create Agent", "manage"),
    action("start-all-agents", "Start all agents", "lifecycle"),
    action("stop-all-agents", "Stop all agents", "lifecycle"),
    action("restart-all-agents", "Restart all agents", "lifecycle"),
    ...(machineCredentialControlsVisible(machine, snapshot.currentUser.id) ? [action("copy-connect-command", "Copy connect command", "manage")] : []),
    action("reset-all-agents", "Reset all agents", "danger", true),
    action("delete-computer", "Delete Device", "danger", true)
  ];
}

function agentActions(agent: AppSnapshot["agents"][number], snapshot: AppSnapshot): TopologyContextMenuAction[] {
  const machine = agent.machineId ? snapshot.machines.find((item) => item.id === agent.machineId) : undefined;
  const canManage = canManageAgentRuntimeView(agent, machine, snapshot.currentUser.id);
  const actions = [action("inspect", "Inspect Agent", "inspect")];
  if (agentCanOpenDm(agent, snapshot.currentUser.id)) actions.push(action("message-agent", "Message Agent", "open"));
  if (!canManage) {
    actions.push(action("view-agent-activity", "View History", "open"));
    return actions;
  }
  actions.push(
    agent.status === "offline"
      ? action("start-agent", "Start Agent", "lifecycle")
      : action("stop-agent", "Stop Agent", "lifecycle"),
    action("restart-agent", "Restart Agent", "lifecycle"),
    action("view-agent-activity", "View History", "open"),
    action("open-agent-workspace", "Open Workspace", "open"),
    action("reset-agent", "Reset Agent", "danger", true),
    action("delete-agent", "Delete Agent", "danger", true)
  );
  return actions;
}

function humanActions(humanId: string, email: string | null | undefined, snapshot: AppSnapshot): TopologyContextMenuAction[] {
  const actions = [action("inspect", "Inspect Human", "inspect")];
  if (email) actions.push(action("copy-human-email", "Copy email", "open"));
  actions.push(action("view-human-resource-access", "View resource access", "open"));
  if (canManageServer(snapshot) && humanId !== snapshot.currentUser.id) {
    actions.push(action("remove-human", "Remove from workspace", "danger", true));
  }
  return actions;
}

function deviceActions(_deviceId: string, ownerUserId: string, snapshot: AppSnapshot): TopologyContextMenuAction[] {
  const actions = [
    action("inspect", "Inspect Mobile Device", "inspect"),
    action("open-pinned-agent-dm", "Open pinned Agent DM", "open"),
    action("view-device-grants", "View mobile device grants", "open")
  ];
  const device = snapshot.devices.find((item) => item.id === _deviceId);
  if (hasBridgeFullAccess(device) || ownerUserId === snapshot.currentUser.id || canManageServer(snapshot)) actions.push(action("delete-device", "Delete mobile device", "danger", true));
  return actions;
}

function edgeActions(edge: TopologyGraphEdge, nodes: TopologyGraphNode[]): TopologyContextMenuAction[] {
  const sourceNode = nodes.find((node) => node.id === edge.source);
  const targetNode = nodes.find((node) => node.id === edge.target);
  const actions = [
    action("inspect-relation-source", sourceNode ? `Inspect ${sourceNode.label}` : "Inspect source", "inspect"),
    action("inspect-relation-target", targetNode ? `Inspect ${targetNode.label}` : "Inspect target", "inspect")
  ];
  if (edge.kind.includes("shared")) actions.push(action("view-relation-grant", "View access grant", "open"));
  return actions;
}

function selectionActions(nodes: TopologyGraphNode[], snapshot: AppSnapshot): TopologyContextMenuAction[] {
  const rows = nodes.map((node) => node.row).filter(Boolean);
  if (rows.length === 0) return [action("clear-selection", "Clear selection", "open")];

  const agentRows = rows.filter((row) => row?.kind === "agent");
  if (agentRows.length === rows.length && agentRows.every((row) => row?.kind === "agent" && canManageAgentForBulk(row.agent, snapshot))) {
    return [
      action("bulk-start-agents", "Start selected agents", "lifecycle"),
      action("bulk-stop-agents", "Stop selected agents", "lifecycle"),
      action("bulk-restart-agents", "Restart selected agents", "lifecycle"),
      action("bulk-message-first-agent", "Message first selected agent", "open"),
      action("clear-selection", "Clear selection", "open")
    ];
  }

  const machineRows = rows.filter((row) => row?.kind === "machine");
  if (machineRows.length === rows.length && machineRows.every((row) => row?.kind === "machine" && machineOwnerControlsVisible(row.machine, snapshot.currentUser.id))) {
    return [
      action("bulk-start-computers", "Start agents on selected devices", "lifecycle"),
      action("bulk-stop-computers", "Stop agents on selected devices", "lifecycle"),
      action("bulk-restart-computers", "Restart agents on selected devices", "lifecycle"),
      action("clear-selection", "Clear selection", "open")
    ];
  }

  return [action("clear-selection", "Clear selection", "open")];
}

function canManageAgentForBulk(agent: AppSnapshot["agents"][number], snapshot: AppSnapshot): boolean {
  if (agentIsChannelOnlyIdentity(agent) || isCommunicationAgent(agent)) return false;
  const machine = agent.machineId ? snapshot.machines.find((item) => item.id === agent.machineId) : undefined;
  return canManageAgentRuntimeView(agent, machine, snapshot.currentUser.id);
}

function canManageServer(snapshot: AppSnapshot): boolean {
  return Boolean(snapshot.currentServer?.role === "owner" || snapshot.currentServer?.ownerId === snapshot.currentUser.id);
}

function action(id: TopologyContextMenuActionId, label: string, group: TopologyContextMenuAction["group"], danger = false, disabledReason?: string): TopologyContextMenuAction {
  return { id, label, group, danger: danger || undefined, disabledReason };
}
