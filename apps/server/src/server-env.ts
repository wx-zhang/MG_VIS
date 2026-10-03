import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ServerEnvMode = "development" | "production";

export function serverEnvMode(env: NodeJS.ProcessEnv = process.env): ServerEnvMode {
  return env.NODE_ENV === "production" ? "production" : "development";
}

export function loadServerEnvFiles(
  env: NodeJS.ProcessEnv,
  options: { rootDir: string; mode?: ServerEnvMode }
): string[] {
  const mode = options.mode ?? serverEnvMode(env);
  const candidates = [
    path.join(options.rootDir, `.env.${mode}.example`),
    path.join(options.rootDir, `.env.${mode}`)
  ];
  const loaded: string[] = [];
  const fileEnv: Record<string, string> = {};
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    Object.assign(fileEnv, parseEnvFile(filePath));
    loaded.push(filePath);
  }
  for (const [key, value] of Object.entries(fileEnv)) {
    // 启动器或 PM2 显式注入的环境变量是最终真源，env 文件只补缺省值。
    if (env[key] === undefined) env[key] = value;
  }
  return loaded;
}

export function resolveServerEnvPath(value: string | undefined, rootDir: string, fallbackRelative: string): string {
  const raw = value?.trim() || fallbackRelative;
  // env 文件里的相对路径是项目配置语义，固定从仓库根目录解析，避免 pnpm filter 的 cwd 漂移。
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
}

export function agentLongTermMemoryMode(env: NodeJS.ProcessEnv = process.env): "enabled" | "disabled" {
  const value = env.TYR_AGENT_LONG_TERM_MEMORY?.trim() || "enabled";
  if (value === "enabled" || value === "disabled") return value;
  // 记忆开关属于数据边界，配置拼写错误时必须阻止启动，不能静默恢复为启用。
  throw new Error(`Invalid TYR_AGENT_LONG_TERM_MEMORY: ${value}`);
}

export function bootstrapSeedMode(env: NodeJS.ProcessEnv = process.env): "default" | "none" {
  const value = env.TYR_BOOTSTRAP_SEED?.trim() || "default";
  if (value === "default" || value === "none") return value;
  // Seed mode controls the initial tenant boundary; a typo must never create demo data implicitly.
  throw new Error(`Invalid TYR_BOOTSTRAP_SEED: ${value}`);
}

function parseEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = assignment.indexOf("=");
    if (eq <= 0) continue;
    const key = assignment.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = unquoteEnvValue(assignment.slice(eq + 1).trim());
  }
  return env;
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
