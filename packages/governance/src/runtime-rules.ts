import type { RuntimeApprovalKind, RuntimeApprovalRecord } from "@tyr-ai/contracts";
import { sanitizeUnknown } from "./redaction";

export type RuntimeApprovalClassification = "readonly" | "low_risk_workflow" | "side_effect" | "unknown";

export type RuntimeApprovalPolicyInput = {
  actionKind: RuntimeApprovalKind;
  payload?: unknown;
};

const READ_ONLY_ACTION_TYPES = new Set(["read", "listFiles", "search"]);
const READ_ONLY_COMMANDS = new Set(["pwd", "ls", "cat", "head", "tail", "wc", "rg", "grep", "nl", "stat", "file", "printf", "echo"]);
const READ_ONLY_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "branch", "rev-parse", "ls-files", "grep"]);
const READ_ONLY_TYR_COMMANDS = new Set([
  "auth whoami",
  "server info",
  "message check",
  "message read",
  "message search",
  "task list",
  "profile show"
]);
const LOW_RISK_TYR_WORKFLOW_COMMANDS = new Set([
  "task claim-message",
  "task claim",
  "task update"
]);
const SHELL_REDIRECTION_PATTERN = /(^|[^\\])(?:>>?|<)/;
const SHELL_SIDE_EFFECT_COMMAND_PATTERN = /\b(?:open|osascript|xdg-open|curl|wget|rm|mv|cp|mkdir|touch|chmod|chown|kill|pkill|brew)\b/i;

export function classifyRuntimeApproval(input: RuntimeApprovalPolicyInput): RuntimeApprovalClassification {
  if (input.actionKind !== "command") return "side_effect";
  const payload = objectPayload(input.payload);
  if (payloadHasNetworkRequest(payload)) return "side_effect";
  const actions = Array.isArray(payload?.commandActions) ? payload.commandActions : [];
  const tyrClassification = classifyTrustedInternalTyrCommand(payload);
  if (tyrClassification) return tyrClassification;
  const structuredAgentOperationClassification = classifyStructuredAgentOperationActions(actions);
  if (structuredAgentOperationClassification) return structuredAgentOperationClassification;
  // Runtime 结构化 action 优先于命令文本；未知结构化动作需要后续 Governance 决策。
  if (actions.length > 0) return actions.some((action) => !READ_ONLY_ACTION_TYPES.has(String(objectPayload(action)?.type ?? ""))) ? "unknown" : "readonly";
  return commandLooksReadOnly(commandFromPayload(payload)) ? "readonly" : "side_effect";
}

export function commandLooksReadOnly(command: unknown): boolean {
  const script = shellScript(command);
  if (!script) return false;
  if (hasShellSideEffectSignal(script)) return false;
  return script.split(/\s*(?:&&|\|\||;|\n|\|)\s*/).every(shellPartLooksReadOnly);
}

export function approvalPayloadForClassification(approval: RuntimeApprovalRecord): unknown {
  if (approval.payload && typeof approval.payload === "object" && !Array.isArray(approval.payload)) return approval.payload;
  if (approval.kind === "command") return { command: approval.detail };
  return approval.payload;
}

export function actionText(approval: RuntimeApprovalRecord): string {
  return [
    approval.method,
    approval.kind,
    approval.title,
    approval.detail,
    approval.payload === undefined ? "" : JSON.stringify(sanitizeUnknown(approval.payload))
  ].join("\n");
}

export function commandFromPayload(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) return payload.map(String).join(" ");
  if (!payload || typeof payload !== "object") return null;
  const object = payload as Record<string, unknown>;
  if (typeof object.command === "string") return object.command;
  if (Array.isArray(object.command)) return object.command.map(String).join(" ");
  if (typeof object.cmd === "string") return object.cmd;
  return null;
}

