export interface CkanActionResponse<T> {
  success: boolean;
  result: T;
  help?: string;
  error?: Record<string, unknown>;
}

export interface CkanNamedEntity {
  id: string;
  name: string;
  title?: string;
  description?: string;
}

export interface CkanTag {
  name: string;
}

export interface CkanExtra {
  key: string;
  value: string;
}

export interface CkanResource {
  id: string;
  name?: string;
  format?: string;
  description?: string;
  url: string;
  mimetype?: string | null;
  size?: number | null;
  [key: string]: unknown;
}

export interface CkanDataset {
  id: string;
  name: string;
  title?: string;
  notes?: string;
  license_title?: string;
  metadata_created?: string;
  metadata_modified?: string;
  organization?: CkanNamedEntity;
  groups?: CkanNamedEntity[];
  tags?: CkanTag[];
  resources?: CkanResource[];
  extras?: CkanExtra[];
  [key: string]: unknown;
}

export interface CkanGroup extends CkanNamedEntity {
  package_count?: number;
  packages?: CkanDataset[];
  [key: string]: unknown;
}

export interface CkanOrganization extends CkanNamedEntity {
  package_count?: number;
  image_url?: string | null;
  [key: string]: unknown;
}

export interface CkanFacetItem {
  name: string;
  display_name?: string;
  count: number;
}

export interface CkanSearchFacets {
  [field: string]: {
    title?: string;
    items: CkanFacetItem[];
  };
}

export interface CkanSearchResult {
  count: number;
  results: CkanDataset[];
  search_facets?: CkanSearchFacets;
}
