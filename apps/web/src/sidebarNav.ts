import type { WorkspaceView } from "./routing";

export type PrimarySidebarItemId = "topology" | "workspace" | "devices" | "invitations" | "settings";

export type PrimarySidebarCounts = {
  topologyCount?: number;
  deviceCount: number;
  invitationCount: number;
};

export type PrimarySidebarItem = {
  id: PrimarySidebarItemId;
  label: string;
  path: string;
  count?: number;
  active: boolean;
};

const topologyFamily = new Set<WorkspaceView>(["topology", "chat", "search", "inbox", "saved"]);

export type SidebarNavigationLayoutEntry =
  | { kind: "item"; item: PrimarySidebarItem }
  | { kind: "topology-tree" };

export function primarySidebarItems(view: WorkspaceView, counts: PrimarySidebarCounts): PrimarySidebarItem[] {
  return [
    view === "workspace" ? {
      id: "workspace",
      label: "Workspace View",
      path: "/workspace",
      count: counts.topologyCount,
      active: true
    } : {
      id: "topology",
      label: "Topology Grid",
      path: "/topology",
      count: counts.topologyCount,
      active: topologyFamily.has(view)
    },
    {
      id: "devices",
      label: "Mobile Devices",
      path: "/devices",
      count: counts.deviceCount,
      active: view === "devices"
    },
    {
      id: "invitations",
      label: "Workspace Connections",
      path: "/invitations",
      count: counts.invitationCount,
      active: view === "invitations"
    },
    {
      id: "settings",
      label: "Settings",
      path: "/settings/profile",
      active: view === "settings"
    }
  ];
}

export function sidebarNavigationLayout(view: WorkspaceView, counts: PrimarySidebarCounts): SidebarNavigationLayoutEntry[] {
  const items = primarySidebarItems(view, counts);
  const layout: SidebarNavigationLayoutEntry[] = [];
  for (const item of items) {
    layout.push({ kind: "item", item });
    if (item.id === "topology" || item.id === "workspace") layout.push({ kind: "topology-tree" });
  }

  return layout;
}
