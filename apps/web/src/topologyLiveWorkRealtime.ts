import { useEffect, useRef, useState } from "react";
import type { TopologyLiveWorkPayload } from "@tyr-ai/contracts";
import { api } from "./lib/api";
import {
  createTopologyLiveWorkPlaybackState,
  nextTopologyLiveWorkPlaybackExpiry,
  pruneTopologyLiveWorkPlayback,
  resetTopologyLiveWorkPlaybackState,
  topologyLiveWorkPayloadEqual,
  topologyLiveWorkPayloadForPlayback,
  type TopologyLiveWorkPlaybackPayload
} from "./topologyLiveWorkPlayback";

const TOPOLOGY_LIVE_WORK_POLL_MS = 15_000;
const listeners = new Set<() => void>();

const EMPTY_TOPOLOGY_LIVE_WORK: TopologyLiveWorkPayload = {
  executions: [],
  flows: [],
  activities: [],
  bridgeMessages: [],
  bridgeJourneys: [],
  truncated: false
};

export function notifyTopologyLiveWorkChanged(): void {
  for (const listener of listeners) listener();
}

function subscribeTopologyLiveWorkChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTopologyLiveWork(input: {
  enabled: boolean;
  serverId?: string;
  refreshKey: string;
}): TopologyLiveWorkPlaybackPayload {
  const [payload, setPayload] = useState<TopologyLiveWorkPlaybackPayload>(EMPTY_TOPOLOGY_LIVE_WORK);
  const playbackStateRef = useRef(createTopologyLiveWorkPlaybackState());

  useEffect(() => {
    resetTopologyLiveWorkPlaybackState(playbackStateRef.current);
    setPayload(EMPTY_TOPOLOGY_LIVE_WORK);
  }, [input.serverId]);

  useEffect(() => {
    if (!input.enabled || !input.serverId) return;
    let active = true;
    let loading = false;
    let queued = false;
    let debounceTimer: number | null = null;
    let transientCleanupTimer: number | null = null;
    let pollTimer: number | null = null;
    let visibilityRefreshPending = false;

    const documentIsHidden = () => document.visibilityState === "hidden";

    const pruneExpiredTransientPlayback = () => {
      const cleanupAt = Date.now();
      setPayload((current) => {
        const next = pruneTopologyLiveWorkPlayback(playbackStateRef.current, current, cleanupAt);
        return topologyLiveWorkPayloadEqual(current, next) ? current : next;
      });
    };

    const scheduleTransientCleanup = () => {
      if (transientCleanupTimer !== null) window.clearTimeout(transientCleanupTimer);
      if (documentIsHidden()) return;
      const now = Date.now();
      const nextExpiry = nextTopologyLiveWorkPlaybackExpiry(playbackStateRef.current, now);
      if (nextExpiry === null) return;
      transientCleanupTimer = window.setTimeout(() => {
        transientCleanupTimer = null;
        pruneExpiredTransientPlayback();
        scheduleTransientCleanup();
      }, Math.max(0, nextExpiry - now + 20));
    };

    const applyPayload = (nextPayload: TopologyLiveWorkPayload) => {
      // 旧 effect 的迟到响应不能抢先标记一次性终态，否则新订阅会误以为动画已经播放。
      if (!active) return;
      const now = Date.now();
      const next = topologyLiveWorkPayloadForPlayback(playbackStateRef.current, nextPayload, now);
      // 相同轮询结果复用旧引用，避免 15 秒兜底读取触发整个 Topology / Workspace Canvas 重算。
      setPayload((current) => topologyLiveWorkPayloadEqual(current, next) ? current : next);
      scheduleTransientCleanup();
    };

    const load = async () => {
      if (documentIsHidden()) {
        visibilityRefreshPending = true;
        return;
      }
      if (loading) {
        queued = true;
        return;
      }
      loading = true;
      try {
        applyPayload(await api<TopologyLiveWorkPayload>("/api/topology/live-work", { label: "Topology live work" }));
      } catch {
        // 通信流是增强投影；读取失败时保留已有场景，15 秒兜底轮询会继续恢复。
      } finally {
        loading = false;
        if (queued && active) {
          queued = false;
          void load();
        }
      }
    };

    const requestImmediateLoad = () => {
      if (documentIsHidden()) {
        visibilityRefreshPending = true;
        return;
      }
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void load();
      }, 80);
    };

    const startPoll = () => {
      if (pollTimer !== null || documentIsHidden()) return;
      pollTimer = window.setInterval(() => void load(), TOPOLOGY_LIVE_WORK_POLL_MS);
    };

    const handleVisibilityChange = () => {
      if (documentIsHidden()) {
        visibilityRefreshPending = true;
        if (debounceTimer !== null) window.clearTimeout(debounceTimer);
        debounceTimer = null;
        if (transientCleanupTimer !== null) window.clearTimeout(transientCleanupTimer);
        transientCleanupTimer = null;
        if (pollTimer !== null) window.clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      // 终态按墙钟过期；后台期间不跑 timer，恢复时一次清理且不重新播放已消费 ID。
      pruneExpiredTransientPlayback();
      scheduleTransientCleanup();
      startPoll();
      if (visibilityRefreshPending) visibilityRefreshPending = false;
      void load();
    };

    void load();
    const unsubscribe = subscribeTopologyLiveWorkChanged(requestImmediateLoad);
    startPoll();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      if (transientCleanupTimer !== null) window.clearTimeout(transientCleanupTimer);
    };
  }, [input.enabled, input.refreshKey, input.serverId]);

  return payload;
}
