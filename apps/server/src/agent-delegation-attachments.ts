import type { AgentRecord, AttachmentRecord } from "@tyr-ai/contracts";
import type { GovernanceSourceTag } from "@tyr-ai/governance";
import type { ServerRouteContext } from "./server-context";

export function resolveDelegationAttachmentSources(ctx: ServerRouteContext, sourceAgent: AgentRecord, value: unknown): AttachmentRecord[] | null {
  const attachmentIds = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  const attachments: AttachmentRecord[] = [];
  for (const attachmentId of attachmentIds) {
    const attachment = ctx.store.getAttachment(attachmentId);
    // Delegation can only propagate files the source agent could already see in its current channel scope.
    if (!attachment || !ctx.store.canAgentAccessChannel(sourceAgent.id, attachment.channelId)) return null;
    attachments.push(attachment);
  }
  return attachments;
}

export function delegationAttachmentsNeedPairGrant(ctx: ServerRouteContext, targetAgent: AgentRecord, attachments: AttachmentRecord[]): boolean {
  return attachments.some((attachment) => !ctx.store.canAgentAccessChannel(targetAgent.id, attachment.channelId));
}

export function prepareDelegationAttachmentIds(
  ctx: ServerRouteContext,
  targetAgent: AgentRecord,
  pairChannelId: string,
  attachments: AttachmentRecord[]
): string[] {
  return attachments.map((attachment) => {
    if (ctx.store.canAgentAccessChannel(targetAgent.id, attachment.channelId)) return attachment.id;
    // Delegation grants are pair-DM scoped: the target gets a new attachment record, not access to the source channel.
    return ctx.store.createAttachment({
      channelId: pairChannelId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      path: attachment.path
    }).id;
  });
}

export function governanceSourceForDelegationAttachment(attachment: AttachmentRecord): GovernanceSourceTag {
  return {
    sourceType: "attachment",
    sourceTrust: "untrusted_external",
    sourceId: attachment.id,
    attachmentId: attachment.id,
    channelId: attachment.channelId,
    propagation: ["delegation_attachment"]
  };
}
