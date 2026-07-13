import test from "node:test";
import assert from "node:assert/strict";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { getUpstreamUrl, registerBridgeHandlers } from "./index.js";

test("getUpstreamUrl returns the CLI override when provided", () => {
  assert.equal(getUpstreamUrl(["--upstream-url", "http://example.com/mcp"]), "http://example.com/mcp");
});

test("getUpstreamUrl returns the configured default when no CLI override is provided", () => {
  const env = { MCP_UPSTREAM_URL: "http://configured.example/mcp" } as NodeJS.ProcessEnv;

  assert.equal(getUpstreamUrl([], env), "http://configured.example/mcp");
});

test("getUpstreamUrl throws when --upstream-url is missing its value", () => {
  assert.throws(() => getUpstreamUrl(["--upstream-url"]), /Missing value/);
});

test("registerBridgeHandlers forwards tool requests to the upstream client", async () => {
  const handlers = new Map<object, (request: { params: unknown }) => Promise<unknown>>();
  const listToolsParams = { cursor: "next-page" };
  const callToolParams = { name: "search_datasets", arguments: { query: "tram" } };

  let receivedListToolsParams: unknown;
  let receivedCallToolParams: unknown;

  const listToolsResult = { tools: [{ name: "search_datasets" }] };
  const callToolResult = { content: [{ type: "text", text: "ok" }] };

  const server = {
    setRequestHandler(schema: object, handler: (request: { params: unknown }) => Promise<unknown>) {
      handlers.set(schema, handler);
      return this;
    }
  } as unknown as Server;

  const client = {
    async listTools(params: unknown) {
      receivedListToolsParams = params;
      return listToolsResult;
    },
    async callTool(params: unknown) {
      receivedCallToolParams = params;
      return callToolResult;
    }
  } as unknown as Client;

  registerBridgeHandlers(server, client);

  const listToolsHandler = handlers.get(ListToolsRequestSchema);
  const callToolHandler = handlers.get(CallToolRequestSchema);

  assert.ok(listToolsHandler);
  assert.ok(callToolHandler);

  assert.deepEqual(await listToolsHandler({ params: listToolsParams }), listToolsResult);
  assert.deepEqual(receivedListToolsParams, listToolsParams);

  assert.deepEqual(await callToolHandler({ params: callToolParams }), callToolResult);
  assert.deepEqual(receivedCallToolParams, callToolParams);
});
