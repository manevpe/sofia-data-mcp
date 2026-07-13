import type { CkanDataset, CkanGroup, CkanOrganization, CkanResource } from "./ckan-types.js";
import type { DatasetDetails, DatasetSummary, DatasetSemanticProfile, EntityRef, GroupInfo, OrganizationInfo, ResourceInfo } from "./models.js";

export function normalizeDatasetSummary(dataset: CkanDataset, baseUrl: string): DatasetSummary {
  const resources = (dataset.resources ?? []).map(normalizeResource);
  const title = dataset.title?.trim() || dataset.name;
  const groups = (dataset.groups ?? []).map(normalizeGroupRef).filter(Boolean) as EntityRef[];
  const tags = (dataset.tags ?? []).map((tag) => tag.name);
  const resourceFormats = unique(resources.map((resource) => resource.format));
  const semanticProfile = inferDatasetSemanticProfile({
    title,
    groups,
    tags,
    resourceFormats,
    resourceCount: resources.length
  });

  return {
    id: dataset.id,
    name: dataset.name,
    title,
    description: dataset.notes?.trim() || "",
    organization: normalizeEntityRef(dataset.organization),
    groups,
    tags,
    license: dataset.license_title?.trim() || "Unspecified",
    createdAt: dataset.metadata_created ?? null,
    updatedAt: dataset.metadata_modified ?? null,
    resourceCount: resources.length,
    resourceFormats,
    sourceUrl: new URL(`/dataset/${dataset.name}`, baseUrl).toString(),
    ...(semanticProfile ? { semanticProfile } : {})
  };
}

export function normalizeDatasetDetails(dataset: CkanDataset, baseUrl: string): DatasetDetails {
  return {
    ...normalizeDatasetSummary(dataset, baseUrl),
    resources: (dataset.resources ?? []).map(normalizeResource),
    extras: Object.fromEntries((dataset.extras ?? []).map((extra) => [extra.key, extra.value])),
    raw: dataset
  };
}

export function normalizeGroup(group: CkanGroup, baseUrl: string, includeDatasets = false): GroupInfo {
  const datasets = includeDatasets ? (group.packages ?? []).map((dataset) => normalizeDatasetSummary(dataset, baseUrl)) : undefined;

  return {
    id: group.id,
    name: normalizeGroupName(group.name, group.title),
    title: group.title?.trim() || group.name,
    description: group.description?.trim() || "",
    packageCount: group.package_count ?? group.packages?.length ?? 0,
    ...(datasets ? { datasets } : {}),
    raw: group
  };
}

export function normalizeOrganization(organization: CkanOrganization): OrganizationInfo {
  return {
    id: organization.id,
    name: organization.name,
    title: organization.title?.trim() || organization.name,
    description: organization.description?.trim() || "",
    packageCount: organization.package_count ?? 0,
    imageUrl: organization.image_url ?? null,
    raw: organization
  };
}

export function normalizeResource(resource: CkanResource): ResourceInfo {
  const url = resource.url;
  const format = resource.format?.trim().toUpperCase() || guessFormat(url);
  const resourceName = resource.name?.trim() || resource.id;
  const resourceDescription = resource.description?.trim() || "";
  const semanticHints = inferResourceSemanticHints(resourceName, resourceDescription);

  return {
    id: resource.id,
    name: resourceName,
    format,
    description: resourceDescription,
    url,
    host: safeHost(url),
    mimetype: resource.mimetype ?? null,
    size: typeof resource.size === "number" ? resource.size : null,
    canPreview: ["JSON", "GEOJSON", "CSV", "TXT", "TEXT"].includes(format),
    ...(semanticHints ? semanticHints : {}),
    raw: resource
  };
}

function normalizeEntityRef(entity: CkanDataset["organization"]): EntityRef | null {
  if (!entity) {
    return null;
  }

  return {
    id: entity.id,
    name: entity.name,
    title: entity.title?.trim() || entity.name
  };
}

function normalizeGroupRef(entity: CkanDataset["organization"]): EntityRef | null {
  if (!entity) {
    return null;
  }

  return {
    id: entity.id,
    name: normalizeGroupName(entity.name, entity.title),
    title: entity.title?.trim() || entity.name
  };
}

export function normalizeGroupName(name: string, title?: string) {
  if (title && looksGarbled(name)) {
    const slug = slugifyTitle(title);
    if (slug) {
      return slug;
    }
  }

  return name;
}

/**
 * Detects auto-generated CKAN slugs that were corrupted by a source-side
 * Cyrillic transliteration/encoding bug (observed as digits standing in for
 * visually similar Cyrillic letters, e.g. "bnopa3hoo6pa3ne" for
 * "biodiversity"/"биоразнообразие"). Real CKAN slugs are derived from titles
 * by replacing whitespace/punctuation with hyphens, so a digit sitting
 * directly between two letters with no hyphen anywhere in the slug is a
 * strong, general signal of this corruption rather than a legitimate
 * word-with-a-number slug (which almost always keeps a hyphen elsewhere,
 * e.g. "population-in-a-1x1-km-grid").
 */
function looksGarbled(value: string) {
  return !value.includes("-") && /[a-z]\d[a-z]/i.test(value);
}

const CYRILLIC_TRANSLITERATION: Record<string, string> = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z",
  "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p",
  "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch",
  "ш": "sh", "щ": "sht", "ъ": "a", "ь": "y", "ю": "yu", "я": "ya"
};

