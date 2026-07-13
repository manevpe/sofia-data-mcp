# Sofia Data MCP

TypeScript MCP server, `stdio` bridge, and CLI client for the Sofia municipality urban data portal at `https://urbandata.sofia.bg`.

## Architecture

- Canonical server transport: Streamable HTTP
- Desktop compatibility transport: local `stdio` bridge that forwards to HTTP
- Local default endpoint: `http://127.0.0.1:3000/mcp`
- Source portal integration: CKAN Action API

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

## Notes

- Technical naming is English-only.
- CLI display text is bilingual and rendered as two lines with English first.
- Source metadata from the portal is preserved as published.
