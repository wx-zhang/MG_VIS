import type { IncomingHttpHeaders } from "node:http";

export type DaemonCredentialTransport = "header" | "query" | "both" | "none";

export type DaemonCredentialResolution =
  | { ok: true; credential: string; transport: Exclude<DaemonCredentialTransport, "none"> }
  | { ok: false; transport: DaemonCredentialTransport; reason: "missing" | "invalid_authorization" | "ambiguous_query" | "credential_mismatch" };

function bearerCredential(value: string | string[] | undefined): { present: boolean; credential: string | null } {
  if (value === undefined) return { present: false, credential: null };
  if (Array.isArray(value) || !/^Bearer [^\s]+$/.test(value)) return { present: true, credential: null };
  return { present: true, credential: value.slice("Bearer ".length) };
}

export function resolveDaemonUpgradeCredential(input: {
  headers: IncomingHttpHeaders;
  requestUrl: string;
  baseUrl: string;
}): DaemonCredentialResolution {
  const header = bearerCredential(input.headers.authorization);
  let url: URL;
  try {
    url = new URL(input.requestUrl, input.baseUrl);
  } catch {
    return { ok: false, transport: header.present ? "header" : "none", reason: "missing" };
  }
  const queryValues = ["token", "key", "apiKey"].flatMap((key) => url.searchParams.getAll(key))
    .filter((value): value is string => Boolean(value));
  const distinctQueryValues = new Set(queryValues);
  const hasQuery = queryValues.length > 0;
  const transport: DaemonCredentialTransport = header.present ? (hasQuery ? "both" : "header") : (hasQuery ? "query" : "none");
  if (header.present && !header.credential) return { ok: false, transport, reason: "invalid_authorization" };
  if (distinctQueryValues.size > 1) return { ok: false, transport, reason: "ambiguous_query" };
  const queryCredential = queryValues[0] ?? null;
  if (header.credential && queryCredential && header.credential !== queryCredential) {
    // Header/query 冲突时拒绝，避免代理或旧客户端把两个身份静默混用。
    return { ok: false, transport, reason: "credential_mismatch" };
  }
  const credential = header.credential ?? queryCredential;
  if (!credential) return { ok: false, transport, reason: "missing" };
  return { ok: true, credential, transport: transport as Exclude<DaemonCredentialTransport, "none"> };
}
