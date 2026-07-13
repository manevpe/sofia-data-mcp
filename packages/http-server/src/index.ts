import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { createToolDefinitions, getCoreConfig, getHttpServerConfig, type CoreConfig } from "@sofia-data/core";

type HttpServerConfig = ReturnType<typeof getHttpServerConfig>;
type CorsHeaders = ReturnType<typeof getCorsHeaders>;

export function createRequestListener(coreConfig: CoreConfig, serverConfig: HttpServerConfig) {
  const allowedHosts = [
    "127.0.0.1",
    "localhost",
    `127.0.0.1:${String(serverConfig.port)}`,
    `localhost:${String(serverConfig.port)}`
  ];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const corsHeaders = getCorsHeaders(req.headers.origin);
    applyCorsHeaders(res, corsHeaders);

    if (!req.url) {
      res.writeHead(400, corsHeaders).end("Missing request URL");
      return;
    }

    if (req.method === "OPTIONS") {
      if (req.headers.origin && !corsHeaders) {
        res.writeHead(403).end("Forbidden origin");
        return;
      }

      res.writeHead(204, corsHeaders).end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? `${serverConfig.host}:${serverConfig.port}`}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { ...corsHeaders, "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname !== serverConfig.mcpPath) {
      res.writeHead(404, corsHeaders).end("Not found");
      return;
    }

    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      res.writeHead(403).end("Forbidden origin");
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      enableDnsRebindingProtection: true,
      allowedHosts
    });
    const server = createMcpServer(coreConfig);

    try {
      await server.connect(transport as never);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        res.writeHead(500, corsHeaders).end("Internal server error");
      }
    } finally {
      await server.close();
    }
  };
}

function createMcpServer(coreConfig: CoreConfig) {
  const server = new McpServer(
    { name: "sofia-data-mcp", version: "0.1.0" },
    {
      capabilities: {
        tools: {}
      },
      instructions: "Use the tools to query Sofia municipality open urban data from the CKAN portal."
    }
  );

  for (const tool of createToolDefinitions(coreConfig)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema as z.ZodTypeAny
      },
      async (args: unknown) => {
        const result = await tool.handler(args ?? {});

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }
    );
  }

  return server;
}

function isAllowedOrigin(origin: string) {
  if (origin === "null") {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return ["127.0.0.1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function getCorsHeaders(origin: string | undefined) {
  if (!origin || !isAllowedOrigin(origin)) {
    return undefined;
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id"
  };
}

function applyCorsHeaders(res: ServerResponse, headers: CorsHeaders) {
  if (!headers) {
    return;
  }

  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const coreConfig = getCoreConfig();
  const serverConfig = getHttpServerConfig();
  const httpServer = createServer(createRequestListener(coreConfig, serverConfig));

  httpServer.listen(serverConfig.port, serverConfig.host, () => {
    console.error(`HTTP MCP server listening on http://${serverConfig.host}:${serverConfig.port}${serverConfig.mcpPath}`);
  });
}
