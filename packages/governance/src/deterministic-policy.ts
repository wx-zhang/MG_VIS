import type { RuntimeApprovalRecord } from "@tyr-ai/contracts";
import type { GovernanceDecision, GovernanceRiskType, GovernanceResolvedPolicy } from "./types";
import { DEFAULT_GOVERNANCE_POLICY } from "./policy";
import {
  actionText,
  approvalPayloadForClassification,
  classifyRuntimeApproval,
  payloadHasNetworkRequest,
  type RuntimeApprovalClassification
} from "./runtime-rules";
import { containsSensitiveContent } from "./redaction";

export function evaluateDeterministicPolicy(input: {
  approval: RuntimeApprovalRecord;
  classification?: RuntimeApprovalClassification;
  policy?: GovernanceResolvedPolicy;
}): GovernanceDecision {
  const policy = input.policy ?? DEFAULT_GOVERNANCE_POLICY;
  const classification = input.classification ?? classifyRuntimeApproval({ actionKind: input.approval.kind, payload: approvalPayloadForClassification(input.approval) });
  const text = actionText(input.approval);
  const lower = text.toLowerCase();
  const structuredOperations = structuredAgentOperations(input.approval.payload);
  const risks: GovernanceRiskType[] = [];
  const evidence: string[] = [];
  if (classification === "side_effect") addRisk(risks, "side_effect", evidence, "runtime approval classification is side_effect");
  if (classification === "unknown") addRisk(risks, "unknown_action", evidence, "runtime approval classification is unknown");
  if (input.approval.kind === "permissions" || hasPermissionEscalationSignal(text)) {
    addRisk(risks, "permission_escalation", evidence, "action requests broader runtime permissions");
  }
  if (payloadHasNetworkRequest(input.approval.payload) || hasNetworkSignal(text)) {
    addRisk(risks, "network", evidence, "action can reach network or external applications");
  }
  if (hasExternalSendSignal(text, structuredOperations)) {
    addRisk(risks, "external_send", evidence, "action sends content outside the current runtime");
  }
  if (hasCrossContextSignal(text, structuredOperations) && risks.includes("external_send")) {
    addRisk(risks, "cross_context", evidence, "send action targets an explicit channel/thread/context");
  }
  if (containsSensitiveContent(text)) {
    addRisk(risks, "sensitive_content", evidence, "action text contains secret-like material");
  }
  if (isDestructiveCommand(lower)) {
    addRisk(risks, "destructive_command", evidence, "command is destructive with high confidence");
  }
  if (risks.includes("destructive_command")) {
    return {
      decision: policy.destructive_command,
      confidence: 0.95,
      riskTypes: risks,
      reason: "High-confidence destructive command requested before execution.",
      evidence,
      shouldUseModel: false
    };
  }
  if (risks.length > 0) {
    return {
      decision: "require_human",
      confidence: risks.includes("sensitive_content") || risks.includes("permission_escalation") ? 0.82 : 0.72,
      riskTypes: risks,
      reason: "Deterministic policy found side-effect or data movement risk before execution.",
      evidence,
      shouldUseModel: true
    };
  }
  return {
    decision: classification === "readonly" || classification === "low_risk_workflow" ? "allow" : policy.unknown_action,
    confidence: classification === "readonly" || classification === "low_risk_workflow" ? 0.8 : 0.4,
    riskTypes: [],
    reason: classification === "readonly" || classification === "low_risk_workflow"
      ? "Deterministic policy found no risky signal."
      : "Deterministic policy could not classify the proposed action.",
    evidence: [],
    shouldUseModel: classification !== "readonly" && classification !== "low_risk_workflow"
  };
}

export function addRisk(risks: GovernanceRiskType[], risk: GovernanceRiskType, evidence: string[], evidenceText: string): void {
  if (!risks.includes(risk)) risks.push(risk);
  evidence.push(evidenceText);
}

export function mergeRiskTypes(base: GovernanceRiskType[], extra: GovernanceRiskType[]): GovernanceRiskType[] {
  return [...base, ...extra].filter((risk, index, all) => all.indexOf(risk) === index);
}

export function mergeEvidence(base: string[], extra: string[]): string[] {
  return [...base, ...extra].filter((item, index, all) => item.trim() && all.indexOf(item) === index).slice(0, 10);
}

