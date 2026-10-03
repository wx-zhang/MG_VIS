import type { AppSnapshot, MessageRecord } from "@tyr-ai/contracts";
import { channelDisplayLabel, channelDisplayLabelFromFields } from "../../resourceAccess";

export function messageThreadParentChannelLabel(snapshot: AppSnapshot, parentMessage: MessageRecord): string {
  const parentChannel = snapshot.channels.find((channel) => channel.id === parentMessage.channelId);
  if (parentChannel) return channelDisplayLabel(parentChannel, snapshot.agents);
  return channelDisplayLabelFromFields({
    type: parentMessage.channelType ?? "channel",
    name: parentMessage.channelName ?? "channel",
    displayName: parentMessage.channelDisplayName
  });
}

