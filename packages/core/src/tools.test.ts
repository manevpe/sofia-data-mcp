import test from "node:test";
import assert from "node:assert/strict";

import { createToolDefinitions } from "./tools.js";
import { getCoreConfig } from "./config.js";
import type { CkanDataset, CkanNamedEntity } from "./ckan-types.js";

function makeConfig() {
  return getCoreConfig({
    SOFIA_CKAN_BASE_URL: "https://urbandata.sofia.bg",
    CACHE_TTL_MS: "0" // disable caching so each test controls every request deterministically
  } as NodeJS.ProcessEnv);
}

function sampleDataset(overrides: Partial<CkanDataset> = {}): CkanDataset {
  return {
    id: "dataset-1",
    name: "sample-dataset",
    title: "Sample Dataset",
    notes: "A sample dataset for testing.",
    license_title: "CC-BY",
    organization: { id: "org-1", name: "transport-dept", title: "Transport Department" },
    groups: [{ id: "g-1", name: "transport", title: "Transport" }],
    tags: [{ name: "buses" }],
    resources: [
      { id: "res-1", name: "data.json", format: "JSON", url: "https://example.com/data.json" }
    ],
    ...overrides
  };
}

/**
 * Installs a mock `fetch` that answers CKAN Action API requests based on
 * the `action` path segment (e.g. package_search, package_show), so each
 * tool handler can be exercised without hitting the real network.
 */
