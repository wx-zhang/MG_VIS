export function shouldCloseContextMenuForPointerTarget(menu: Pick<Node, "contains"> | null, target: EventTarget | null): boolean {
  if (!menu) return false;
  return !(target instanceof Node) || !menu.contains(target);
}

export function shouldCloseContextMenuForKey(key: string): boolean {
  return key === "Escape";
}

export function clampContextMenuPosition(input: {
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}): { x: number; y: number } {
  const padding = input.padding ?? 8;
  const maxX = Math.max(padding, input.viewportWidth - input.menuWidth - padding);
  const maxY = Math.max(padding, input.viewportHeight - input.menuHeight - padding);
  return {
    x: Math.min(Math.max(input.x, padding), maxX),
    y: Math.min(Math.max(input.y, padding), maxY)
  };
}
