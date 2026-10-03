import { runtimeDisplayName, type AppSnapshot, type ChannelRecord, type DeviceCapabilityDescriptor, type DeviceRecord, type MessageExecutionSummaryItemRecord, type RuntimeApprovalRecord, type RuntimeExecutionRecord } from '@tyr-ai/contracts';
import type { MentionCandidate } from '../../app/workspaceTypes';
import { deviceCapabilityDescriptors } from '../../deviceCapabilities';
import { mentionableAgentsForChannel } from '../../resourceAccess';

export type ChatSlashAction = {
  id: 'device';
  command: '/device';
  label: string;
  description: string;
};

export function activeSlashToken(text: string, caretIndex: number): { start: number; end: number; query: string } | null {
  const beforeCaret = text.slice(0, caretIndex);
  const match = beforeCaret.match(/(?:^|\s)\/([^\s/]*)$/u);
  if (!match) return null;
  const slashIndex = beforeCaret.lastIndexOf("/");
  return { start: slashIndex, end: caretIndex, query: match[1] ?? "" };
}

export function chatSlashActions(query = ""): ChatSlashAction[] {
  const normalized = query.trim().toLowerCase();
  const actions: ChatSlashAction[] = [{
    id: 'device',
    command: '/device',
    label: 'Mobile device method',
    description: 'Request a method from a paired mobile device.'
  }];
  if (!normalized) return actions;
  return actions.filter((action) => (
    action.command.includes(normalized) ||
    action.label.toLowerCase().includes(normalized) ||
    action.description.toLowerCase().includes(normalized)
  ));
}

export function chatDeviceOptions(snapshot: Pick<AppSnapshot, "devices">, query = ""): DeviceRecord[] {
  const normalized = query.trim().toLowerCase();
  return (snapshot.devices ?? [])
    .filter((device) => device.capabilities.length > 0)
    .filter((device) => !normalized || [
      device.displayName,
      device.platform,
      device.deviceKind,
      device.status
    ].some((value) => String(value).toLowerCase().includes(normalized)));
}

export function chatDeviceMethodOptions(device: Pick<DeviceRecord, "capabilities" | "capabilityDescriptors"> | undefined, query = ""): DeviceCapabilityDescriptor[] {
  const normalized = query.trim().toLowerCase();
  return deviceCapabilityDescriptors(device)
    .filter((descriptor) => !normalized || [
      descriptor.id,
      descriptor.label,
      descriptor.description ?? "",
      descriptor.riskLevel
    ].some((value) => value.toLowerCase().includes(normalized)));
}

export function chatMentionMembers(snapshot: AppSnapshot): MentionCandidate[] {
  return [
    ...snapshot.humans.map((human) => ({
      id: human.id,
      type: 'human' as const,
      name: human.name,
      displayName: human.displayName,
      handle: `@${human.name}`
    })),
    ...mentionableAgentsForChannel(snapshot.agents, snapshot.currentUser.id).map((agent) => ({
      id: agent.id,
      type: 'agent' as const,
      name: agent.name,
      displayName: agent.displayName,
      description: agent.description || (agent.runtime ? runtimeDisplayName(agent.runtime) : "No runtime"),
      status: agent.status,
      handle: `@${agent.name}`
    }))
  ];
}

export function chatMentionCandidates(members: MentionCandidate[], query: string): MentionCandidate[] {
  const normalized = query.toLowerCase();
  // The mention menu is height-limited and scrollable, so the data layer must not hide mentionable identities.
  return members.filter((member) => member.name.toLowerCase().includes(normalized) || member.displayName.toLowerCase().includes(normalized));
}

export function chatChannelOpenTaskCount(snapshot: AppSnapshot, channelId: string): number {
  return snapshot.tasks.filter((task) => task.channelId === channelId && task.status !== 'done' && task.status !== 'closed').length;
}

export function chatChannelAttachmentCount(snapshot: AppSnapshot, channelId: string): number {
  return snapshot.messages
    .filter((message) => message.channelId === channelId)
    .reduce((count, message) => count + (message.attachments?.length ?? 0), 0);
}

export function chatChannelSubtitle(channel?: ChannelRecord): string | undefined {
  if (!channel || channel.type === 'dm') return undefined;
  if (channel.archivedAt) return `Archived${channel.description?.trim() ? ` · ${channel.description.trim()}` : ''}`;
  return channel.description?.trim() || (channel.visibility === 'private' ? 'Private conversation' : 'Conversation');
}

export type ChatMessageExecutionSummary = {
  status: 'pending_approval' | 'running' | 'failed' | 'completed' | 'partial';
  label: string;
  actionLabel: 'Review approval' | 'View execution';
  agentNames: string[];
  executionIds: string[];
  approvalIds: string[];
  pendingApprovalCount: number;
  items?: MessageExecutionSummaryItemRecord[];
};

