#!/usr/bin/env node

import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { getCliConfig } from "@sofia-data/core";

interface ToolClient {
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<
    | { content: Array<{ type: string; [key: string]: unknown }> }
    | { toolResult: unknown }
  >;
}

interface CommandClient extends ToolClient {
  listTools(): Promise<{ tools: unknown[] }>;
}

if (isMainModule()) {
  await main();
}

async function main() {
  const serverUrl = getServerUrl(process.argv.slice(2));
  const client = new Client(
    { name: "sofia-data-cli", version: "0.1.0" },
    { capabilities: {} }
  );

  await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: {
      headers: {
        Accept: "application/json, text/event-stream"
      }
    }
  }) as never);

  const rl = createInterface({ input, output });

  printBilingual("Sofia Data CLI", "Sofia Data CLI");
  printBilingual("Type /help for commands", "Въведете /help за команди");

  let running = true;
  while (running) {
    const line = (await rl.question("> ")).trim();

    if (!line) {
      continue;
    }

    if (line === "/exit" || line === "/quit") {
      running = false;
      continue;
    }

    try {
      await handleCommand(client, line);
    } catch (error) {
      printBilingual("Request failed", "Заявката е неуспешна");
      console.error(error instanceof Error ? error.message : error);
    }
  }

  await client.close();
  rl.close();
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1]!)).href;
}

export async function handleCommand(client: CommandClient, line: string) {
  const [command, ...rest] = line.split(" ");
  const argument = rest.join(" ").trim();

  switch (command) {
    case "/help": {
      printBilingual("Available commands", "Налични команди");
      console.log("/tools");
      console.log("/search <query>");
      console.log("/dataset <id-or-name>");
      console.log("/group <id-or-name>");
      console.log("/organization <id-or-name>");
      console.log("/preview <datasetId> <resourceId>");
      console.log("/exit");
      return;
    }
    case "/tools": {
      const tools = await client.listTools();
      printBilingual("Registered tools", "Регистрирани инструменти");
      console.log(JSON.stringify(tools.tools, null, 2));
      return;
    }
    case "/search": {
      const result = await callTool(client, "search_datasets", { query: argument || undefined, rows: 10 });
      printBilingual("Search results", "Резултати от търсенето");
      console.log(result);
      return;
    }
    case "/dataset": {
      const result = await callTool(client, "get_dataset", { id: argument });
      printBilingual("Dataset details", "Детайли за набора от данни");
      console.log(result);
      return;
    }
    case "/group": {
      const result = await callTool(client, "get_group", { id: argument, includeDatasets: true });
      printBilingual("Group details", "Детайли за групата");
      console.log(result);
      return;
    }
    case "/organization": {
      const result = await callTool(client, "get_organization", { id: argument });
      printBilingual("Organization details", "Детайли за организацията");
      console.log(result);
      return;
    }
    case "/preview": {
      const [datasetId, resourceId] = rest;
      const result = await callTool(client, "preview_resource", { datasetId, resourceId });
      printBilingual("Resource preview", "Преглед на ресурс");
      console.log(result);
      return;
    }
    default: {
      printBilingual("Unknown command", "Непозната команда");
    }
  }
}

export async function callTool(client: ToolClient, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = "content" in result ? result.content : [];

  return content
    .map((item) => (item.type === "text" ? item.text : JSON.stringify(item)))
    .join("\n");
}

export function printBilingual(english: string, bulgarian: string) {
  console.log(english);
  console.log(bulgarian);
}

export function getServerUrl(args: string[], cliConfig = getCliConfig()) {
  const index = args.findIndex((entry) => entry === "--server-url");

  if (index >= 0) {
    const value = args[index + 1];
    if (!value) {
      throw new Error("Missing value for --server-url");
    }
    return value;
  }

  return cliConfig.serverUrl;
}
