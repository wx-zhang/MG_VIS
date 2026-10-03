import type {
  IncomingServerInviteRecord,
  MachineOnboardingLinkResponse,
  MachineRecord,
  ServerInviteRecord,
  UserRecord
} from "@tyr-ai/contracts";
import type { ConnectCommandSet } from "../connectCommand";
import type { HumanProfileRecord } from "../humanProfile";

export type AuthResponse = {
  user: UserRecord;
  accessToken: string;
  refreshToken: string;
  returnPath?: string;
};

export type ServerAccess = "loading" | "ready" | "none";

export type MachineConnectCommand = ConnectCommandSet & {
  apiKey: string;
  credentialKind?: "apiKey" | "connectorToken";
};

export type MachineOnboardingLink = MachineOnboardingLinkResponse;

export type ConnectCommandState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; command: MachineConnectCommand }
  | { status: "forbidden" | "unavailable" }
  | { status: "error"; error: string };

export type ServerMember = {
  userId: string;
  name: string;
  displayName: string;
  description: string | null;
  avatarUrl: string | null;
  role: "owner" | "member" | "guest";
  joinedAt: string;
  email: string | null;
  gravatarHash: string | null;
};

export type IncomingServerInvite = IncomingServerInviteRecord;

export type HumanMemberProfile = HumanProfileRecord;

export type SearchMessageResult = {
  id: string;
  seq: number;
  channelId: string;
  conversationId?: string | null;
  threadId: string | null;
  parentMessageId: string | null;
  parentMessageContent: string | null;
  parentChannelId: string;
  parentChannelName: string;
  parentChannelDisplayName?: string;
  parentChannelType: string;
  senderId: string;
  senderType: string;
  senderName: string;
  channelName: string;
  channelDisplayName?: string;
  channelType: string;
  content: string;
  createdAt: string;
  snippet: string;
  deletedAt?: string;
  deletedByUserId?: string;
  deletionReason?: "user_deleted";
};

export type ActivityLogItem = {
  timestamp: number;
  entry: {
    kind: string;
    activity?: string;
    detail?: string;
    text?: string;
    toolName?: string;
    toolInput?: string;
  };
};

export type ReminderUi = {
  id: string;
  title: string;
  status: string;
  fireAt: string;
  repeat?: string | null;
  fireCount?: number;
};

export type MentionCandidate = {
  id: string;
  type: "human" | "agent";
  name: string;
  displayName: string;
  description?: string;
  status?: string;
  handle: string;
};
