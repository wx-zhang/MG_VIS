type MachineCredentialFlag = "--api-key" | "--connector-token";
type MachineCredentialKind = "apiKey" | "connectorToken";

export interface WindowsDaemonInstallCommandInput {
  serverUrl: string;
  credentialFlag?: MachineCredentialFlag;
  credentialValue?: string;
  onboardingCode?: string;
  dataDir?: string;
}

export interface MachineConnectCommandInput {
  serverUrl: string;
  machineId: string;
  machineName: string;
  apiKey: string;
  credentialKind: MachineCredentialKind;
  credentialFlag: MachineCredentialFlag;
  credentialValue: string;
}

export interface MachineOnboardingCommandInput {
  serverUrl: string;
  code: string;
  machineId: string;
  machineName: string;
}

export function machineConnectCommandSet(input: MachineConnectCommandInput) {
  const serverUrl = input.serverUrl.replace(/\/$/, "");
  const credentialArg = `${input.credentialFlag} ${input.credentialValue}`;
  // 每个 Computer 必须隔离 daemon data-dir，避免同一物理机上多实例互相覆盖 connector token 和 agent runtime 状态。
  const unixDataDirArg = `--data-dir "$HOME/.tyr-ai/machines/${input.machineId}"`;
  const windowsDataDir = `$env:USERPROFILE\\.tyr-ai\\machines\\${input.machineId}`;
  const suffix = ` # ${input.machineName}`;
  return {
    apiKey: input.apiKey,
    credentialKind: input.credentialKind,
    command: `curl -fsSL ${serverUrl}/install-daemon.sh | bash -s -- --server-url ${serverUrl} ${credentialArg} ${unixDataDirArg}${suffix}`,
    windowsCommand: windowsDaemonInstallCommand({ serverUrl, credentialFlag: input.credentialFlag, credentialValue: input.credentialValue, dataDir: windowsDataDir }),
    localCommand: `pnpm --filter @tyr-ai/daemon dev -- --server-url ${serverUrl} ${credentialArg} ${unixDataDirArg}${suffix}`,
    localRealCommand: `pnpm dev:daemon:real -- --server-url ${serverUrl} ${credentialArg} ${unixDataDirArg}${suffix}`
  };
}

export function machineOnboardingCommandSet(input: MachineOnboardingCommandInput) {
  const serverUrl = input.serverUrl.replace(/\/$/, "");
  const unixDataDirArg = `--data-dir "$HOME/.tyr-ai/machines/${input.machineId}"`;
  const windowsDataDir = `$env:USERPROFILE\\.tyr-ai\\machines\\${input.machineId}`;
  const onboardingArg = `--onboarding-code ${input.code}`;
  const suffix = ` # ${input.machineName}`;
  return {
    onboardingUrl: `${serverUrl}/onboard/${encodeURIComponent(input.code)}`,
    installCommand: `curl -fsSL ${serverUrl}/install-daemon.sh | bash -s -- --server-url ${serverUrl} ${onboardingArg} ${unixDataDirArg}${suffix}`,
    windowsInstallCommand: windowsDaemonInstallCommand({ serverUrl, onboardingCode: input.code, dataDir: windowsDataDir })
  };
}

export function windowsDaemonInstallCommand(input: WindowsDaemonInstallCommandInput): string {
  const serverUrl = input.serverUrl.replace(/\/$/, "");
  const credentialName = input.credentialFlag === "--connector-token" ? "-ConnectorToken" : "-ApiKey";
  const credentialPart = input.onboardingCode
    ? `-OnboardingCode ${powershellDoubleQuoted(input.onboardingCode)}`
    : `${credentialName} ${powershellDoubleQuoted(input.credentialValue ?? "")}`;
  const script = [
    "$ErrorActionPreference = \"Stop\"",
    "$p = Join-Path $env:TEMP \"tyr-install-daemon.ps1\"",
    "Write-Host \"Downloading tyr-daemon installer...\"",
    `Invoke-WebRequest -UseBasicParsing -Uri ${powershellDoubleQuoted(`${serverUrl}/install-daemon.ps1`)} -OutFile $p`,
    `& $p -ServerUrl ${powershellDoubleQuoted(serverUrl)} ${credentialPart}${input.dataDir ? ` -DataDir ${powershellExpandableDoubleQuoted(input.dataDir)}` : ""}`
  ].join("; ");
  // Windows 连接命令面向 PowerShell 粘贴执行；保留脚本文本可读性，便于用户看到下载阶段错误。
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command ${powershellSingleQuotedArgument(script)}`;
}

function powershellExpandableDoubleQuoted(value: string): string {
  // DataDir 需要允许 $env:USERPROFILE 在目标 PowerShell 会话里展开，同时仍转义反引号和双引号。
  return `"${value.replace(/[`"]/g, (char) => `\`${char}`)}"`;
}

function powershellDoubleQuoted(value: string): string {
  // PowerShell 双引号内 `$`、反引号和 `"` 有特殊含义，生成命令时必须转义为字面量。
  return `"${value.replace(/[`"$]/g, (char) => `\`${char}`)}"`;
}

function powershellSingleQuotedArgument(value: string): string {
  // 外层 -Command 参数用单引号，避免在当前 PowerShell 会话里提前展开 `$p` 和 `$env`。
  return `'${value.replace(/'/g, "''")}'`;
}
