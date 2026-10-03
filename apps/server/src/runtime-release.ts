import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

const shaPattern = /^(?:sha256:)?([0-9a-f]{64})(?:\s+.*)?$/i;

export function normalizeRuntimeSha(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const match = shaPattern.exec(trimmed);
  return match?.[1]?.toLowerCase();
}

export function createLatestRuntimeShaResolver(input: { rootDir: string; env?: Record<string, string | undefined> }): () => string | undefined {
  return () => {
    const configured = normalizeRuntimeSha(input.env?.TYR_DAEMON_RUNTIME_SHA);
    if (configured) return configured;
    for (const relativePath of [
      "apps/web/public/downloads/tyr-ai-daemon-source.tar.gz.sha256",
      "apps/web/dist/downloads/tyr-ai-daemon-source.tar.gz.sha256"
    ]) {
      const markerPath = path.join(input.rootDir, relativePath);
      if (!existsSync(markerPath)) continue;
      const fromFile = normalizeRuntimeSha(readFileSync(markerPath, "utf8"));
      if (fromFile) return fromFile;
    }
    return undefined;
  };
}

export function runtimeUpdateAvailable(runtimeSha: string | undefined, latestRuntimeSha: string | undefined): boolean {
  // Only known mismatches are actionable; missing hashes mean the daemon or release marker has not reported enough evidence.
  return Boolean(runtimeSha && latestRuntimeSha && runtimeSha.toLowerCase() !== latestRuntimeSha.toLowerCase());
}

export function withLatestRuntimeSha<T extends object>(payload: T, latestRuntimeSha: string | undefined): T {
  const machines = (payload as { machines?: unknown }).machines;
  if (!Array.isArray(machines)) return payload;
  return {
    ...payload,
    machines: machines.map((machine) => {
      const runtimeSha = typeof (machine as { runtimeSha?: unknown }).runtimeSha === "string"
        ? (machine as { runtimeSha?: string }).runtimeSha
        : undefined;
      return {
        ...machine,
        latestRuntimeSha,
        runtimeUpdateAvailable: runtimeUpdateAvailable(runtimeSha, latestRuntimeSha)
      };
    })
  };
}
