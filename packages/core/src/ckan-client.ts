import { fetchJson } from "./http.js";
import { normalizeGroupName } from "./normalize.js";
import { TtlCache } from "./cache.js";
import type { CkanActionResponse, CkanDataset, CkanGroup, CkanNamedEntity, CkanOrganization, CkanSearchFacets, CkanSearchResult } from "./ckan-types.js";
import type { CoreConfig } from "./config.js";
import type { SearchFilters } from "./models.js";

const FACET_FIELDS = ["groups", "organization", "res_format", "license_id"];

export interface FacetSearchResult {
  count: number;
  facets: CkanSearchFacets;
}

export class CkanClient {
  private readonly datasetCache: TtlCache<CkanDataset>;
  private readonly searchCache: TtlCache<CkanSearchResult>;
  private readonly facetCache: TtlCache<FacetSearchResult>;
  private readonly groupsCache: TtlCache<CkanGroup[]>;
  private readonly organizationsCache: TtlCache<string[]>;

  constructor(private readonly config: CoreConfig) {
    this.datasetCache = new TtlCache(config.cacheTtlMs);
    this.searchCache = new TtlCache(config.cacheTtlMs);
    this.facetCache = new TtlCache(config.cacheTtlMs);
    this.groupsCache = new TtlCache(config.cacheTtlMs);
    this.organizationsCache = new TtlCache(config.cacheTtlMs);
  }

  async searchDatasets(filters: SearchFilters) {
    const key = JSON.stringify(filters);
    return this.searchCache.getOrLoad(key, () => this.searchDatasetsUncached(filters));
  }

  private async searchDatasetsUncached(filters: SearchFilters) {
    const url = new URL("/api/3/action/package_search", this.config.ckanBaseUrl);
    url.searchParams.set("rows", String(clamp(filters.rows ?? 10, 1, this.config.maxSearchResults)));
    url.searchParams.set("start", String(Math.max(filters.start ?? 0, 0)));

    const parts = [
      filters.query?.trim(),
      filters.group ? `groups:${await this.resolveGroupName(filters.group)}` : undefined,
      filters.organization ? `organization:${filters.organization}` : undefined,
      filters.format ? `res_format:${filters.format}` : undefined
    ].filter(Boolean);

    if (parts.length > 0) {
      url.searchParams.set("q", parts.join(" "));
    }

    const response = await this.request<CkanSearchResult>(url);
    return response.result;
  }

  /**
   * Returns facet counts computed by CKAN itself (via `package_search`'s
   * native `facet.field` support) across the whole catalog matching the
   * query, rather than counting client-side over a capped page of results.
   */
  async getFacets(query: string | undefined): Promise<FacetSearchResult> {
    const key = query ?? "";
    return this.facetCache.getOrLoad(key, () => this.getFacetsUncached(query));
  }

  private async getFacetsUncached(query: string | undefined): Promise<FacetSearchResult> {
    const url = new URL("/api/3/action/package_search", this.config.ckanBaseUrl);
    url.searchParams.set("rows", "0");
    url.searchParams.set("facet.field", JSON.stringify(FACET_FIELDS));
    url.searchParams.set("facet.limit", "-1");

    if (query?.trim()) {
      url.searchParams.set("q", query.trim());
    }

    const response = await this.request<CkanSearchResult>(url);
    return {
      count: response.result.count,
      facets: response.result.search_facets ?? {}
    };
  }

  async getDataset(id: string) {
    return this.datasetCache.getOrLoad(id, () => this.getDatasetUncached(id));
  }

  private async getDatasetUncached(id: string) {
    const url = new URL("/api/3/action/package_show", this.config.ckanBaseUrl);
    url.searchParams.set("id", id);
    return (await this.request<CkanDataset>(url)).result;
  }

  async listGroups() {
    const { groups } = await this.loadGroupNameMap();
    return groups.map((group) => normalizeGroupName(group.name, group.title));
  }

  async getGroup(id: string, includeDatasets = false) {
    const url = new URL("/api/3/action/group_show", this.config.ckanBaseUrl);
    url.searchParams.set("id", await this.resolveGroupName(id));
    if (includeDatasets) {
      url.searchParams.set("include_datasets", "true");
    }
    return (await this.request<CkanGroup>(url)).result;
  }

  async listOrganizations() {
    return this.organizationsCache.getOrLoad("all", () => this.listOrganizationsUncached());
  }

  private async listOrganizationsUncached() {
    const url = new URL("/api/3/action/organization_list", this.config.ckanBaseUrl);
    return (await this.request<string[]>(url)).result;
  }

  async getOrganization(id: string) {
    const url = new URL("/api/3/action/organization_show", this.config.ckanBaseUrl);
    url.searchParams.set("id", id);
    return (await this.request<CkanOrganization>(url)).result;
  }

  /**
   * Resolves a possibly-friendly (transliterated) group name back to the raw
   * CKAN group name/slug expected by the CKAN Action API, by consulting the
   * cached group list. Falls back to returning the input unchanged if it
   * isn't found (e.g. the caller already passed a raw CKAN slug or id).
   */
  private async resolveGroupName(name: string): Promise<string> {
    const { friendlyToRaw } = await this.loadGroupNameMap();
    return friendlyToRaw.get(name) ?? name;
  }

  private loadGroupNameMap() {
    return this.buildGroupNameMap();
  }

  private async buildGroupNameMap() {
    const groups = await this.groupsCache.getOrLoad("all", () => this.listGroupsAllFieldsUncached());
    const friendlyToRaw = new Map<string, string>();

    for (const group of groups) {
      friendlyToRaw.set(normalizeGroupName(group.name, group.title), group.name);
    }

    return { friendlyToRaw, groups };
  }

  private async listGroupsAllFieldsUncached() {
    const url = new URL("/api/3/action/group_list", this.config.ckanBaseUrl);
    url.searchParams.set("all_fields", "true");
    return (await this.request<CkanNamedEntity[]>(url)).result as CkanGroup[];
  }

  private request<T>(url: URL) {
    return fetchJson<CkanActionResponse<T>>(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": this.config.userAgent
      }
    }, this.config.requestTimeoutMs);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
