export interface EntityRef {
  id: string;
  name: string;
  title: string;
}

export interface ResourceInfo {
  id: string;
  name: string;
  format: string;
  description: string;
  url: string;
  host: string;
  mimetype: string | null;
  size: number | null;
  canPreview: boolean;
  semanticVariant?: string;
  inferredDescription?: string;
  raw: Record<string, unknown>;
}

export interface DatasetSummary {
  id: string;
  name: string;
  title: string;
  description: string;
  organization: EntityRef | null;
  groups: EntityRef[];
  tags: string[];
  license: string;
  createdAt: string | null;
  updatedAt: string | null;
  resourceCount: number;
  resourceFormats: string[];
  sourceUrl: string;
  semanticProfile?: DatasetSemanticProfile;
}

export interface DatasetDetails extends DatasetSummary {
  resources: ResourceInfo[];
  extras: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface GroupInfo {
  id: string;
  name: string;
  title: string;
  description: string;
  packageCount: number;
  datasets?: DatasetSummary[];
  raw: Record<string, unknown>;
}

export interface OrganizationInfo {
  id: string;
  name: string;
  title: string;
  description: string;
  packageCount: number;
  imageUrl: string | null;
  raw: Record<string, unknown>;
}

export interface SearchFilters {
  query?: string | undefined;
  group?: string | undefined;
  organization?: string | undefined;
  format?: string | undefined;
  rows?: number | undefined;
  start?: number | undefined;
}

export interface SearchResult {
  count: number;
  items: DatasetSummary[];
}

export interface ResourcePreview {
  resource: ResourceInfo;
  status: "preview" | "metadata_only";
  contentType: string | null;
  previewText?: string;
  rawUrl: string;
}

export interface DatasetSummaryReport {
  dataset: DatasetDetails;
  formats: Record<string, number>;
  externalHosts: string[];
  semanticProfile?: DatasetSemanticProfile;
  schemaPreview?: DatasetSchemaPreview;
  resourceVariants?: string[];
}

export interface DatasetSemanticProfile {
  category: string;
  subject: string;
  analysisType: string;
  geometryType?: string;
  unitOfAnalysis?: string;
  inferredDescription: string;
  interpretationNotes: string[];
}

export interface DatasetSchemaPreview {
  topLevelType: string;
  geometryTypes: string[];
  propertyKeys: string[];
  sampleProperties: Array<Record<string, unknown>>;
  fieldNames?: string[];
  observedDistanceBandMeters?: number[];
}

export interface FacetResult {
  groups: Record<string, number>;
  organizations: Record<string, number>;
  formats: Record<string, number>;
  licenses: Record<string, number>;
}

export interface RelatedDataset {
  dataset: DatasetSummary;
  score: number;
  reasons: string[];
}
