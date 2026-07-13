#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { getBridgeConfig } from "@sofia-data/core";

export function registerBridgeHandlers(server: Server, client: Client) {
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return client.listTools(request.params);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return client.callTool(request.params);
  });
}

export function getUpstreamUrl(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const configured = getBridgeConfig(env);
  const index = args.findIndex((entry) => entry === "--upstream-url");

  if (index >= 0) {
    const value = args[index + 1];
    if (!value) {
      throw new Error("Missing value for --upstream-url");
    }
    return value;
  }

  return configured.upstreamUrl;
}

async function main() {
  const upstreamUrl = getUpstreamUrl(process.argv.slice(2));
  const transport = new StdioServerTransport();
  const server = new Server(
    { name: "sofia-data-bridge", version: "0.1.0" },
    {
      capabilities: {
        tools: {}
      },
      instructions: "Bridge MCP requests from stdio clients to an upstream HTTP MCP server."
    }
  );

  const client = new Client(
    { name: "sofia-data-bridge-client", version: "0.1.0" },
    {
      capabilities: {}
    }
  );

  const upstreamTransport = new StreamableHTTPClientTransport(new URL(upstreamUrl), {
    requestInit: {
      headers: {
        Accept: "application/json, text/event-stream"
      }
    }
  });

  await client.connect(upstreamTransport as never);
  registerBridgeHandlers(server, client);
  await server.connect(transport as never);

  process.on("SIGINT", async () => {
    await Promise.allSettled([server.close(), client.close()]);
    process.exit(0);
  });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
