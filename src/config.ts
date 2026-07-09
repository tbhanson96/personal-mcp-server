export type AppConfig = {
  port: number;
  bindAddress: string;
  mcpApiKey: string;
  publicUrl: string;
  oauth: OAuthConfig;
  homeAssistant?: ServiceConfig;
  homeserver?: ServiceConfig;
  mealie?: ServiceConfig;
  vikunja?: ServiceConfig;
};

export type OAuthConfig = {
  issuer: string;
  loginCode: string;
  tokenSigningSecret: string;
  accessTokenTtlSeconds: number;
};

export type ServiceConfig = {
  baseUrl: string;
  token?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mcpApiKey = required(env, 'PERSONAL_MCP_API_KEY');
  const publicUrl = (env.MCP_PUBLIC_URL || 'https://timbhanson.com/mcp').replace(/\/+$/, '');
  const defaultIssuer = new URL(publicUrl).origin;

  return {
    port: intEnv(env.PORT, 3000),
    bindAddress: env.BIND_ADDRESS || '0.0.0.0',
    mcpApiKey,
    publicUrl,
    oauth: {
      issuer: (env.MCP_OAUTH_ISSUER || defaultIssuer).replace(/\/+$/, ''),
      loginCode: env.MCP_OAUTH_LOGIN_CODE || mcpApiKey,
      tokenSigningSecret: env.MCP_OAUTH_SIGNING_SECRET || mcpApiKey,
      accessTokenTtlSeconds: intEnv(env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS, 3600),
    },
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
