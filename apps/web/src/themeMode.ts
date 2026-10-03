export type ThemeMode = "light" | "dark";

export const THEME_MODE_STORAGE_KEY = "tyr-theme-mode";

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "dark" ? "dark" : "light";
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === "dark" ? "light" : "dark";
}

export function readThemeMode(storage: Pick<Storage, "getItem"> | null | undefined = typeof window === "undefined" ? undefined : window.localStorage): ThemeMode {
  return normalizeThemeMode(storage?.getItem(THEME_MODE_STORAGE_KEY));
}

export function persistThemeMode(mode: ThemeMode, storage: Pick<Storage, "setItem"> | null | undefined = typeof window === "undefined" ? undefined : window.localStorage): void {
  storage?.setItem(THEME_MODE_STORAGE_KEY, mode);
}

export function applyThemeMode(mode: ThemeMode, root: Pick<DOMTokenList, "toggle"> | undefined = typeof document === "undefined" ? undefined : document.documentElement.classList): void {
  root?.toggle("dark", mode === "dark");
}

export function applyStoredThemeMode(
  storage: Pick<Storage, "getItem"> | null | undefined = undefined,
  root: Pick<DOMTokenList, "toggle"> | undefined = typeof document === "undefined" ? undefined : document.documentElement.classList
): ThemeMode {
  // 刷新首屏可能先展示 workspace loading；这里在 React 渲染前恢复 html.dark。
  let mode: ThemeMode = "light";
  try {
    const themeStorage = storage === undefined && typeof window !== "undefined" ? window.localStorage : storage;
    mode = readThemeMode(themeStorage);
  } catch {
    mode = "light";
  }
  applyThemeMode(mode, root);
  return mode;
}
