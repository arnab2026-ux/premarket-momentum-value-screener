export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON with timeout and retry/backoff on 429 / 5xx / network errors. */
export async function fetchJson<T = unknown>(
  url: string, opts: { retries?: number; timeoutMs?: number; onRetry?: (msg: string) => void } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      lastErr = new Error(`HTTP ${res.status}`);
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      opts.onRetry?.(`retry ${attempt + 1} after HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && /^HTTP 4/.test(e.message)) throw e; // non-retryable client error
      await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Map with bounded concurrency; per-item failures are returned via onError and skipped. */
export async function pMap<T, R>(
  items: T[], concurrency: number, fn: (item: T) => Promise<R>, onError?: (item: T, err: unknown) => void,
): Promise<{ item: T; value: R }[]> {
  const out: { item: T; value: R }[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try { out.push({ item, value: await fn(item) }); } catch (e) { onError?.(item, e); }
      }
    }),
  );
  return out;
}

export const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
