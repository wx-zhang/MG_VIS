let fallbackRequestSequence = 0;

export function workspaceBridgeClientRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // 局域网 HTTP 页面不是安全上下文，Web Crypto 可能完全不可用；仍需生成稳定长度的客户端幂等键。
  fallbackRequestSequence = (fallbackRequestSequence + 1) % 0x1000000;
  const timestamp = Date.now().toString(36);
  const sequence = fallbackRequestSequence.toString(36).padStart(5, "0");
  const entropy = Math.floor(Math.random() * 0x100000000).toString(36).padStart(7, "0");
  return `bridge-${timestamp}-${sequence}-${entropy}`;
}
