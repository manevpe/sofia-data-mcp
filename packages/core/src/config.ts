export interface CoreConfig {
  ckanBaseUrl: string;
  requestTimeoutMs: number;
  previewMaxBytes: number;
  maxSearchResults: number;
  userAgent: string;
  cacheTtlMs: number;
}

export const DEFAULT_HTTP_PATH = "/mcp";

export function getCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  return {
    ckanBaseUrl: env.SOFIA_CKAN_BASE_URL ?? "https://urbandata.sofia.bg",
    requestTimeoutMs: toNumber(env.REQUEST_TIMEOUT_MS, 30_000),
    previewMaxBytes: toNumber(env.PREVIEW_MAX_BYTES, 262_144),
    maxSearchResults: toNumber(env.MAX_SEARCH_RESULTS, 50),
    userAgent: env.USER_AGENT ?? "sofia-data-mcp/0.1.0",
    cacheTtlMs: toNumber(env.CACHE_TTL_MS, 300_000)
  };
}

export function getHttpServerConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    host: env.HOST ?? "127.0.0.1",
    port: toNumber(env.PORT, 3000),
    mcpPath: env.MCP_HTTP_PATH ?? DEFAULT_HTTP_PATH
  };
}

export function getBridgeConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    upstreamUrl: env.MCP_UPSTREAM_URL ?? "http://127.0.0.1:3000/mcp",
    upstreamTimeoutMs: toNumber(env.MCP_UPSTREAM_TIMEOUT_MS, 30_000)
  };
}

export function getCliConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    serverUrl: env.MCP_SERVER_URL ?? "http://127.0.0.1:3000/mcp",
    requestTimeoutMs: toNumber(env.CLI_REQUEST_TIMEOUT_MS, 30_000)
  };
}

function toNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
