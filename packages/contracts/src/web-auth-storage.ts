/** Browser storage is shared by origin, so each deployed app path needs its own session keys. */
export function webAuthStorageKeys(basePath: string): { accessToken: string; refreshToken: string } {
  const pathname = new URL(basePath, "https://tyr.invalid").pathname.replace(/\/+$/, "") || "/";
  const prefix = `tyr-auth:${encodeURIComponent(pathname)}`;
  return { accessToken: `${prefix}:access-token`, refreshToken: `${prefix}:refresh-token` };
}
