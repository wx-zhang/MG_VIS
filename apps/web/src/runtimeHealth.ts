import type { RuntimeReport } from "@tyr-ai/contracts";

function installLabel(report: RuntimeReport): string {
  if (report.installStatus === "installed" || report.status === "available") return "Installed";
  if (report.installStatus === "missing" || report.status === "unavailable") return "Not installed";
  return "Install unknown";
}

function authLabel(report: RuntimeReport): string {
  if (report.authStatus === "authenticated") return "Logged in";
  if (report.authStatus === "login_required") return "Login required";
  return "Login unknown";
}

function capabilityLabel(prefix: string, status: RuntimeReport["cliStatus"] | RuntimeReport["mcpStatus"]): string {
  if (status === "available") return `${prefix} available`;
  if (status === "degraded") return `${prefix} degraded`;
  if (status === "unavailable") return `${prefix} unavailable`;
  if (status === "not_applicable") return `${prefix} not applicable`;
  return `${prefix} unknown`;
}

export function runtimeHealthLabel(report: RuntimeReport): string {
  const parts = [
    report.displayName,
    report.version,
    installLabel(report),
    authLabel(report),
    capabilityLabel("CLI", report.cliStatus ?? (report.status === "available" ? "available" : "unavailable")),
    capabilityLabel("MCP", report.mcpStatus ?? "unknown")
  ].filter((part): part is string => Boolean(part));
  const hiddenCount = report.hiddenMcpTools?.length ?? 0;
  if (hiddenCount > 0) parts.push(`${hiddenCount} MCP ${hiddenCount === 1 ? "tool" : "tools"} hidden`);
  return parts.join(" · ");
}

export function runtimeHealthClassName(report: Pick<RuntimeReport, "status" | "mcpStatus" | "installStatus">): string {
  if (report.installStatus === "missing" || report.status === "unavailable") return "runtime unavailable";
  if (report.mcpStatus === "degraded") return "runtime degraded";
  return "runtime available";
}
