import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { getCoreConfig, getHttpServerConfig } from "@sofia-data/core";

import { createRequestListener } from "./index.js";

const testCoreConfig = getCoreConfig({
  SOFIA_CKAN_BASE_URL: "https://urbandata.sofia.bg",
  CACHE_TTL_MS: "0"
} as NodeJS.ProcessEnv);

const testServerConfig = getHttpServerConfig({
  HOST: "127.0.0.1",
  PORT: "0",
  MCP_HTTP_PATH: "/mcp"
} as NodeJS.ProcessEnv);

async function withTestServer(run: (baseUrl: string) => Promise<void>) {
  const server = createServer(createRequestListener(testCoreConfig, testServerConfig));

  await new Promise<void>((resolve, reject) => {
    server.listen(0, testServerConfig.host, () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://${testServerConfig.host}:${String(address.port)}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

test("GET /health returns 200 with ok JSON", async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test("GET /unknown-path returns 404", async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/unknown-path`);

    assert.equal(response.status, 404);
  });
});

test("OPTIONS to MCP path with an allowed origin returns 204 and CORS headers", async () => {
  await withTestServer(async (baseUrl) => {
    const origin = "http://localhost:5173";
    const response = await fetch(`${baseUrl}${testServerConfig.mcpPath}`, {
      method: "OPTIONS",
      headers: { Origin: origin }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  });
});

test("OPTIONS to MCP path with a disallowed origin returns 403", async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}${testServerConfig.mcpPath}`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.com" }
    });

    assert.equal(response.status, 403);
  });
});

test("non-OPTIONS requests to the MCP path with a disallowed origin return 403", async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}${testServerConfig.mcpPath}`, {
      method: "GET",
      headers: { Origin: "https://evil.example.com" }
    });

    assert.equal(response.status, 403);
    assert.equal(await response.text(), "Forbidden origin");
  });
});

test("GET /health with an allowed origin includes CORS headers", async () => {
  await withTestServer(async (baseUrl) => {
    const origin = "http://localhost:5173";
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: origin }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  });
});

test("GET /health without an origin omits CORS headers", async () => {
  await withTestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});
