export type TaskThreadActionId = "claim" | "view_channel";

export type TaskThreadActionGroups = {
  primary: TaskThreadActionId[];
  secondary: TaskThreadActionId[];
  details: TaskThreadActionId[];
};

export type TaskThreadActionState = {
  assigned: boolean;
};

export function taskThreadActionGroups(state: TaskThreadActionState): TaskThreadActionGroups {
  // 任务详情只保留一次性交付入口；重试、解除认领和 Inbox 清理不再作为常规任务流程暴露。
  const primary: TaskThreadActionId[] = state.assigned ? [] : ["claim"];
  return { primary, secondary: ["view_channel"], details: [] };
}
