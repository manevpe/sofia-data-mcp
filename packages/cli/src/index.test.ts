import test from "node:test";
import assert from "node:assert/strict";

import { getCliConfig } from "@sofia-data/core";

import { callTool, getServerUrl, handleCommand } from "./index.js";

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

class MockClient {
  listToolsCalls = 0;
  toolCalls: ToolCall[] = [];
  tools = [{ name: "search_datasets" }, { name: "get_dataset" }];
  toolResultContent: Array<{ type: string; [key: string]: unknown }> = [{ type: "text", text: "mock-result" }];

  async listTools() {
    this.listToolsCalls += 1;
    return { tools: this.tools };
  }

  async callTool(request: ToolCall) {
    this.toolCalls.push(request);
    return { content: this.toolResultContent, toolResult: null };
  }
}

async function captureConsoleLogs(callback: (messages: string[]) => Promise<void> | void) {
  const originalLog = console.log;
  const messages: string[] = [];

  console.log = (...args: unknown[]) => {
    messages.push(args.map((value) => String(value)).join(" "));
  };

  try {
    await callback(messages);
  } finally {
    console.log = originalLog;
  }
}

test("/tools lists registered tools", async () => {
  const client = new MockClient();

  await captureConsoleLogs(async (messages) => {
    await handleCommand(client, "/tools");

    assert.equal(client.listToolsCalls, 1);
    assert.ok(messages.includes("Registered tools"));
    assert.ok(messages.includes("Регистрирани инструменти"));
    assert.ok(messages.some((message) => message.includes('"name": "search_datasets"')));
  });
});

test("/search calls search_datasets with the provided query", async () => {
  const client = new MockClient();

  await captureConsoleLogs(async () => {
    await handleCommand(client, "/search bus lanes");
  });

  assert.deepEqual(client.toolCalls, [
    { name: "search_datasets", arguments: { query: "bus lanes", rows: 10 } }
  ]);
});

test("/dataset calls get_dataset with the provided id", async () => {
  const client = new MockClient();

  await captureConsoleLogs(async () => {
    await handleCommand(client, "/dataset transport-data");
  });

  assert.deepEqual(client.toolCalls, [
    { name: "get_dataset", arguments: { id: "transport-data" } }
  ]);
});

test("/preview calls preview_resource with dataset and resource ids", async () => {
  const client = new MockClient();

  await captureConsoleLogs(async () => {
    await handleCommand(client, "/preview dataset-123 resource-456");
  });

  assert.deepEqual(client.toolCalls, [
    { name: "preview_resource", arguments: { datasetId: "dataset-123", resourceId: "resource-456" } }
  ]);
});

test("unknown commands print a bilingual error without calling tools", async () => {
  const client = new MockClient();

  await captureConsoleLogs(async (messages) => {
    await handleCommand(client, "/bogus");

    assert.deepEqual(client.toolCalls, []);
    assert.ok(messages.includes("Unknown command"));
    assert.ok(messages.includes("Непозната команда"));
  });
});

test("callTool joins text content and stringifies non-text parts", async () => {
  const client = new MockClient();
  client.toolResultContent = [
    { type: "text", text: "first line" },
    { type: "text", text: "second line" },
    { type: "resource_link", uri: "https://example.com/resource" }
  ];

  const result = await callTool(client, "preview_resource", { datasetId: "dataset-1", resourceId: "resource-1" });

  assert.equal(
    result,
    'first line\nsecond line\n{"type":"resource_link","uri":"https://example.com/resource"}'
  );
});

test("getServerUrl prefers --server-url over config", () => {
  assert.equal(
    getServerUrl(["--server-url", "http://localhost:4321/mcp"]),
    "http://localhost:4321/mcp"
  );
});

test("getServerUrl falls back to the CLI config default", () => {
  const cliConfig = getCliConfig();

  assert.equal(getServerUrl([]), cliConfig.serverUrl);
});
