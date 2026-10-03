import type express from "express";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";

const DEFAULT_SLOW_REQUEST_MS = 750;
const DEFAULT_EVENT_LOOP_SAMPLE_MS = 30_000;
const DEFAULT_EVENT_LOOP_WARN_MS = 1_000;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function registerApiRequestTiming(app: express.Express, options: {
  slowRequestMs?: number;
  log?: (message: string, detail: Record<string, unknown>) => void;
  info?: (message: string, detail: Record<string, unknown>) => void;
} = {}): void {
  const slowRequestMs = options.slowRequestMs ?? DEFAULT_SLOW_REQUEST_MS;
  const log = options.log ?? ((message, detail) => console.warn(message, detail));
  const info = options.info ?? ((message, detail) => console.info(message, detail));
  app.use("/api", (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const requestPath = `${req.baseUrl}${req.path}`;
    const isWorkspaceSyncStream = req.method === "GET"
      && requestPath === "/api/sync"
      && req.query.stream === "1";
    const requestedId = req.header("x-request-id")?.trim() ?? "";
    const requestId = SAFE_REQUEST_ID.test(requestedId) ? requestedId : randomUUID();
    res.setHeader("x-request-id", requestId);
    let recorded = false;

    const record = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const detail = {
        requestId,
        method: req.method,
        path: requestPath.replace(/(\/api\/workspace-bridge-invites\/)[^/]+/, "$1:redacted"),
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        aborted
      };
      if (aborted && isWorkspaceSyncStream && res.headersSent && res.statusCode < 500) {
        info("[api] stream closed", { ...detail, outcome: "stream_closed", expected: true });
        return;
      }
      if (!aborted && res.statusCode < 500 && durationMs < slowRequestMs) return;
      log(aborted ? "[api] request aborted" : "[api] slow request", detail);
    };

    res.once("finish", () => record(false));
    res.once("close", () => record(!res.writableFinished));
    next();
  });
}

export function startEventLoopLagMonitor(options: {
  sampleMs?: number;
  warnMs?: number;
  log?: (message: string, detail: Record<string, unknown>) => void;
} = {}): () => void {
  const sampleMs = options.sampleMs ?? DEFAULT_EVENT_LOOP_SAMPLE_MS;
  const warnMs = options.warnMs ?? DEFAULT_EVENT_LOOP_WARN_MS;
  const log = options.log ?? ((message, detail) => console.warn(message, detail));
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const timer = setInterval(() => {
    const maxMs = histogram.max / 1_000_000;
    const p99Ms = histogram.percentile(99) / 1_000_000;
    if (maxMs >= warnMs) {
      log("[health] event loop lag", {
        maxMs: Math.round(maxMs),
        p99Ms: Math.round(p99Ms),
        sampleMs
      });
    }
    histogram.reset();
  }, sampleMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
