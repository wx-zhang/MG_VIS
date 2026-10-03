import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { AppSnapshot, PlatformOperatorExecutionViewPayload } from "@tyr-ai/contracts";

import { api, apiErrorMessage } from "../lib/api";
import { isOperatorAuditCancelled, type OperatorAuditMetadata } from "../operatorAudit";
import { safetyReviewForContext } from "../safetyView";
import { TaskExecutionPanel } from "../pages/tasks/TaskExecutionPanel";

type ExecutionContextStatus = "loading" | "ready" | "empty" | "error";

export function OperatorExecutionPanel({
  snapshot,
  serverId,
  executionId,
  requestAudit,
  onClose,
  onRefresh
}: {
  snapshot: AppSnapshot;
  serverId: string;
  executionId: string;
  requestAudit: (action: string) => Promise<OperatorAuditMetadata>;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [payload, setPayload] = useState<PlatformOperatorExecutionViewPayload | null>(null);
  const [contextStatus, setContextStatus] = useState<ExecutionContextStatus>("loading");
  const [error, setError] = useState("");

  const fetchExecution = useCallback((signal?: AbortSignal) => api<PlatformOperatorExecutionViewPayload>(
    `/api/operator/workspaces/${encodeURIComponent(serverId)}/executions/${encodeURIComponent(executionId)}`,
    { label: "operator.execution-view", signal }
  ), [executionId, serverId]);

  const refreshExecution = useCallback(async () => {
    try {
      const next = await fetchExecution();
      setPayload(next);
      setContextStatus("ready");
      setError("");
    } catch (refreshError) {
      if (!payload) setContextStatus("error");
      setError(apiErrorMessage(refreshError, "Execution details could not be loaded."));
    }
  }, [fetchExecution, payload]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    setPayload(null);
    setContextStatus("loading");
    setError("");
    const refresh = async () => {
      controller = new AbortController();
      try {
        const next = await fetchExecution(controller.signal);
        if (!cancelled) {
          setPayload(next);
          setContextStatus("ready");
          setError("");
        }
      } catch (refreshError) {
        if (!cancelled && !(refreshError instanceof DOMException && refreshError.name === "AbortError")) {
          setContextStatus((current) => current === "ready" ? current : "error");
          setError(apiErrorMessage(refreshError, "Execution details could not be loaded."));
        }
      } finally {
        controller = null;
        if (!cancelled) timer = setTimeout(refresh, 2_000);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [fetchExecution]);

  const timeline = useMemo(() => payload ? [{ execution: payload.execution, events: payload.events }] : [], [payload]);
  const safetyReview = useMemo(() => payload ? safetyReviewForContext(payload.safetyAssessments, {
    executionIds: [payload.execution.id],
    approvalIds: payload.approvals.map((approval) => approval.id)
  }) : null, [payload]);

  async function resolveApproval(approvalId: string, decision: "approve" | "reject" | "custom", customResponse?: string) {
    setError("");
    try {
      const audit = await requestAudit(`${decision === "approve" ? "Approve" : decision === "reject" ? "Reject" : "Respond to"} Runtime request`);
      await api(`/api/operator/workspaces/${encodeURIComponent(serverId)}/runtime-approvals/${encodeURIComponent(approvalId)}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, customResponse, ...audit }),
        label: "operator.runtime-approval-resolve"
      });
      await Promise.all([refreshExecution(), onRefresh()]);
    } catch (approvalError) {
      if (isOperatorAuditCancelled(approvalError)) return;
      const approvalErrorMessage = apiErrorMessage(approvalError, "Approval could not be resolved.");
      await refreshExecution();
      // 刷新审批真源后仍保留失败原因，避免 Read Only / Governance 拒绝提示被成功刷新立即清空。
      setError(approvalErrorMessage);
    }
  }

  return (
    <aside className="thread-panel execution-detail-panel operator-execution-panel">
      <div className="thread-head no-tabs">
        <div className="thread-titlebar">
          <h2><ShieldCheck size={16} /> Execution <span>- Operator</span></h2>
          <div className="thread-nav-actions">
            <button className="icon-btn" type="button" title="Close execution" aria-label="Close execution" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        {error && <div className="operator-execution-error" role="alert">{error}</div>}
      </div>
      <TaskExecutionPanel
        prompt={payload?.prompt ?? ""}
        timelines={timeline}
        approvals={payload?.approvals ?? []}
        activity={[]}
        agents={snapshot.agents}
        machines={snapshot.machines}
        safetyReview={safetyReview}
        governanceDecisions={payload?.governanceDecisions ?? []}
        contextStatus={payload ? "ready" : contextStatus}
        onRetryExecutionContext={() => void refreshExecution()}
        onResolveApproval={resolveApproval}
        debugExportSource="client"
      />
    </aside>
  );
}
