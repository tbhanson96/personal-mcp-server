export type AppConfig = {
  port: number;
  bindAddress: string;
  mcpApiKey: string;
  homeAssistant?: ServiceConfig;
  homeserver?: ServiceConfig;
  mealie?: ServiceConfig;
  vikunja?: ServiceConfig;
};

export type ServiceConfig = {
  baseUrl: string;
  token?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mcpApiKey = required(env, 'PERSONAL_MCP_API_KEY');

  return {
    port: intEnv(env.PORT, 3000),
    bindAddress: env.BIND_ADDRESS || '0.0.0.0',
    mcpApiKey,
    homeAssistant: serviceConfig(env.HOME_ASSISTANT_URL, env.HOME_ASSISTANT_TOKEN),
    homeserver: serviceConfig(env.HOMESERVER_URL, env.HOMESERVER_API_KEY),
    mealie: serviceConfig(env.MEALIE_URL, env.MEALIE_TOKEN),
    vikunja: serviceConfig(env.VIKUNJA_URL, env.VIKUNJA_TOKEN),
  };
}

function serviceConfig(baseUrl?: string, token?: string): ServiceConfig | undefined {
  if (!baseUrl) {
    return undefined;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
  };
}

function intEnv(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer env var, got: ${value}`);
  }

  return parsed;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }

  return value;
}
