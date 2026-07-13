// Full end-to-end smoke test against a *deployed* instance of the server
// (e.g. the live Cloud Run service), as opposed to the in-process HTTP
// tests in packages/http-server which spin up a local server.
//
// Deliberately skips itself (rather than failing) when E2E_BASE_URL isn't
// set, so `pnpm -r test` in normal CI runs never require network access or
// a live deployment. It's meant to be run explicitly, pointed at a real
// deployment:
//
//   E2E_BASE_URL=https://sofia-data-mcp-423850425424.europe-west1.run.app \
//     pnpm --filter @sofia-data/e2e test
//
// or via `pnpm test:e2e` at the repo root, which builds + runs this
// package with E2E_BASE_URL defaulted to the production Cloud Run URL.
import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.E2E_BASE_URL?.replace(/\/+$/, "");
const mcpPath = process.env.E2E_MCP_PATH ?? "/mcp";

if (!baseUrl) {
  test("e2e (skipped): set E2E_BASE_URL to run against a deployed instance", () => {
    console.log("Skipping e2e suite: E2E_BASE_URL is not set.");
  });
} else {
  test(`GET ${baseUrl}/health returns 200 with ok JSON`, async () => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });

  test("MCP client can initialize, list tools, and call search_datasets", async () => {
    const client = new Client(
      { name: "sofia-data-e2e", version: "0.1.0" },
      { capabilities: {} }
    );

    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}${mcpPath}`), {
        requestInit: {
          headers: {
            Accept: "application/json, text/event-stream"
          }
        }
      }) as never
    );

    try {
      const { tools } = await client.listTools();
      const toolNames = tools.map((tool) => tool.name);

      assert.ok(toolNames.length > 0, "expected at least one tool to be exposed");
      assert.ok(
        toolNames.includes("search_datasets"),
        `expected "search_datasets" among tools: ${toolNames.join(", ")}`
      );

      const result = await client.callTool({
        name: "search_datasets",
        arguments: { rows: 1 }
      });

      assert.ok(!result.isError, `search_datasets tool call failed: ${JSON.stringify(result)}`);

      const content = result.content;
      assert.ok(Array.isArray(content) && content.length > 0, "expected non-empty tool content");

      const [first] = content as Array<{ type: string; text?: string }>;
      assert.equal(first?.type, "text");
      assert.ok(first?.text, "expected tool result text");

      const parsed = JSON.parse(first.text as string) as { count: number; items: unknown[] };
      assert.equal(typeof parsed.count, "number");
      assert.ok(Array.isArray(parsed.items));
    } finally {
      await client.close();
    }
  });
}
