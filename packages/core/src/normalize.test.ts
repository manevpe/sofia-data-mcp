import test from "node:test";
import assert from "node:assert/strict";

import { summarizeDatasetWithPreview } from "./analytics.js";
import { normalizeDatasetDetails, normalizeDatasetSummary, normalizeGroup, normalizeGroupName } from "./normalize.js";
import type { CkanDataset, CkanGroup } from "./ckan-types.js";
import type { ResourcePreview } from "./models.js";

const baseUrl = "https://urbandata.sofia.bg";

function makeDataset(overrides: Partial<CkanDataset> = {}): CkanDataset {
  return {
    id: "dataset-id",
    name: "sample-dataset",
    title: "Sample Dataset",
    resources: [],
    ...overrides
  };
}

function makeGeoJsonPreview(dataset: CkanDataset, properties: Record<string, unknown>, geometryType = "MultiPolygon"): ResourcePreview {
  const normalized = normalizeDatasetDetails(dataset, baseUrl);
  const [resource] = normalized.resources;
  assert.ok(resource);

  return {
    resource,
    status: "preview",
    contentType: "application/json",
    rawUrl: resource.url,
    previewText: JSON.stringify({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: geometryType, coordinates: [] }, properties }]
    })
  };
}

function makeArrayPreview(dataset: CkanDataset, rows: Array<Record<string, unknown>>): ResourcePreview {
  const normalized = normalizeDatasetDetails(dataset, baseUrl);
  const [resource] = normalized.resources;
  assert.ok(resource);

  return {
    resource,
    status: "preview",
    contentType: "application/json",
    rawUrl: resource.url,
    previewText: JSON.stringify(rows)
  };
}

// --- Generic semantic profile inference (replaces the old hardcoded per-dataset branches) ---

test("infers a semantic profile from groups, tags, and formats for any dataset (no hardcoded names needed)", () => {
  const dataset = makeDataset({
    name: "some-newly-published-dataset-never-seen-before",
    title: "Some Newly Published Dataset",
    groups: [{ id: "g1", name: "transport", title: "Transport" }],
    tags: [{ name: "mobility" }, { name: "buses" }],
    resources: [{ id: "r1", name: "data.geojson", format: "GeoJSON", url: "https://example.com/data.geojson" }]
  });

  const summary = normalizeDatasetSummary(dataset, baseUrl);

  assert.ok(summary.semanticProfile);
  assert.equal(summary.semanticProfile?.category, "transport");
  assert.match(summary.semanticProfile!.analysisType, /geospatial/);
  assert.match(summary.semanticProfile!.inferredDescription, /Some Newly Published Dataset/);
  assert.ok(summary.semanticProfile!.interpretationNotes.some((note) => note.includes("Transport")));
});

test("classifies mixed geospatial and tabular formats", () => {
  const dataset = makeDataset({
    resources: [
      { id: "r1", name: "a.geojson", format: "GeoJSON", url: "https://example.com/a.geojson" },
      { id: "r2", name: "a.csv", format: "CSV", url: "https://example.com/a.csv" }
    ]
  });

  const summary = normalizeDatasetSummary(dataset, baseUrl);
  assert.match(summary.semanticProfile!.analysisType, /mixed geospatial and tabular/);
});

test("classifies tabular-only formats", () => {
  const dataset = makeDataset({
    tags: [{ name: "finance" }],
    resources: [{ id: "r1", name: "a.csv", format: "CSV", url: "https://example.com/a.csv" }]
  });

  const summary = normalizeDatasetSummary(dataset, baseUrl);
  assert.match(summary.semanticProfile!.analysisType, /tabular dataset/);
});

test("falls back to 'uncategorized' when there are no groups or tags", () => {
  const dataset = makeDataset({
    resources: [{ id: "r1", name: "a.csv", format: "CSV", url: "https://example.com/a.csv" }]
  });

  const summary = normalizeDatasetSummary(dataset, baseUrl);
  assert.equal(summary.semanticProfile?.category, "uncategorized");
});

test("returns no semantic profile when there is no usable signal at all", () => {
  const dataset = makeDataset({ resources: [], groups: [], tags: [] });
  const summary = normalizeDatasetSummary(dataset, baseUrl);
  assert.equal(summary.semanticProfile, undefined);
});

// --- Generic resource-level year hints (replaces hardcoded Bulgarian-language name matching) ---

