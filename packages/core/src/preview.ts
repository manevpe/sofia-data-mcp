import { fetchWithTimeout } from "./http.js";
import type { CoreConfig } from "./config.js";
import type { ResourceInfo, ResourcePreview } from "./models.js";

export async function previewResource(resource: ResourceInfo, config: CoreConfig): Promise<ResourcePreview> {
  if (!resource.canPreview) {
    return {
      resource,
      status: "metadata_only",
      contentType: resource.mimetype,
      rawUrl: resource.url
    };
  }

  const response = await fetchWithTimeout(resource.url, {
    headers: {
      Accept: "application/json,text/plain,text/csv,*/*",
      "User-Agent": config.userAgent
    }
  }, config.requestTimeoutMs);

  const contentType = response.headers.get("content-type");

  if (!response.ok) {
    return {
      resource,
      status: "metadata_only",
      contentType,
      rawUrl: resource.url
    };
  }

  const buffer = await response.arrayBuffer();
  const limited = buffer.byteLength > config.previewMaxBytes ? buffer.slice(0, config.previewMaxBytes) : buffer;
  const previewText = new TextDecoder().decode(limited);

  return {
    resource,
    status: "preview",
    contentType,
    previewText,
    rawUrl: resource.url
  };
}
