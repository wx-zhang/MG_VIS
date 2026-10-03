import path from "node:path";
import type { AgentRecord, RuntimeExecutionStatus } from "@tyr-ai/contracts";

interface WorkerWorkspacePathEvidence {
  sourceContent: string;
  workerResult: string;
  agent: Pick<AgentRecord, "id" | "workspacePath">;
  executionAgentId: string;
  executionStatus: RuntimeExecutionStatus;
}

/** This recognizes an explicit directory question, never a worker's request to disclose it. */
function requestsWorkspacePath(content: string): boolean {
  const directory = /\b(?:working\s+directory|current\s+directory|workspace\s+(?:path|directory)|cwd)\b|工作目录|工作区路径|当前目录/i;
  return content.split(/\r?\n|[.!?。！？](?=\s|$)/).some((sentence) => {
    if (!directory.test(sentence)) return false;
    // Ambiguous/negative instructions fail closed; a mention is not a request to disclose.
    if (/\b(?:not|never|without|avoid|exclude|omit|don['’]t)\b|不要|禁止|无需|不用|别(?:提供|显示|输出|返回)/i.test(sentence)) return false;
    if (/\b(?:meaning|definition|example|means|concept)\b|含义|定义|示例|概念/i.test(sentence)) return false;
    const directoryIndex = sentence.search(directory);
    const requestPrefix = sentence.slice(0, directoryIndex);
    if (/\b(?:state|show|tell|report|return|print|give|provide|list|find|check|confirm|identify|what|where|which)\b|提供|显示|输出|返回|告诉|查看|确认|是什么|在哪/i.test(requestPrefix)) return true;
    if (/^(?:\s*(?:你的|当前的|实际的|现有的))?(?:工作目录|工作区路径|当前目录)(?:是什么|在哪里|在哪)\s*$/.test(sentence)) return true;
    // A short noun question is also an explicit request, e.g. "cwd?" or "your workspace path?".
    return /^(?:\s*(?:your|the|current|exact|existing)\s+)?(?:working\s+directory|current\s+directory|workspace\s+(?:path|directory)|cwd|工作目录|工作区路径|当前目录)\s*$/i.test(sentence);
  });
}

function boundedPathOccurrence(content: string, start: number, workspacePath: string): boolean {
  const previous = start === 0 ? "" : content[start - 1]!;
  const nextIndex = start + workspacePath.length;
  const next = nextIndex === content.length ? "" : content[nextIndex]!;
  const startsToken = !previous || /[\s`'"([{]/.test(previous);
  const endsToken = !next || /[\s`'"\])}]/.test(next) ||
    /[.,;:!?]/.test(next) && (nextIndex + 1 === content.length || /\s/.test(content[nextIndex + 1]!));
  return startsToken && endsToken;
}

/**
 * Only daemon-reported, exact workspace paths may hide embedded IDs from the ID guard.
 * Parent execution/source ownership and ingress authorization remain the caller's responsibility.
 */
export function allowedWorkerWorkspacePaths(input: WorkerWorkspacePathEvidence): string[] {
  const workspacePath = input.agent.workspacePath;
  if (input.executionStatus !== "completed" || input.executionAgentId !== input.agent.id ||
      !workspacePath || (!path.posix.isAbsolute(workspacePath) && !path.win32.isAbsolute(workspacePath)) ||
      /[\r\n\0]/.test(workspacePath) || !requestsWorkspacePath(input.sourceContent)) return [];
  return maskAllowedWorkspacePaths(input.workerResult, [workspacePath]) !== input.workerResult ? [workspacePath] : [];
}

/** Mask exact path tokens for ID scanning only; never widen allowedAgentIds or edit public text. */
export function maskAllowedWorkspacePaths(content: string, allowedWorkspacePaths: readonly string[]): string {
  let masked = content;
  for (const workspacePath of new Set(allowedWorkspacePaths)) {
    if (!workspacePath || (!path.posix.isAbsolute(workspacePath) && !path.win32.isAbsolute(workspacePath)) || /[\r\n\0]/.test(workspacePath)) continue;
    let cursor = 0;
    let candidate = "";
    for (;;) {
      const start = masked.indexOf(workspacePath, cursor);
      if (start < 0) {
        candidate += masked.slice(cursor);
        break;
      }
      candidate += masked.slice(cursor, start);
      candidate += boundedPathOccurrence(masked, start, workspacePath) ? "\0workspace-path\0" : workspacePath;
      cursor = start + workspacePath.length;
    }
    masked = candidate;
  }
  return masked;
}
