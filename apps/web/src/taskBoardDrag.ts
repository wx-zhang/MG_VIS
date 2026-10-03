import type { TaskStatus } from "@tyr-ai/contracts";

export const TASK_CARD_DRAG_MIME = "application/x-tyr-ai-task-id";

export function nextTaskDropStatus(currentStatus: TaskStatus, targetStatus: TaskStatus): TaskStatus | null {
  // 拖回原列不代表状态变化，跳过 PATCH，避免制造无意义的 task 更新时间。
  return currentStatus === targetStatus ? null : targetStatus;
}

type DragImageElement = {
  closest(selector: string): DragImageElement | null;
  getBoundingClientRect(): Pick<DOMRect, "left" | "top" | "width" | "height">;
};

export function setTaskCardDragImage(dataTransfer: Pick<DataTransfer, "setDragImage"> | null | undefined, handle: DragImageElement): void {
  const card = handle.closest(".task-card");
  if (!dataTransfer || !card) return;
  const cardRect = card.getBoundingClientRect();
  const handleRect = handle.getBoundingClientRect();
  // 从 grip 开始拖拽，但 drag ghost 使用整张卡片，并保持鼠标仍落在 grip 的中心点。
  dataTransfer.setDragImage(
    card as unknown as Element,
    handleRect.left - cardRect.left + handleRect.width / 2,
    handleRect.top - cardRect.top + handleRect.height / 2
  );
}