export function chatMessageExecutionSummary(
  snapshot: Pick<AppSnapshot, 'agents' | 'runtimeExecutions' | 'runtimeApprovals' | 'messageExecutionSummaries'>,
  messageId: string
): ChatMessageExecutionSummary | null {
  const serverSummary = snapshot.messageExecutionSummaries?.[messageId];
  const executions = (snapshot.runtimeExecutions ?? [])
    .filter((execution) => execution.messageId === messageId || execution.rootMessageId === messageId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const executionIds = new Set(executions.map((execution) => execution.id));
  const executionThreadIds = new Set(executions.map((execution) => execution.threadChannelId).filter(Boolean) as string[]);
  const approvals = (snapshot.runtimeApprovals ?? [])
    .filter((approval) =>
      approval.messageId === messageId ||
      Boolean(approval.executionId && executionIds.has(approval.executionId)) ||
      Boolean(approval.threadChannelId && executionThreadIds.has(approval.threadChannelId))
    )
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  if (executions.length === 0 && approvals.length === 0) {
    if (!serverSummary) return null;
    return {
      status: serverSummary.status,
      label: serverSummary.label,
      actionLabel: serverSummary.actionLabel,
      agentNames: serverSummary.agentNames,
      executionIds: serverSummary.executionIds,
      approvalIds: serverSummary.approvalIds,
      pendingApprovalCount: serverSummary.pendingApprovalCount,
      items: serverSummary.items
    };
  }

  // Realtime execution events can arrive before or after message:new. Once the linked records exist locally,
  // they are the live truth and must not be masked by the page-load summary captured at an older status.
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');
  const pendingApprovalCount = pendingApprovals.length;
  const status = messageExecutionStatus(executions, pendingApprovalCount);
  const agentNames = messageExecutionAgentNames(snapshot.agents, executions, approvals);
  const pendingAgentNames = messageExecutionAgentHandles(snapshot.agents, pendingApprovals);
  const items = executions.map((execution) => {
    const executionApprovals = approvals.filter((approval) => approval.executionId === execution.id);
    const itemStatus = messageExecutionItemStatus(execution, pendingApprovals.some((approval) => approval.executionId === execution.id));
    return {
      executionId: execution.id,
      agentId: execution.agentId,
      agentName: messageExecutionAgentNames(snapshot.agents, [execution], executionApprovals)[0] ?? 'Unknown agent',
      status: itemStatus,
      actionLabel: itemStatus === 'pending_approval' ? 'Review approval' : itemStatus === 'completed' ? 'View result' : 'View progress',
      updatedAt: execution.updatedAt
    } satisfies MessageExecutionSummaryItemRecord;
  });
  const subject = status === 'pending_approval' && pendingAgentNames.length > 0
    ? pendingAgentNames.length === 1 ? agentTag(pendingAgentNames[0]) : `${pendingAgentNames.length} agents`
    : agentNames.length ? agentNames.join(', ') : `${executions.length || approvals.length} execution${executions.length + approvals.length === 1 ? '' : 's'}`;
  return {
    status,
    label: messageExecutionLabel(status, subject, pendingApprovalCount),
    actionLabel: status === 'pending_approval' ? 'Review approval' : 'View execution',
    agentNames,
    executionIds: executions.map((execution) => execution.id),
    approvalIds: approvals.map((approval) => approval.id),
    pendingApprovalCount,
    items
  };
}

function messageExecutionStatus(executions: RuntimeExecutionRecord[], pendingApprovalCount: number): ChatMessageExecutionSummary['status'] {
  if (pendingApprovalCount > 0 || executions.some((execution) => execution.status === 'waiting_approval')) return 'pending_approval';
  if (executions.some((execution) => execution.status === 'queued' || execution.status === 'delivered' || execution.status === 'running')) return 'running';
  if (executions.some((execution) => execution.status === 'failed' || execution.status === 'stalled' || execution.status === 'cancelled')) return 'failed';
  return 'completed';
}

function messageExecutionAgentNames(agents: AppSnapshot['agents'], executions: RuntimeExecutionRecord[], approvals: RuntimeApprovalRecord[]): string[] {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent.displayName || agent.name]));
  const ids = [...executions.map((execution) => execution.agentId), ...approvals.map((approval) => approval.agentId)];
  return [...new Set(ids.map((agentId) => agentsById.get(agentId) ?? 'Unknown agent'))];
}

function messageExecutionItemStatus(execution: RuntimeExecutionRecord, pendingApproval: boolean): MessageExecutionSummaryItemRecord['status'] {
  if (pendingApproval || execution.status === 'waiting_approval') return 'pending_approval';
  if (execution.status === 'queued') return 'queued';
  if (execution.status === 'delivered') return 'delivered';
  if (execution.status === 'running') return 'running';
  if (execution.status === 'failed' || execution.status === 'stalled' || execution.status === 'cancelled') return 'failed';
  return 'completed';
}

function messageExecutionAgentHandles(agents: AppSnapshot['agents'], approvals: RuntimeApprovalRecord[]): string[] {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent.name || agent.displayName]));
  return [...new Set(approvals.map((approval) => agentsById.get(approval.agentId) ?? 'Unknown agent'))];
}

function messageExecutionLabel(status: ChatMessageExecutionSummary['status'], subject: string, pendingApprovalCount: number): string {
  if (status === 'pending_approval') return pendingApprovalCount > 1 ? `${subject} approvals pending` : `${subject} approval pending`;
  if (status === 'running') return `${subject} running`;
  if (status === 'failed') return `${subject} needs attention`;
  if (status === 'partial') return `${subject} history available`;
  return `${subject} replied`;
}

function agentTag(name: string): string {
  if (!name || name === 'Unknown agent' || name.startsWith('@')) return name;
  return `@${name}`;
}