function slugifyTitle(title: string) {
  const transliterated = title
    .trim()
    .toLowerCase()
    .split("")
    .map((char) => CYRILLIC_TRANSLITERATION[char] ?? char)
    .join("");

  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}



function guessFormat(url: string) {
  const extension = url.split("?")[0]?.split(".").pop()?.toUpperCase();
  return extension || "UNKNOWN";
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

interface SemanticInferenceInput {
  title: string;
  groups: EntityRef[];
  tags: string[];
  resourceFormats: string[];
  resourceCount: number;
}

const GEOSPATIAL_FORMATS = new Set(["GEOJSON", "SHP", "SHAPEFILE", "KML", "KMZ", "GPKG", "WMS", "WFS", "GML"]);
const TABULAR_FORMATS = new Set(["CSV", "XLS", "XLSX", "TSV"]);
const STRUCTURED_TEXT_FORMATS = new Set(["JSON", "TXT", "TEXT"]);
const DOCUMENT_FORMATS = new Set(["PDF", "DOC", "DOCX"]);

/**
 * Derives a lightweight, generic semantic profile from CKAN metadata alone
 * (title, groups, tags, resource formats). This intentionally does not
 * inspect resource content — that is handled separately and more precisely
 * by the schema preview built from an actual sampled resource (see
 * `buildSchemaPreview` in analytics.ts). Every dataset gets a profile here,
 * regardless of name, so this scales to the full catalog without manual
 * curation.
 */
function inferDatasetSemanticProfile(input: SemanticInferenceInput): DatasetSemanticProfile | undefined {
  const { title, groups, tags, resourceFormats, resourceCount } = input;

  if (resourceCount === 0 && groups.length === 0 && tags.length === 0) {
    return undefined;
  }

  const category = deriveCategory(groups, tags);
  const analysisType = deriveAnalysisType(resourceFormats);
  const groupTitles = groups.map((group) => group.title);

  const interpretationNotes: string[] = [];

  if (groupTitles.length > 0) {
    interpretationNotes.push(`Published under group(s): ${groupTitles.join(", ")}.`);
  }

  if (tags.length > 0) {
    const shownTags = tags.slice(0, 8);
    interpretationNotes.push(`Tagged with: ${shownTags.join(", ")}${tags.length > shownTags.length ? ", ..." : ""}.`);
  }

  if (resourceFormats.length > 0) {
    interpretationNotes.push(`Available in format(s): ${resourceFormats.join(", ")}. Use summarize_dataset or preview_resource to inspect the actual field-level schema.`);
  } else {
    interpretationNotes.push("No resources are attached to this dataset yet, so its structure cannot be inferred.");
  }

  interpretationNotes.push("This summary is generated automatically from portal metadata; it is not manually curated and may not capture domain-specific nuance.");

  const scopePhrase = groupTitles.length > 0 ? ` under the ${groupTitles.join(", ")} group(s)` : "";
  const formatPhrase = analysisType ? ` as ${analysisType}` : "";

  return {
    category,
    subject: title.toLowerCase(),
    analysisType,
    inferredDescription: `${title} is published on the Sofia urban data portal${scopePhrase}${formatPhrase}.`,
    interpretationNotes
  };
}

function deriveCategory(groups: EntityRef[], tags: string[]) {
  if (groups.length > 0) {
    return groups.map((group) => group.name).join("+");
  }

  if (tags.length > 0) {
    return tags[0]!.toLowerCase().replace(/\s+/g, "_");
  }

  return "uncategorized";
}

function deriveAnalysisType(resourceFormats: string[]) {
  if (resourceFormats.length === 0) {
    return "an unclassified dataset with no attached resources";
  }

  const hasGeo = resourceFormats.some((format) => GEOSPATIAL_FORMATS.has(format));
  const hasTabular = resourceFormats.some((format) => TABULAR_FORMATS.has(format));
  const hasStructuredText = resourceFormats.some((format) => STRUCTURED_TEXT_FORMATS.has(format));
  const hasDocument = resourceFormats.some((format) => DOCUMENT_FORMATS.has(format));

  if (hasGeo && (hasTabular || hasStructuredText)) {
    return "a mixed geospatial and tabular/structured dataset";
  }

  if (hasGeo) {
    return "a geospatial dataset";
  }

  if (hasTabular) {
    return "a tabular dataset";
  }

  if (hasStructuredText) {
    return "a structured (JSON/text) dataset";
  }

  if (hasDocument) {
    return "a document-based dataset";
  }

  return `a dataset published in ${resourceFormats.join("/")} format`;
}

const YEAR_PATTERN = /\b(19|20)\d{2}\b/;

/**
 * Derives an optional, generic hint about a resource variant from any year
 * mentioned in its name or description. This replaces a large hardcoded list
 * of Bulgarian-language name patterns with a pattern that generalizes to any
 * resource, in any language, without per-resource curation.
 */
function inferResourceSemanticHints(name: string, description: string): Pick<ResourceInfo, "semanticVariant" | "inferredDescription"> | undefined {
  const combined = `${name} ${description}`;
  const yearMatch = combined.match(YEAR_PATTERN);

  if (!yearMatch) {
    return undefined;
  }

  const year = yearMatch[0];

  return {
    semanticVariant: `year_${year}`,
    inferredDescription: `Resource name/description references ${year}; it likely represents a dataset snapshot or variant tied to that year.`
  };
}