function isDestructiveCommand(lower: string): boolean {
  return /\brm\s+-[a-z]*r[f]?\b/.test(lower) ||
    /\bgit\s+reset\s+--hard\b/.test(lower) ||
    /\bgit\s+checkout\s+--\s+\S+/.test(lower) ||
    gitRestoreTouchesWorktree(lower) ||
    /\bgit\s+clean\s+-[a-z]*[fd][a-z]*\b/.test(lower) ||
    /\bfind\b[\s\S]*\s-delete\b/.test(lower) ||
    /\btruncate\s+-s\s+0\b/.test(lower) ||
    /\bshred\b/.test(lower) ||
    /\bdocker\s+(?:system\s+)?prune\b/.test(lower) ||
    /\bkubectl\s+delete\b/.test(lower) ||
    /\bdd\s+if=/.test(lower) ||
    /\bmkfs(?:\.[a-z0-9]+)?\b/.test(lower);
}

function gitRestoreTouchesWorktree(lower: string): boolean {
  const match = lower.match(/\bgit\s+restore\b([\s\S]*)/);
  if (!match?.[1]) return false;
  const restoreArgs = match[1].split(/&&|\|\||;|\n|\|/)[0] ?? "";
  if (!/[./\w-]/.test(restoreArgs)) return false;
  return !/(^|\s)--staged(\s|$)/.test(restoreArgs) || /(^|\s)--worktree(\s|$)/.test(restoreArgs);
}

function hasNetworkSignal(text: string): boolean {
  const optionPrefix = String.raw`(?:\s+(?:-[^\s]+|--[^\s]+)(?:\s+(?!(?:install|i|add|update|upgrade|view|info|search|audit|outdated|publish|dlx|create|exec|x)\b)\S+)?)*`;
  return /\b(curl|wget|open|osascript|xdg-open)\b/i.test(text) ||
    new RegExp(String.raw`\b(?:npm|pnpm|yarn|bun)${optionPrefix}\s+(?:install|i|add|update|upgrade|view|info|search|audit|outdated|publish)\b`, "i").test(text) ||
    new RegExp(String.raw`\bpnpm${optionPrefix}\s+(?:dlx|create)\b`, "i").test(text) ||
    new RegExp(String.raw`\bnpm${optionPrefix}\s+(?:exec|x|create)\b`, "i").test(text) ||
    /\bnpx\b/i.test(text) ||
    /\b(?:pip|pip3)\s+(?:install|download|index|search)\b/i.test(text);
}

function hasPermissionEscalationSignal(text: string): boolean {
  return /additionalpermissions|proposednetworkpolicyamendments|grant permission|workspace-write|danger-full-access/i.test(text) ||
    /\bsudo\b/i.test(text) ||
    /dangerously[-_]?skip[-_]?permissions|allow[-_]?dangerously[-_]?skip[-_]?permissions/i.test(text) ||
    /--(?:sandbox|permission-mode)(?:\s+|=)(?:disabled|danger-full-access|bypass|unrestricted)/i.test(text) ||
    /\b(?:chmod|chown)\s+-[a-z]*r/i.test(text);
}

function hasExternalSendSignal(text: string, operations: StructuredAgentOperation[]): boolean {
  return /\btyr\s+message\s+send\b|\bsend_message\b|\bmessage[._-]?send\b|\battachment\s+upload\b|\bupload_attachment\b|\battachment[._-]?upload\b|\btyr\s+agent\s+delegate\b|\bdelegate_agent\b|\bagent[._-]?delegate\b/i.test(text) ||
    operations.some((operation) => operation.operationId === "message.send" || operation.operationId === "attachment.upload" || operation.operationId === "agent.delegate");
}

function hasCrossContextSignal(text: string, operations: StructuredAgentOperation[]): boolean {
  return /--target\b|--execute-mentions\b|threadchannelid|thread[_-]?channel|channelid|channel[_-]?id|targetagentid|target[_-]?agent/i.test(text) ||
    operations.some((operation) => operation.operationId === "agent.delegate" || Boolean(operation.target || operation.targetAgentId || operation.channelId || operation.threadChannelId));
}

type StructuredAgentOperation = {
  operationId?: string;
  target?: unknown;
  targetAgentId?: unknown;
  channelId?: unknown;
  threadChannelId?: unknown;
};

function structuredAgentOperations(payload: unknown): StructuredAgentOperation[] {
  const object = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const actions = Array.isArray(object?.commandActions) ? object.commandActions : [];
  return actions
    .map((action): StructuredAgentOperation | null => {
      if (!action || typeof action !== "object" || Array.isArray(action)) return null;
      const value = action as Record<string, unknown>;
      if (value.type !== "agent_operation") return null;
      return {
        operationId: typeof value.operationId === "string" ? value.operationId : undefined,
        target: value.target,
        targetAgentId: value.targetAgentId,
        channelId: value.channelId,
        threadChannelId: value.threadChannelId
      };
    })
    .filter((operation): operation is StructuredAgentOperation => Boolean(operation));
}
