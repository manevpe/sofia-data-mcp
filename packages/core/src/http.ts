export async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(url, init, timeoutMs);

  if (!response.ok) {
    const body = await safeText(response);
    throw new Error(`Request failed ${response.status} ${response.statusText}: ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(response: Response) {
  try {
    return await response.text();
  } catch {
    return "<unavailable>";
  }
}