function mockCkanFetch(handlers: Record<string, (url: URL) => unknown>) {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof URL ? input.toString() : String(input));

    if (url.pathname.startsWith("/api/3/action/")) {
      const action = url.pathname.replace("/api/3/action/", "");
      const handler = handlers[action];

      if (!handler) {
        throw new Error(`Unhandled CKAN action in test: ${action}`);
      }

      const result = handler(url);
      return new Response(JSON.stringify({ success: true, result }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    // Resource preview fetches go straight to a resource URL, not the action API.
    const handler = handlers[url.pathname];
    if (handler) {
      const result = handler(url);
      return new Response(typeof result === "string" ? result : JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unhandled fetch in test: ${url.toString()}`);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

function getTool(config: ReturnType<typeof makeConfig>, name: string) {
  const tool = createToolDefinitions(config).find((entry) => entry.name === name);
  assert.ok(tool, `tool ${name} should be registered`);
  return tool!;
}

test("search_datasets returns normalized items and count", async () => {
  const restore = mockCkanFetch({
    package_search: () => ({ count: 1, results: [sampleDataset()] })
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "search_datasets");
    const result = await tool.handler({ query: "buses" }) as { count: number; items: Array<{ name: string }> };

    assert.equal(result.count, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.name, "sample-dataset");
  } finally {
    restore();
  }
});

test("get_dataset returns full normalized dataset details", async () => {
  const restore = mockCkanFetch({
    package_show: () => sampleDataset()
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "get_dataset");
    const result = await tool.handler({ id: "sample-dataset" }) as { name: string; resources: unknown[] };

    assert.equal(result.name, "sample-dataset");
    assert.equal(result.resources.length, 1);
  } finally {
    restore();
  }
});

test("list_groups returns friendly group names derived from group_list", async () => {
  const restore = mockCkanFetch({
    group_list: () => [
      { id: "g-1", name: "transport", title: "Transport" } satisfies CkanNamedEntity,
      { id: "g-2", name: "bnopa3hoo6pa3ne", title: "биоразнообразие" } satisfies CkanNamedEntity
    ]
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "list_groups");
    const result = await tool.handler({}) as { groups: string[] };

    assert.deepEqual(result.groups, ["transport", "bioraznoobrazie"]);
  } finally {
    restore();
  }
});

test("get_group resolves a friendly group name back to the raw CKAN slug", async () => {
  let requestedGroupId: string | undefined;

  const restore = mockCkanFetch({
    group_list: () => [{ id: "g-2", name: "bnopa3hoo6pa3ne", title: "биоразнообразие" } satisfies CkanNamedEntity],
    group_show: (url) => {
      requestedGroupId = url.searchParams.get("id") ?? undefined;
      return { id: "g-2", name: "bnopa3hoo6pa3ne", title: "биоразнообразие", package_count: 2 };
    }
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "get_group");
    const result = await tool.handler({ id: "bioraznoobrazie" }) as { name: string };

    assert.equal(requestedGroupId, "bnopa3hoo6pa3ne");
    assert.equal(result.name, "bioraznoobrazie");
  } finally {
    restore();
  }
});

test("list_organizations returns the raw organization name list", async () => {
  const restore = mockCkanFetch({
    organization_list: () => ["transport-dept", "environment-dept"]
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "list_organizations");
    const result = await tool.handler({}) as { organizations: string[] };

    assert.deepEqual(result.organizations, ["transport-dept", "environment-dept"]);
  } finally {
    restore();
  }
});

test("get_organization returns normalized organization details", async () => {
  const restore = mockCkanFetch({
    organization_show: () => ({ id: "org-1", name: "transport-dept", title: "Transport Department", package_count: 5 })
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "get_organization");
    const result = await tool.handler({ id: "transport-dept" }) as { title: string; packageCount: number };

    assert.equal(result.title, "Transport Department");
    assert.equal(result.packageCount, 5);
  } finally {
    restore();
  }
});

test("list_dataset_resources returns just the resource list", async () => {
  const restore = mockCkanFetch({
    package_show: () => sampleDataset()
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "list_dataset_resources");
    const result = await tool.handler({ id: "sample-dataset" }) as Array<{ id: string }>;

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "res-1");
  } finally {
    restore();
  }
});

test("preview_resource errors clearly when the resource id doesn't exist", async () => {
  const restore = mockCkanFetch({
    package_show: () => sampleDataset()
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "preview_resource");
    await assert.rejects(
      () => tool.handler({ datasetId: "sample-dataset", resourceId: "does-not-exist" }),
      /Resource not found/
    );
  } finally {
    restore();
  }
});

test("preview_resource returns preview text for a JSON resource", async () => {
  const restore = mockCkanFetch({
    package_show: () => sampleDataset(),
    "/data.json": () => ({ hello: "world" })
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "preview_resource");
    const result = await tool.handler({ datasetId: "sample-dataset", resourceId: "res-1" }) as { status: string; previewText?: string };

    assert.equal(result.status, "preview");
    assert.match(result.previewText ?? "", /hello/);
  } finally {
    restore();
  }
});

test("summarize_dataset includes a generic semantic profile and format breakdown", async () => {
  const restore = mockCkanFetch({
    package_show: () => sampleDataset(),
    "/data.json": () => ({ hello: "world" })
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "summarize_dataset");
    const result = await tool.handler({ id: "sample-dataset" }) as { formats: Record<string, number>; semanticProfile?: { category: string } };

    assert.equal(result.formats.JSON, 1);
    assert.equal(result.semanticProfile?.category, "transport");
  } finally {
    restore();
  }
});

test("find_related_datasets scores candidates sharing groups/tags/formats higher", async () => {
  const target = sampleDataset({ id: "target", name: "target-dataset" });
  const related = sampleDataset({ id: "related", name: "related-dataset", title: "Related Dataset" });
  const unrelated = sampleDataset({
    id: "unrelated",
    name: "unrelated-dataset",
    title: "Unrelated Dataset",
    groups: [{ id: "g-2", name: "housing", title: "Housing" }],
    tags: [{ name: "zoning" }],
    resources: [{ id: "res-2", name: "data.pdf", format: "PDF", url: "https://example.com/data.pdf" }]
  });

  const restore = mockCkanFetch({
    package_show: () => target,
    package_search: () => ({ count: 2, results: [related, unrelated] })
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "find_related_datasets");
    const result = await tool.handler({ id: "target" }) as Array<{ dataset: { name: string }; score: number }>;

    assert.equal(result[0]?.dataset.name, "related-dataset");
    assert.ok((result[0]?.score ?? 0) > 0);
  } finally {
    restore();
  }
});

test("facet_datasets returns CKAN's native facet counts, not a client-side page count", async () => {
  const restore = mockCkanFetch({
    package_search: (url) => {
      assert.equal(url.searchParams.get("rows"), "0");
      assert.ok(url.searchParams.get("facet.field"));
      return {
        count: 120,
        results: [],
        search_facets: {
          groups: { items: [{ name: "transport", display_name: "Transport", count: 42 }] },
          organization: { items: [{ name: "transport-dept", display_name: "Transport Department", count: 10 }] },
          res_format: { items: [{ name: "GEOJSON", count: 30 }] },
          license_id: { items: [{ name: "cc-by", display_name: "CC-BY", count: 120 }] }
        }
      };
    }
  });

  try {
    const config = makeConfig();
    const tool = getTool(config, "facet_datasets");
    const result = await tool.handler({}) as {
      count: number;
      groups: Record<string, number>;
      organizations: Record<string, number>;
      formats: Record<string, number>;
      licenses: Record<string, number>;
    };

    assert.equal(result.count, 120);
    assert.equal(result.groups.Transport, 42);
    assert.equal(result.organizations["Transport Department"], 10);
    assert.equal(result.formats.GEOJSON, 30);
    assert.equal(result.licenses["CC-BY"], 120);
  } finally {
    restore();
  }
});
