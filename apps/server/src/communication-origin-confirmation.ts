import type { AgentRecord, MessageRecord } from "@tyr-ai/contracts";
import { executeTyrAssistantTool } from "./assistant-tool-executor";
import { getCommunicationReturnEvent } from "./communication-return-ipc";
import { verifiedCommunicationOriginAction } from "./communication-origin-route";
import type { ServerRouteContext } from "./server-context";

/** Only the next Human reply to a specific TYR question can confirm a worker-origin notice. */
export async function answerCommunicationOriginConfirmation(ctx: ServerRouteContext, input: {
  message: MessageRecord;
  assistant: AgentRecord;
  serverId: string;
}): Promise<{ content: string; requestId?: string; sourceMessageId: string; status: "partial" | "completed" } | null> {
  const { message, assistant, serverId } = input;
  if (message.senderType !== "human" || !message.conversationId) return null;
  const answer = message.content.trim().toLocaleLowerCase().replace(/[.!。！]+$/u, "");
  if (!/^(?:yes|approve|approved|confirm|send|no|decline|cancel|是|确认|发送|否|不发送)$/u.test(answer)) return null;
  const previous = ctx.store.listMessages(message.channelId, 100)
    .filter((item) => item.conversationId === message.conversationId && item.seq < message.seq)
    .at(-1);
  if (previous?.senderType !== "agent" || previous.senderId !== assistant.id ||
      previous.result?.status !== "partial") return null;
  const row = ctx.store.db.prepare(
    "select id from communication_return_events where reply_message_id = ? and kind = 'action_request' and state = 'completed'"
  ).get(previous.id) as { id: string } | undefined;
  const event = row ? getCommunicationReturnEvent(ctx.store, row.id) : null;
  const execution = event ? ctx.store.getRuntimeExecution(event.sourceExecutionId) : null;
  const sourceMessageId = execution?.communicationReturnSourceMessageId;
  if (!event || !execution || !sourceMessageId ||
      execution.communicationReturnChannelId !== message.channelId ||
      execution.communicationReturnConversationId !== message.conversationId ||
      execution.communicationReturnUserId !== message.senderId || execution.serverId !== serverId) return null;
  if (previous.result?.title !== "TYR needs action confirmation") return {
    content: "There is no verified notice awaiting approval. The Agent's completed work will not run again. Please provide the recipient and exact message if you want me to send a new notice.",
    sourceMessageId, status: "partial"
  };
  const origin = verifiedCommunicationOriginAction(ctx.store, {
    eventId: event.id, serverId, requestingUserId: message.senderId, sourceMessageId
  });
  if (!origin) return {
    content: "The original connected workspace or its Bridge is no longer available. I have not sent the notice.",
    sourceMessageId, status: "partial"
  };
  if (/^(?:no|decline|cancel|否|不发送)$/u.test(answer)) return {
    content: `Understood. I have not sent the notice to ${origin.peerWorkspaceName}. The Agent's completed work remains recorded.`,
    sourceMessageId, status: "completed"
  };
  const outcome = await executeTyrAssistantTool(ctx, {
    call: {
      id: "confirmed-origin-notice",
      name: "send_workspace_bridge_message",
      arguments: { bridgeId: origin.bridgeId, message: origin.peerMessage }
    },
    serverId,
    userId: message.senderId,
    assistant,
    channelId: message.channelId,
    conversationId: message.conversationId,
    sourceMessageId,
    sourceContext: {
      source: execution.communicationReturnSource ?? "web",
      sourceConversationKey: message.conversationId,
      sourceEventKey: event.id,
      ...(execution.communicationReturnExternalRef ? { externalRef: execution.communicationReturnExternalRef } : {}),
      continuationStepCount: 1
    },
    returnTarget: {
      source: execution.communicationReturnSource ?? "web",
      ...(execution.communicationReturnExternalRef ? { externalRef: execution.communicationReturnExternalRef } : {})
    },
    allowHandoff: true
  });
  const requestId = outcome.ok ? outcome.result.bridgeRequestIds?.[0] : undefined;
  if (!requestId || !ctx.store.getCrossWorkspaceMessage(requestId)) return {
    content: `I could not verify delivery to ${origin.peerWorkspaceName}. The Agent's completed work remains recorded; the notice was not confirmed as sent.`,
    sourceMessageId, status: "partial"
  };
  return {
    content: `I sent the notice to ${origin.peerWorkspaceName} and will report its response here.`,
    requestId,
    sourceMessageId, status: "partial"
  };
}
