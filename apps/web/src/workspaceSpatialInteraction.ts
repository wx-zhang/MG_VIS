import type {
  WorkspaceSpatialScene,
  WorkspaceSpatialWorkspace
} from "./workspaceSpatial";

export type WorkspaceSpatialSelection =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "room"; workspaceId: string; id: string }
  | { kind: "agent"; workspaceId: string; roomId?: string; id: string }
  | { kind: "flow"; workspaceId: string; executionId: string }
  | { kind: "bridge"; id: string };

export type WorkspaceSpatialNavigationGroup = "Workspaces" | "Devices" | "Agents" | "Bridges";

export type WorkspaceSpatialNavigationItem = {
  key: string;
  group: WorkspaceSpatialNavigationGroup;
  label: string;
  searchText?: string;
  selection: Exclude<WorkspaceSpatialSelection, { kind: "flow" }>;
};

export const WORKSPACE_SPATIAL_NAVIGATION_GROUPS: WorkspaceSpatialNavigationGroup[] = [
  "Workspaces",
  "Devices",
  "Agents",
  "Bridges"
];

export function workspaceSpatialSelectionKey(selection: WorkspaceSpatialSelection | null): string | null {
  if (!selection) return null;
  if (selection.kind === "bridge") return `bridge:${selection.id}`;
  if (selection.kind === "workspace") return `workspace:${selection.workspaceId}`;
  if (selection.kind === "room") return `room:${selection.workspaceId}:${selection.id}`;
  if (selection.kind === "flow") return `flow:${selection.workspaceId}:${selection.executionId}`;
  // Agent id 不能脱离 Workspace 使用；Bridge 对端可能存在相同 runtime id。
  return `agent:${selection.workspaceId}:${selection.id}`;
}

function navigationItemsForWorkspace(workspace: WorkspaceSpatialWorkspace): WorkspaceSpatialNavigationItem[] {
  const workspaceRole = workspace.current ? "Current Workspace" : "Peer Workspace";
  const items: WorkspaceSpatialNavigationItem[] = [{
    key: workspaceSpatialSelectionKey({ kind: "workspace", workspaceId: workspace.id })!,
    group: "Workspaces",
    label: `${workspaceRole} · ${workspace.name}`,
    selection: { kind: "workspace", workspaceId: workspace.id }
  }];

  for (const controller of workspace.controllers) {
    const selection = { kind: "agent", workspaceId: workspace.id, id: controller.id } as const;
    items.push({
      key: workspaceSpatialSelectionKey(selection)!,
      group: "Agents",
      label: `TYR · ${workspace.name}`,
      // Keep the compact scene label while allowing operators to find the
      // provisioned identity (for example `bank.tyr`) and its display name.
      searchText: `${controller.name} ${controller.displayName} TYR ${workspace.name}`,
      selection
    });
  }

  for (const room of workspace.rooms) {
    const roomSelection = { kind: "room", workspaceId: workspace.id, id: room.id } as const;
    items.push({
      key: workspaceSpatialSelectionKey(roomSelection)!,
      group: "Devices",
      label: `${room.name} · ${workspace.name}`,
      selection: roomSelection
    });
    // 聚合隐藏 Agent 没有独立人物，键盘导航也不得为其虚构可交互对象。
    for (const agent of room.visibleAgents) {
      const agentSelection = { kind: "agent", workspaceId: workspace.id, roomId: room.id, id: agent.id } as const;
      items.push({
        key: workspaceSpatialSelectionKey(agentSelection)!,
        group: "Agents",
        label: `${agent.displayName} · ${room.name}`,
        selection: agentSelection
      });
    }
  }
  return items;
}

export function workspaceSpatialNavigationItems(scene: WorkspaceSpatialScene): WorkspaceSpatialNavigationItem[] {
  const workspaces = [scene.current, ...scene.peers];
  const items = workspaces.flatMap(navigationItemsForWorkspace);
  for (const bridge of scene.bridges) {
    const selection = { kind: "bridge", id: bridge.id } as const;
    items.push({
      key: workspaceSpatialSelectionKey(selection)!,
      group: "Bridges",
      label: `${scene.current.name} ↔ ${bridge.peerWorkspaceName}`,
      selection
    });
  }
  const labelCounts = new Map<string, number>();
  for (const item of items) {
    const labelKey = `${item.group}:${item.label}`;
    labelCounts.set(labelKey, (labelCounts.get(labelKey) ?? 0) + 1);
  }
  return items.map((item) => {
    if ((labelCounts.get(`${item.group}:${item.label}`) ?? 0) <= 1) return item;
    // 同名 Device / Agent 在高密度环境很常见；仅冲突时追加稳定短码，避免键盘菜单出现不可区分选项。
    return { ...item, label: `${item.label} · ${item.key.slice(-6)}` };
  });
}
