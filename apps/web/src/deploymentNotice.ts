import type { DeploymentNotice } from "@tyr-ai/contracts";

export function deploymentNoticeText(notice: DeploymentNotice | null, unavailable = false, now = Date.now()): string | null {
  if (!notice || notice.phase === "completed") return null;
  const expired = now >= Date.parse(notice.expiresAt);
  if (unavailable || (expired && notice.phase === "updating")) {
    return "Update status is unavailable. Please wait for confirmation before testing. Keep this page open.";
  }
  if (expired) return "The update is awaiting a new schedule. You can keep this page open.";
  switch (notice.phase) {
    case "scheduled": return "An update is planned. Please pause testing when convenient. We will wait for activity to finish. You can keep this page open.";
    case "updating": return "An update is in progress. Please pause testing. You can keep this page open; it will not refresh automatically.";
    case "postponed": return "The update has been postponed. You can continue working.";
  }
}