test("infers a year-based resource variant hint from the resource name", () => {
  const dataset = makeDataset({
    resources: [{ id: "r1", name: "Tram lines 2019", format: "GeoJSON", url: "https://example.com/a.geojson" }]
  });

  const details = normalizeDatasetDetails(dataset, baseUrl);
  const [resource] = details.resources;
  assert.equal(resource?.semanticVariant, "year_2019");
  assert.match(resource!.inferredDescription!, /2019/);
});

test("infers a year-based resource variant hint from the resource description", () => {
  const dataset = makeDataset({
    resources: [{
      id: "r1",
      name: "trolleybus-lines",
      description: "Trolleybus network snapshot, 2017",
      format: "GeoJSON",
      url: "https://example.com/a.geojson"
    }]
  });

  const details = normalizeDatasetDetails(dataset, baseUrl);
  const [resource] = details.resources;
  assert.equal(resource?.semanticVariant, "year_2017");
});

test("does not infer a resource variant hint when no year is present", () => {
  const dataset = makeDataset({
    resources: [{ id: "r1", name: "bus-lines", format: "GeoJSON", url: "https://example.com/a.geojson" }]
  });

  const details = normalizeDatasetDetails(dataset, baseUrl);
  const [resource] = details.resources;
  assert.equal(resource?.semanticVariant, undefined);
});

// --- Generic schema preview (allowlist removed; should work for any dataset) ---

test("builds a schema preview for a GeoJSON resource regardless of dataset name", () => {
  const dataset = makeDataset({
    name: "a-dataset-not-on-any-allowlist",
    resources: [{ id: "r1", name: "r", format: "GeoJSON", url: "https://example.com/a.geojson" }]
  });

  const preview = makeGeoJsonPreview(dataset, { foo: 1, bar: "baz" }, "Point");
  const details = normalizeDatasetDetails(dataset, baseUrl);
  const report = summarizeDatasetWithPreview(details, preview);

  assert.deepEqual(report.schemaPreview?.geometryTypes, ["Point"]);
  assert.deepEqual(report.schemaPreview?.propertyKeys.sort(), ["bar", "foo"]);
});

test("builds a schema preview for a tabular JSON array resource regardless of dataset name", () => {
  const dataset = makeDataset({
    name: "another-dataset-not-on-any-allowlist",
    resources: [{ id: "r1", name: "r", format: "JSON", url: "https://example.com/a.json" }]
  });

  const preview = makeArrayPreview(dataset, [{ a: 1, b: 2 }, { a: 3, c: 4 }]);
  const details = normalizeDatasetDetails(dataset, baseUrl);
  const report = summarizeDatasetWithPreview(details, preview);

  assert.deepEqual(report.schemaPreview?.fieldNames?.sort(), ["a", "b", "c"]);
});

test("returns no schema preview when there is no preview text", () => {
  const dataset = makeDataset({ resources: [] });
  const details = normalizeDatasetDetails(dataset, baseUrl);
  const report = summarizeDatasetWithPreview(details, null);
  assert.equal(report.schemaPreview, undefined);
});

// --- Generalized group-name mojibake repair (replaces the single hardcoded pair) ---

test("leaves already-clean hyphenated slugs untouched", () => {
  assert.equal(normalizeGroupName("transport", "Transport"), "transport");
  assert.equal(normalizeGroupName("public-transport", "Public Transport"), "public-transport");
});

test("repairs a garbled no-hyphen slug using a generic transliteration of the title", () => {
  // Mirrors the real observed portal bug: a Cyrillic group name/title gets
  // corrupted into a hyphen-less alphanumeric blob with digits standing in
  // for visually similar Cyrillic letters.
  const repaired = normalizeGroupName("bnopa3hoo6pa3ne", "биоразнообразие");
  assert.equal(repaired, "bioraznoobrazie");
});

test("leaves a garbled-looking name unchanged when no title is available to repair it", () => {
  assert.equal(normalizeGroupName("bnopa3hoo6pa3ne"), "bnopa3hoo6pa3ne");
});

test("normalizeGroup applies the same garbled-slug repair using group.title", () => {
  const group: CkanGroup = {
    id: "g1",
    name: "bnopa3hoo6pa3ne",
    title: "биоразнообразие",
    package_count: 3
  };

  const info = normalizeGroup(group, baseUrl);
  assert.equal(info.name, "bioraznoobrazie");
});
