import type { PlatformOperatorCityOverviewPayload } from "@tyr-ai/contracts";

type CityWorkspace = PlatformOperatorCityOverviewPayload["workspaces"][number];
export type OperatorCityWorkspaceState = "offline" | "attention" | "active" | "online";

export function operatorCityWorkspaceState(workspace: CityWorkspace): OperatorCityWorkspaceState {
  // 颜色只表示运营状态，不为不同 Workspace 指定永久身份色；审批提示优先展示。
  if (workspace.waitingApprovals > 0) return "attention";
  if (workspace.devicesOnline === 0) return "offline";
  if (workspace.activeExecutions > 0) return "active";
  return "online";
}

export const OPERATOR_CITY_STATE_TONE: Record<OperatorCityWorkspaceState, string> = {
  offline: "#8499a4",
  attention: "#c28d4b",
  active: "#43a9bb",
  online: "#168d84"
};
