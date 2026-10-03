import { type CSSProperties, type PointerEvent as ReactPointerEvent, useState } from "react";

export const THREAD_PANEL_WIDTH_STORAGE_KEY = "tyr-thread-panel-width";
export const DEFAULT_THREAD_PANEL_WIDTH = 420;
export const MIN_THREAD_PANEL_WIDTH = 360;
export const MAX_THREAD_PANEL_WIDTH = 640;

type ThreadPanelWidthStorage = Pick<Storage, "getItem">;

export function clampThreadPanelWidth(value: number): number {
  return Math.max(MIN_THREAD_PANEL_WIDTH, Math.min(MAX_THREAD_PANEL_WIDTH, Math.round(value)));
}

export function threadPanelWidthFromDrag({ startWidth, startX, currentX }: { startWidth: number; startX: number; currentX: number }): number {
  return clampThreadPanelWidth(startWidth - (currentX - startX));
}

export function storedThreadPanelWidth(storage: ThreadPanelWidthStorage | null = typeof window === "undefined" ? null : window.localStorage): number {
  const parsed = Number(storage?.getItem(THREAD_PANEL_WIDTH_STORAGE_KEY));
  return clampThreadPanelWidth(Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THREAD_PANEL_WIDTH);
}

export function useThreadPanelResize() {
  const [width, setWidth] = useState(() => storedThreadPanelWidth());
  const workspaceStyle = { "--thread-panel-width": `${width}px` } as CSSProperties;

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    function move(moveEvent: PointerEvent) {
      const next = threadPanelWidthFromDrag({ startWidth, startX, currentX: moveEvent.clientX });
      setWidth(next);
      // Thread 详情宽度是用户视图偏好，持久化后任务页和普通 thread 共用同一手感。
      window.localStorage.setItem(THREAD_PANEL_WIDTH_STORAGE_KEY, String(next));
    }
    function stop() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  return { width, workspaceStyle, beginResize };
}
