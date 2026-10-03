export type ConnectCommandSet = {
  command: string;
  windowsCommand?: string;
  localCommand: string;
  localRealCommand: string;
};

export type ConnectCommandLabel = "INSTALL" | "REAL DEV";

export type ConnectCommandPresentation = {
  label: ConnectCommandLabel;
  command?: string;
};

export type ConnectCommandCredentialKind = "apiKey" | "connectorToken";

export type ConnectCommandCredentialSummary = {
  label: "Bootstrap key" | "Connector token" | "Unavailable";
  tone: "bootstrap" | "connector" | "unavailable";
};

export type ConnectCommandSegment = {
  text: string;
  highlight: boolean;
};

export function connectCommandTabs(isDev: boolean): ConnectCommandLabel[] {
  return isDev ? ["INSTALL", "REAL DEV"] : ["INSTALL"];
}

export function currentConnectPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { platform?: string } };
  return navigatorWithUserAgentData.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
}

function isWindowsPlatform(platform: string): boolean {
  return /\bwin/i.test(platform);
}

export function connectCommandPresentation(command: ConnectCommandSet | null, isDev: boolean, platform = "", requestedLabel?: ConnectCommandLabel): ConnectCommandPresentation {
  const tabs = connectCommandTabs(isDev);
  const label = requestedLabel && tabs.includes(requestedLabel) ? requestedLabel : "INSTALL";
  if (label === "REAL DEV") {
    return {
      label: "REAL DEV",
      command: command?.localRealCommand
    };
  }

  return {
    label: "INSTALL",
    command: isWindowsPlatform(platform) ? command?.windowsCommand ?? command?.command : command?.command
  };
}

export function connectCommandCredentialSummary(kind?: ConnectCommandCredentialKind): ConnectCommandCredentialSummary {
  if (kind === "apiKey") return { label: "Bootstrap key", tone: "bootstrap" };
  if (kind === "connectorToken") return { label: "Connector token", tone: "connector" };
  return { label: "Unavailable", tone: "unavailable" };
}

export function connectCommandCredentialKind(command?: string): ConnectCommandCredentialKind | undefined {
  if (!command) return undefined;
  if (/(?:^|\s)--connector-token(?:\s|$)|(?:^|\s)-ConnectorToken(?:\s|$)/.test(command)) return "connectorToken";
  if (/(?:^|\s)--api-key(?:\s|$)|(?:^|\s)-ApiKey(?:\s|$)/.test(command)) return "apiKey";
  return undefined;
}

export function connectCommandSegments(command: string): ConnectCommandSegment[] {
  const match = command.match(/(--(?:api-key|connector-token)|-(?:ApiKey|ConnectorToken))(\s+)((?:"[^"]*")|(?:'[^']*')|\S+)/);
  if (!match || match.index === undefined) return [{ text: command, highlight: false }];
  const before = command.slice(0, match.index);
  const flag = match[1];
  const separator = match[2];
  const value = match[3];
  const after = command.slice(match.index + match[0].length);
  return [
    before ? { text: before, highlight: false } : null,
    { text: flag, highlight: true },
    { text: separator, highlight: false },
    { text: value, highlight: true },
    after ? { text: after, highlight: false } : null
  ].filter((segment): segment is ConnectCommandSegment => Boolean(segment));
}
