# Sofia Data MCP

TypeScript MCP server, `stdio` bridge, and CLI client for the Sofia municipality urban data portal at `https://urbandata.sofia.bg`.

## Architecture

- Canonical server transport: Streamable HTTP
- Desktop compatibility transport: local `stdio` bridge that forwards to HTTP
- Local default endpoint: `http://127.0.0.1:3000/mcp`
- Source portal integration: CKAN Action API

## Connect an MCP Client

The deployed server is public, requires no auth, and speaks Streamable HTTP
at:

```text
https://sofia-data-mcp-423850425424.europe-west1.run.app/mcp
```

### Clients with native remote/HTTP MCP support (recommended)

**VS Code (Copilot Chat)** — add to `.vscode/mcp.json` in your project (or
your user `mcp.json` via the MCP: Open User Configuration command):

```json
{
  "servers": {
    "sofia-data": {
      "type": "http",
      "url": "https://sofia-data-mcp-423850425424.europe-west1.run.app/mcp"
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sofia-data": {
      "url": "https://sofia-data-mcp-423850425424.europe-west1.run.app/mcp"
    }
  }
}
```

### Clients that only support local `stdio` servers (e.g. Claude Desktop)

Claude Desktop's `claude_desktop_config.json` only launches local processes,
so bridge to the remote HTTP endpoint with the widely-used `mcp-remote`
adapter (no install/build required, runs via `npx`):

```json
{
  "mcpServers": {
    "sofia-data": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://sofia-data-mcp-423850425424.europe-west1.run.app/mcp"
      ]
    }
  }
}
```

Alternatively, this repo's own `@sofia-data/stdio-bridge` package works the
same way — point it at the deployed URL instead of running the server
locally:

```bash
pnpm --filter @sofia-data/stdio-bridge dev -- \
  --upstream-url https://sofia-data-mcp-423850425424.europe-west1.run.app/mcp
```

### Quick smoke test (no client needed)

```bash
curl -s https://sofia-data-mcp-423850425424.europe-west1.run.app/health
```

## Packages

- `@sofia-data/core`: shared CKAN client, normalization, analytics, and MCP tool definitions
- `@sofia-data/http-server`: HTTP MCP server
- `@sofia-data/stdio-bridge`: `stdio` bridge to an HTTP MCP server
- `@sofia-data/cli`: bilingual CLI client

## Requirements

- Node.js 20+
- Corepack available

## Install

```bash
corepack enable
corepack prepare pnpm@10.8.1 --activate
pnpm install
```

## Build

```bash
pnpm build
```

## Run Locally

Start the HTTP server:

```bash
pnpm dev:server
```

Default endpoint:

```text
http://127.0.0.1:3000/mcp
```

Run the CLI:

```bash
pnpm dev:cli
```

Run the `stdio` bridge:

```bash
pnpm dev:bridge
```

Override the bridge upstream URL:

```bash
pnpm --filter @sofia-data/stdio-bridge dev -- --upstream-url http://127.0.0.1:3000/mcp
```

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build
```

## End-to-End Tests

`packages/e2e` runs a full black-box smoke test against a *deployed*
instance (health check, MCP `initialize` handshake, `listTools`, and a real
`search_datasets` call) — distinct from `packages/http-server`'s unit tests,
which spin up a local in-process server. It's skipped automatically (not
failed) when no target is given, so it never affects normal `pnpm test`/CI:

```bash
E2E_BASE_URL=https://sofia-data-mcp-423850425424.europe-west1.run.app pnpm test:e2e
```

This also runs automatically as a post-deploy gate in
`.github/workflows/deploy.yml`, against the URL of the revision that was
just deployed.

## Deploying to Google Cloud Run

See [`deploy/gcp/README.md`](deploy/gcp/README.md) for scripts that deploy
`http-server` to Cloud Run (capped at 1 instance) with an automated budget
kill-switch that scales the service to zero if spend reaches a configured
threshold (default $2).

## Environment Variables

Copy `.env.example` and adjust as needed.

Key values:

- `SOFIA_CKAN_BASE_URL`
- `HOST`
- `PORT`
- `MCP_HTTP_PATH`
- `REQUEST_TIMEOUT_MS=30000`
- `PREVIEW_MAX_BYTES=262144`
- `MAX_SEARCH_RESULTS=50`
- `CACHE_TTL_MS=300000` — in-memory TTL cache for CKAN reads (groups, organizations, search results, dataset lookups). Set to `0` to disable caching.
- `ALLOWED_HOSTS` / `ALLOWED_ORIGINS` — comma-separated extra hostnames/origins (beyond `127.0.0.1`/`localhost`) allowed to reach the MCP endpoint. Required when deploying publicly (e.g. Cloud Run) so the server's own DNS-rebinding/CORS protection doesn't reject requests to its own public hostname. Left unset, the server only accepts local traffic.
- `MCP_UPSTREAM_URL`
- `MCP_SERVER_URL`

## Tools

- `search_datasets`
- `get_dataset`
- `list_groups`
- `get_group`
- `list_organizations`
- `get_organization`
- `list_dataset_resources`
- `preview_resource`
- `summarize_dataset`
- `find_related_datasets`
- `facet_datasets` — returns catalog-wide counts (group/organization/format/license) computed by CKAN's native faceting, not a client-side count over a capped page of results

## Dataset Metadata Enrichment

Dataset summaries include a `semanticProfile` field generated **generically** from CKAN
metadata alone (groups, tags, resource formats) — there is no per-dataset hardcoded
knowledge to maintain, so it scales automatically as datasets are added or renamed on the
portal. For exact field-level structure, use `summarize_dataset` or `preview_resource`,
which parse an actual sampled resource (JSON/GeoJSON) to report real geometry types and
property/field names.

Group names that were corrupted by a source-side Cyrillic transliteration/encoding bug
(e.g. `bnopa3hoo6pa3ne`) are automatically repaired using a generic transliteration of the
group's `title`, rather than a hardcoded name-to-name mapping.

## Testing

Each package has a unit test suite using Node's built-in test runner:

```bash
pnpm test
```

CI runs `pnpm build`, `pnpm check` (typecheck), and `pnpm test` on every push/PR to `main`
(see `.github/workflows/ci.yml`).

## Automated dependency updates

Dependabot (`.github/dependabot.yml`) checks weekly for updates to npm/pnpm packages,
GitHub Actions, and the Docker base image, grouping patch/minor updates into a single PR
per ecosystem. `.github/workflows/dependabot-auto-merge.yml` automatically approves and
enables auto-merge for patch/minor version PRs; the merge only completes once the
required `build-and-test` CI check passes on that PR (enforced by branch protection on
`main`). Major version bumps are left for manual review.

## Notes

- Technical naming is English-only.
- CLI display text is bilingual and rendered as two lines with English first.
- Source metadata from the portal is preserved as published.
