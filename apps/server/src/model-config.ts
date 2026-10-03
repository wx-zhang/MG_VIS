export interface ModelEndpointConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export function firstEnv(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function modelEndpointConfigFromEnv(env: NodeJS.ProcessEnv, options: {
  prefix: string;
  defaultModel: string;
}): ModelEndpointConfig {
  const model = firstEnv(env[`${options.prefix}_MODEL`], env.TYR_MODEL_DEFAULT) ?? options.defaultModel;
  return {
    model,
    apiKey: firstEnv(env[`${options.prefix}_API_KEY`], env.TYR_MODEL_API_KEY, env.QWEN_API_KEY, env.OPENAI_API_KEY),
    baseUrl: firstEnv(env[`${options.prefix}_BASE_URL`], env.TYR_MODEL_BASE_URL, env.QWEN_BASE_URL, env.OPENAI_BASE_URL)
  };
}