export function targetFromText(text: string): string | undefined {
  const targetMatch = text.match(/--target\s+["']?([^"'\s]+)/i);
  if (targetMatch?.[1]) return targetMatch[1];
  const channelMatch = text.match(/(?:channelId|channel_id|threadChannelId|thread_channel_id)["':\s]+([^"',\s}]+)/i);
  return channelMatch?.[1];
}

export function payloadHasNetworkRequest(payload: unknown): boolean {
  const object = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  return Boolean(
    object?.networkApprovalContext ||
    objectPayload(object?.additionalPermissions)?.network ||
    (Array.isArray(object?.proposedNetworkPolicyAmendments) && object.proposedNetworkPolicyAmendments.length > 0)
  );
}

export function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasShellSideEffectSignal(script: string): boolean {
  return SHELL_REDIRECTION_PATTERN.test(script) || SHELL_SIDE_EFFECT_COMMAND_PATTERN.test(script);
}

function classifyTrustedInternalTyrCommand(payload: Record<string, unknown> | null): RuntimeApprovalClassification | null {
  if (!payload) return null;
  const amendment = Array.isArray(payload.proposedExecpolicyAmendment) ? payload.proposedExecpolicyAmendment.map(String) : [];
  const amendmentClassification = classifyTrustedTyrTokens(amendment);
  if (amendmentClassification) return amendmentClassification;
  const script = shellScript(commandFromPayload(payload));
  // 只放行 tyr 自身协作 API；含 shell 控制符时交给 Governance 风险规则继续判断。
  if (/[;&|\n<>]/.test(script)) return null;
  const tokens = shellTokens(script);
  return classifyTrustedTyrTokens(tokens);
}

function classifyTrustedTyrTokens(tokens: string[]): RuntimeApprovalClassification | null {
  if (tokens[0] !== "tyr") return null;
  if (tokens.includes("--help") || tokens.includes("-h")) return "readonly";
  const command = `${tokens[1] ?? ""} ${tokens[2] ?? ""}`;
  if (READ_ONLY_TYR_COMMANDS.has(command)) return "readonly";
  if (LOW_RISK_TYR_WORKFLOW_COMMANDS.has(command) && commandStaysInCurrentContext(tokens)) return "low_risk_workflow";
  return "side_effect";
}

function classifyStructuredAgentOperationActions(actions: unknown[]): RuntimeApprovalClassification | null {
  if (!actions.some((action) => objectPayload(action)?.type === "agent_operation")) return null;
  return "side_effect";
}

function commandStaysInCurrentContext(tokens: string[]): boolean {
  return !tokens.includes("--execute-mentions") && !tokens.includes("--target");
}

function shellScript(command: unknown): string {
  const raw = Array.isArray(command) ? command.map(String).join(" ") : typeof command === "string" ? command : "";
  const trimmed = raw.trim();
  const match = trimmed.match(/^\/(?:usr\/)?bin\/(?:zsh|bash|sh)\s+-lc\s+([\s\S]+)$/);
  return stripShellQuotes(match?.[1] ?? trimmed);
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote !== "'" && quote !== "\"") || trimmed.at(-1) !== quote) return trimmed;
  const body = trimmed.slice(1, -1);
  return quote === "'" ? body.replace(/'\\''/g, "'") : body.replace(/\\"/g, "\"").replace(/\\\$/g, "$").replace(/\\\\/g, "\\");
}

function shellPartLooksReadOnly(part: string): boolean {
  const trimmed = part.trim();
  if (!trimmed || trimmed === "true" || trimmed === "false") return true;
  if (trimmed.startsWith("test ") || trimmed === "test" || trimmed.startsWith("[ ")) return true;
  const tokens = shellTokens(trimmed);
  const command = basename(tokens[0] ?? "");
  if (READ_ONLY_COMMANDS.has(command)) return true;
  if (command === "node" || command === "nodejs") return interpreterInvocationLooksReadOnly(tokens);
  if (command === "python" || command === "python3") return interpreterInvocationLooksReadOnly(tokens);
  if (command === "npm") return npmInvocationLooksReadOnly(tokens);
  if (command === "pnpm") return pnpmInvocationLooksReadOnly(tokens);
  if (command === "yarn") return yarnInvocationLooksReadOnly(tokens);
  if (command === "pip" || command === "pip3") return pipInvocationLooksReadOnly(tokens);
  if (command === "npx") return false;
  if (command === "sed") return !tokens.some((token) => token === "-i" || token.startsWith("-i"));
  if (command === "find") return !tokens.some((token) => token === "-delete" || token === "-exec" || token === "-execdir" || token === "-ok");
  if (command === "git") {
    const subcommand = tokens[1];
    return Boolean(subcommand && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand));
  }
  return false;
}

function basename(command: string): string {
  return command.split("/").filter(Boolean).at(-1) ?? command;
}

function shellTokens(value: string): string[] {
  return value.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => stripShellQuotes(token)) ?? [];
}

function interpreterInvocationLooksReadOnly(tokens: string[]): boolean {
  const args = tokens.slice(1).filter((token) => token !== "--");
  return args.length > 0 && args.every((token) => token === "--version" || token === "-v" || token === "-V" || token === "--help" || token === "-h");
}

function npmInvocationLooksReadOnly(tokens: string[]): boolean {
  const args = tokens.slice(1);
  if (args.some(isPackageManagerExecToken)) return false;
  const command = firstNonOptionToken(args);
  if (!command) return args.some(isVersionOrHelpToken);
  if (command === "pkg") return args[args.indexOf(command) + 1] === "get";
  if (command === "config") return args[args.indexOf(command) + 1] === "get";
  return ["list", "ls", "root", "prefix", "bin", "help"].includes(command);
}

function pnpmInvocationLooksReadOnly(tokens: string[]): boolean {
  const args = tokens.slice(1);
  if (args.some(isPackageManagerExecToken)) return false;
  const command = firstNonOptionToken(args);
  if (!command) return args.some(isVersionOrHelpToken);
  if (command === "config") return args[args.indexOf(command) + 1] === "get";
  return ["list", "ls", "why", "root", "bin", "help"].includes(command);
}

function yarnInvocationLooksReadOnly(tokens: string[]): boolean {
  const args = tokens.slice(1);
  if (args.some(isPackageManagerExecToken)) return false;
  const command = firstNonOptionToken(args);
  if (!command) return args.some(isVersionOrHelpToken);
  if (command === "config") return args[args.indexOf(command) + 1] === "get";
  return ["list", "why", "help"].includes(command);
}

function pipInvocationLooksReadOnly(tokens: string[]): boolean {
  const args = tokens.slice(1);
  const command = firstNonOptionToken(args);
  if (!command) return args.some(isVersionOrHelpToken);
  return ["list", "show", "help", "cache"].includes(command);
}

function firstNonOptionToken(tokens: string[]): string | undefined {
  for (const token of tokens) {
    if (token === "--") continue;
    if (token.startsWith("-")) continue;
    return token;
  }
  return undefined;
}

function isVersionOrHelpToken(token: string): boolean {
  return token === "--version" || token === "-v" || token === "--help" || token === "-h";
}

function isPackageManagerExecToken(token: string): boolean {
  return token === "exec" || token === "x" || token === "dlx" || token === "create" || token === "run" || token === "test" || token === "start";
}
