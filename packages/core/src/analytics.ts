import type { CkanSearchFacets } from "./ckan-types.js";
import type { DatasetDetails, DatasetSchemaPreview, DatasetSummary, DatasetSummaryReport, FacetResult, RelatedDataset, ResourcePreview } from "./models.js";

export function summarizeDataset(dataset: DatasetDetails): DatasetSummaryReport {
  const formats = count(dataset.resources.map((resource) => resource.format));
  const externalHosts = [...new Set(dataset.resources.map((resource) => resource.host).filter(Boolean))];

  return {
    dataset,
    formats,
    externalHosts
  };
}

export function summarizeDatasetWithPreview(dataset: DatasetDetails, preview: ResourcePreview | null): DatasetSummaryReport {
  const base = summarizeDataset(dataset);
  const schemaPreview = preview ? buildSchemaPreview(preview.previewText) : undefined;
  const resourceVariants = [...new Set(dataset.resources.map((resource) => resource.semanticVariant).filter((value): value is string => Boolean(value)))];

  return {
    ...base,
    ...(dataset.semanticProfile ? { semanticProfile: dataset.semanticProfile } : {}),
    ...(schemaPreview ? { schemaPreview } : {}),
    ...(resourceVariants.length > 0 ? { resourceVariants } : {})
  };
}

/**
 * Builds facet counts from CKAN's own native `search_facets` response
 * (requested via `package_search`'s `facet.field`), reflecting the whole
 * matching catalog rather than a capped page of client-side-counted results.
 */
export function facetDatasets(searchFacets: CkanSearchFacets): FacetResult {
  return {
    groups: extractFacetCounts(searchFacets, "groups"),
    organizations: extractFacetCounts(searchFacets, "organization"),
    formats: extractFacetCounts(searchFacets, "res_format"),
    licenses: extractFacetCounts(searchFacets, "license_id")
  };
}

function extractFacetCounts(searchFacets: CkanSearchFacets, field: string): Record<string, number> {
  const items = searchFacets[field]?.items ?? [];
  return Object.fromEntries(items.map((item) => [item.display_name?.trim() || item.name, item.count]));
}

export function findRelatedDatasets(target: DatasetDetails, candidates: DatasetSummary[], limit = 5): RelatedDataset[] {
  return candidates
    .filter((candidate) => candidate.id !== target.id)
    .map((candidate) => scoreRelatedDataset(target, candidate))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function scoreRelatedDataset(target: DatasetDetails, candidate: DatasetSummary): RelatedDataset {
  let score = 0;
  const reasons: string[] = [];

  const groupOverlap = overlap(target.groups.map((group) => group.name), candidate.groups.map((group) => group.name));
  if (groupOverlap.length > 0) {
    score += groupOverlap.length * 3;
    reasons.push(`shared groups: ${groupOverlap.join(", ")}`);
  }

  const tagOverlap = overlap(target.tags, candidate.tags);
  if (tagOverlap.length > 0) {
    score += tagOverlap.length * 2;
    reasons.push(`shared tags: ${tagOverlap.join(", ")}`);
  }

  if (target.organization?.name && target.organization.name === candidate.organization?.name) {
    score += 2;
    reasons.push(`same publisher: ${target.organization.title}`);
  }

  const formatOverlap = overlap(target.resourceFormats, candidate.resourceFormats);
  if (formatOverlap.length > 0) {
    score += formatOverlap.length;
    reasons.push(`shared formats: ${formatOverlap.join(", ")}`);
  }

  return { dataset: candidate, score, reasons };
}

function count(values: string[]) {
  return values.reduce<Record<string, number>>((result, value) => {
    const key = value.trim() || "Unknown";
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

function overlap(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))];
}

function buildSchemaPreview(previewText: string | undefined): DatasetSchemaPreview | undefined {
  if (!previewText) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(previewText) as unknown;

    if (Array.isArray(parsed)) {
      const sampleRecords = parsed.filter((value): value is Record<string, unknown> => isRecord(value)).slice(0, 5);
      const fieldNames = [...new Set(sampleRecords.flatMap((record) => Object.keys(record)))];

      return {
        topLevelType: "array",
        geometryTypes: [],
        propertyKeys: [],
        sampleProperties: [],
        ...(fieldNames.length > 0 ? { fieldNames } : {})
      };
    }

    if (!isRecord(parsed)) {
      return undefined;
    }

    const geojson = parsed as { type?: string; features?: Array<{ geometry?: { type?: string }; properties?: Record<string, unknown> }> };
    const features = Array.isArray(geojson.features) ? geojson.features : [];
    const geometryTypes = [...new Set(features.map((feature) => feature.geometry?.type).filter((value): value is string => Boolean(value)))];
    const sampleProperties = features
      .map((feature) => feature.properties)
      .filter((value): value is Record<string, unknown> => Boolean(value))
      .slice(0, 2);
    const propertyKeys = [...new Set(sampleProperties.flatMap((properties) => Object.keys(properties)))];

    const observedDistanceBandMeters = inferObservedDistanceBand(sampleProperties);

    return {
      topLevelType: typeof geojson.type === "string" ? geojson.type : "object",
      geometryTypes,
      propertyKeys,
      sampleProperties,
      ...(observedDistanceBandMeters ? { observedDistanceBandMeters } : {})
    };
  } catch {
    return undefined;
  }
}

function inferObservedDistanceBand(sampleProperties: Array<Record<string, unknown>>) {
  for (const properties of sampleProperties) {
    const frombreak = toFiniteNumber(properties.frombreak);
    const tobreak = toFiniteNumber(properties.tobreak);

    if (frombreak !== null && tobreak !== null) {
      return [frombreak, tobreak];
    }
  }

  return undefined;
}

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
