import { webAuthStorageKeys } from "@tyr-ai/contracts";

// 不回读旧的全站共享 key：它可能属于同域下另一套部署，且会被旧标签页清除。
const storageKeys = webAuthStorageKeys(import.meta.env?.BASE_URL || "/");
const ACCESS_TOKEN_KEY = storageKeys.accessToken;
const REFRESH_TOKEN_KEY = storageKeys.refreshToken;
let authContextRevision = 0;
const authTokenChangeListeners = new Set<(accessToken: string | null) => void>();

export type AuthContextSnapshot = {
  accessToken: string | null;
  refreshToken: string | null;
  revision: number;
};

export function isAuthStorageKey(key: string | null): boolean {
  return key === null || key === ACCESS_TOKEN_KEY || key === REFRESH_TOKEN_KEY;
}

export function captureAuthContext(): AuthContextSnapshot {
  return {
    accessToken: getAccessToken(),
    refreshToken: getRefreshToken(),
    revision: authContextRevision
  };
}

export function isCurrentAuthContext(context: AuthContextSnapshot): boolean {
  return context.revision === authContextRevision
    && context.accessToken === getAccessToken()
    && context.refreshToken === getRefreshToken();
}

export function invalidateAuthContext(): void {
  authContextRevision += 1;
}

export function subscribeAuthTokenChanges(listener: (accessToken: string | null) => void): () => void {
  authTokenChangeListeners.add(listener);
  return () => authTokenChangeListeners.delete(listener);
}

function notifyAuthTokenChanges(accessToken: string | null): void {
  // 同一页面不会收到浏览器 storage 事件；显式通知让长连接立即换用自动刷新的 token。
  for (const listener of authTokenChangeListeners) listener(accessToken);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setAuthTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  invalidateAuthContext();
  notifyAuthTokenChanges(accessToken);
}

export function clearAuthTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  invalidateAuthContext();
  notifyAuthTokenChanges(null);
}
