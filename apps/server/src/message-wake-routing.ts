import type { MessageRecord } from "@tyr-ai/contracts";

export function threadChannelIdForWakeMessage(message: Pick<MessageRecord, "channelId" | "channelType">): string | undefined {
  if (message.channelType === "thread") return message.channelId;
  // 历史根消息可能仍挂着自动生成的空 thread；它不能再改变主 DM 执行的回复位置。
  return undefined;
}
