import { useCallback, useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { MachineRecord, RuntimeId, RuntimeModel, RuntimeReport } from "@tyr-ai/contracts";
import { api, ApiError, apiErrorMessage } from "../lib/api";
import { SelectControl } from "./ui";
import "./AgentModelSelect.css";

export type RuntimeModelCatalog = { models: RuntimeModel[]; default?: string };
export type DetectRuntimeModels = (machineId: string, runtime: RuntimeId, signal: AbortSignal) => Promise<RuntimeModelCatalog>;

const detectRuntimeModels: DetectRuntimeModels = (machineId, runtime, signal) => api(
  `/api/machines/${encodeURIComponent(machineId)}/runtimes/${runtime}/models/detect`,
  { method: "POST", signal }
);

function detectionError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "daemon_offline") return "The device is offline. Reconnect it and refresh models.";
    if (error.code === "runtime_models_timeout") return "Model detection timed out. Please refresh models to try again.";
    if (error.code === "runtime_models_unavailable") return "No model list was returned. Check the runtime sign-in and refresh models.";
  }
  return apiErrorMessage(error, "Could not load models. Please try again.");
}

export function AgentModelSelect({ machine, runtime, report, canManage, value, onChange, detectModels = detectRuntimeModels, className }: {
  machine?: Pick<MachineRecord, "id" | "status">;
  runtime?: RuntimeId | null;
  report?: RuntimeReport;
  canManage: boolean;
  value: string;
  onChange: (model: string) => void;
  detectModels?: DetectRuntimeModels;
  className?: string;
}) {
  const labelId = useId();
  const hintId = useId();
  const machineId = machine?.id;
  const key = `${machineId ?? ""}:${runtime ?? ""}`;
  const canDetect = Boolean(canManage && machineId && machine?.status === "online" && runtime && report?.status === "available");
  const [catalog, setCatalog] = useState<{ key: string; models: RuntimeModel[] } | null>(null);
  const [request, setRequest] = useState({ key: "", loading: false, error: "" });
  const activeRequest = useRef<AbortController | null>(null);
  const detector = useRef(detectModels);
  detector.current = detectModels;

  const refreshModels = useCallback(async () => {
    if (!canDetect || !machineId || !runtime) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setRequest({ key, loading: true, error: "" });
    try {
      const result = await detector.current(machineId, runtime, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.models.length) throw new ApiError({ code: "runtime_models_unavailable" });
      setCatalog({ key, models: result.models });
      setRequest({ key, loading: false, error: "" });
    } catch (error) {
      if (!controller.signal.aborted) setRequest({ key, loading: false, error: detectionError(error) });
    }
  }, [canDetect, key, machineId, runtime]);

  useEffect(() => {
    // Recheck on opening the profile or reconnecting; discovery never changes the selected model.
    void refreshModels();
    return () => activeRequest.current?.abort();
  }, [refreshModels]);

  const models = catalog?.key === key ? catalog.models : report?.models ?? [];
  const loading = canDetect && request.key === key && request.loading;
  const error = request.key === key ? request.error : "";
  const missingSelection = Boolean(value && !models.some((model) => model.id === value));
  const hint = !canManage ? ""
    : !machineId ? "No linked device is available."
      : machine?.status !== "online" ? "The device is offline. Reconnect it to refresh models."
        : report?.status !== "available" ? "The runtime is unavailable on this device."
          : loading ? "Loading available models…"
            : error || (models.length === 0 ? "No model list detected. Refresh models to try again." : "");

  return <div className="agent-profile-field">
    <span id={labelId}>Model</span>
    <div className="agent-model-select-row">
      <SelectControl className={className} aria-labelledby={labelId} aria-describedby={hint || missingSelection ? hintId : undefined}
        disabled={!canDetect || loading || Boolean(error)} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Default</option>
        {missingSelection && <option value={value} disabled>{value} (not in current list)</option>}
        {models.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}
      </SelectControl>
      {canManage && <button className="icon-btn subtle" type="button" disabled={!canDetect || loading}
        title="Refresh models" aria-label="Refresh models" onClick={() => void refreshModels()}><RefreshCw size={16} /></button>}
    </div>
    <div id={hintId} aria-live="polite">
      {hint && <p className={`field-hint${error && canDetect && !loading ? " error" : ""}`}>{hint}</p>}
      {!loading && missingSelection && <p className="field-hint">The selected model is not in the detected list. Your selection is kept until you choose another model.</p>}
    </div>
  </div>;
}
