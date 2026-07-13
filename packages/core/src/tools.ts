import { z } from "zod";

import { facetDatasets, findRelatedDatasets, summarizeDatasetWithPreview } from "./analytics.js";
import type { CoreConfig } from "./config.js";
import { CkanClient } from "./ckan-client.js";
import { normalizeDatasetDetails, normalizeDatasetSummary, normalizeGroup, normalizeOrganization } from "./normalize.js";
import { previewResource } from "./preview.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<unknown>;
}

export function createToolDefinitions(config: CoreConfig): ToolDefinition[] {
  const client = new CkanClient(config);

  return [
    {
      name: "search_datasets",
      description: "Search datasets in the Sofia urban data portal",
      inputSchema: z.object({
        query: z.string().optional(),
        group: z.string().optional(),
        organization: z.string().optional(),
        format: z.string().optional(),
        rows: z.number().int().min(1).max(config.maxSearchResults).optional(),
        start: z.number().int().min(0).optional()
      }),
      handler: async (input) => {
        const filters = z.object({
          query: z.string().optional(),
          group: z.string().optional(),
          organization: z.string().optional(),
          format: z.string().optional(),
          rows: z.number().int().min(1).max(config.maxSearchResults).optional(),
          start: z.number().int().min(0).optional()
        }).parse(input);

        const result = await client.searchDatasets(compactObject(filters));
        return {
          count: result.count,
          items: result.results.map((dataset) => normalizeDatasetSummary(dataset, config.ckanBaseUrl))
        };
      }
    },
    {
      name: "get_dataset",
      description: "Get a dataset by ID or name",
      inputSchema: z.object({ id: z.string().min(1) }),
      handler: async (input) => {
        const { id } = z.object({ id: z.string().min(1) }).parse(input);
        return normalizeDatasetDetails(await client.getDataset(id), config.ckanBaseUrl);
      }
    },
    {
      name: "list_groups",
      description: "List dataset groups",
      inputSchema: z.object({}),
      handler: async () => ({ groups: await client.listGroups() })
    },
    {
      name: "get_group",
      description: "Get a group by ID or name",
      inputSchema: z.object({ id: z.string().min(1), includeDatasets: z.boolean().optional() }),
      handler: async (input) => {
        const { id, includeDatasets = false } = z.object({ id: z.string().min(1), includeDatasets: z.boolean().optional() }).parse(input);
        return normalizeGroup(await client.getGroup(id, includeDatasets), config.ckanBaseUrl, includeDatasets);
      }
    },
    {
      name: "list_organizations",
      description: "List publishing organizations",
      inputSchema: z.object({}),
      handler: async () => ({ organizations: await client.listOrganizations() })
    },
    {
      name: "get_organization",
      description: "Get an organization by ID or name",
      inputSchema: z.object({ id: z.string().min(1) }),
      handler: async (input) => {
        const { id } = z.object({ id: z.string().min(1) }).parse(input);
        return normalizeOrganization(await client.getOrganization(id));
      }
    },
    {
      name: "list_dataset_resources",
      description: "List resources for a dataset",
      inputSchema: z.object({ id: z.string().min(1) }),
      handler: async (input) => {
        const { id } = z.object({ id: z.string().min(1) }).parse(input);
        const dataset = normalizeDatasetDetails(await client.getDataset(id), config.ckanBaseUrl);
        return dataset.resources;
      }
    },
    {
      name: "preview_resource",
      description: "Preview a dataset resource when the format is text-friendly",
      inputSchema: z.object({ datasetId: z.string().min(1), resourceId: z.string().min(1) }),
      handler: async (input) => {
        const { datasetId, resourceId } = z.object({ datasetId: z.string().min(1), resourceId: z.string().min(1) }).parse(input);
        const dataset = normalizeDatasetDetails(await client.getDataset(datasetId), config.ckanBaseUrl);
        const resource = dataset.resources.find((entry) => entry.id === resourceId);

        if (!resource) {
          throw new Error(`Resource not found: ${resourceId}`);
        }

        return previewResource(resource, config);
      }
    },
    {
      name: "summarize_dataset",
      description: "Summarize a dataset including formats, external hosts, and inferred data meaning when available",
      inputSchema: z.object({ id: z.string().min(1) }),
      handler: async (input) => {
        const { id } = z.object({ id: z.string().min(1) }).parse(input);
        const dataset = normalizeDatasetDetails(await client.getDataset(id), config.ckanBaseUrl);
        const previewableResource = dataset.resources.find((resource) => resource.canPreview);
        const preview = previewableResource ? await previewResource(previewableResource, config) : null;
        return summarizeDatasetWithPreview(dataset, preview);
      }
    },
    {
      name: "find_related_datasets",
      description: "Find related datasets by shared groups, tags, publisher, and formats",
      inputSchema: z.object({ id: z.string().min(1), limit: z.number().int().min(1).max(10).optional() }),
      handler: async (input) => {
        const { id, limit = 5 } = z.object({ id: z.string().min(1), limit: z.number().int().min(1).max(10).optional() }).parse(input);
        const [target, search] = await Promise.all([
          client.getDataset(id),
          client.searchDatasets({ rows: config.maxSearchResults })
        ]);

        const targetDataset = normalizeDatasetDetails(target, config.ckanBaseUrl);
        const candidates = search.results.map((dataset) => normalizeDatasetSummary(dataset, config.ckanBaseUrl));
        return findRelatedDatasets(targetDataset, candidates, limit);
      }
    },
    {
      name: "facet_datasets",
      description: "Return catalog-wide counts grouped by group, organization, format, and license, computed by CKAN across all matching datasets (not just a page of results)",
      inputSchema: z.object({ query: z.string().optional() }),
      handler: async (input) => {
        const { query } = z.object({ query: z.string().optional() }).parse(input);
        const { count, facets } = await client.getFacets(query);
        return { count, ...facetDatasets(facets) };
      }
    }
  ];
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
