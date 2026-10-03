import { isCommunicationAgent, type AgentRecord } from "@tyr-ai/contracts";

export type AssistantTelegramAccount = {
  telegramUserId: string;
  telegramChatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

export type AssistantTelegramStatus = {
  enabled: boolean;
  botUsername: string | null;
  account: AssistantTelegramAccount | null;
};

export type AssistantContactMethodStatus = "available" | "connected" | "unavailable";

export type AssistantContactMethod = {
  id: "email" | "telegram";
  label: string;
  status: AssistantContactMethodStatus;
  value: string;
  detail: string;
  copyValue?: string;
};

export function telegramAccountDisplayName(account: Pick<AssistantTelegramAccount, "telegramUserId" | "username" | "firstName" | "lastName">): string {
  if (account.username?.trim()) return `@${account.username.trim().replace(/^@/, "")}`;
  const fullName = [account.firstName, account.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  return fullName || account.telegramUserId;
}

export function assistantContactMethodsForAgent(agent: AgentRecord, telegramStatus: AssistantTelegramStatus | null): AssistantContactMethod[] {
  if (!isCommunicationAgent(agent)) return [];

  const emailAddress = agent.communicationEmailAddress?.trim() ?? "";
  const telegramAccount = telegramStatus?.account ?? null;

  // Keep supported contact entries visible; unavailable rows explain setup gaps.
  return [{
    id: "email",
    label: "Email",
    status: emailAddress ? "available" : "unavailable",
    value: emailAddress || "Not assigned",
    detail: emailAddress ? "Send email to TYR." : "TYR email has not been assigned.",
    ...(emailAddress ? { copyValue: emailAddress } : {})
  }, {
    id: "telegram",
    label: "Telegram",
    status: telegramAccount ? "connected" : "unavailable",
    value: telegramAccount ? telegramAccountDisplayName(telegramAccount) : telegramStatus?.enabled ? "Not connected" : "Unavailable",
    detail: telegramAccount
      ? "Private Telegram chat is connected."
      : telegramStatus?.enabled
        ? "Connect Telegram in Account Settings."
        : "Telegram is not enabled for this workspace."
  }];
}
