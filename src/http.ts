export const VERSION = "1.1.1";
const REPO = "https://github.com/tobiasosDev/citecheck";

/**
 * Contact address for the CrossRef / OpenAlex "polite pool" (faster, more
 * reliable rate limits). Opt-in via `CITECHECK_MAILTO` or the CLI `--mailto`
 * flag. Never defaults to a hardcoded address — your traffic is yours.
 */
export function politeMailto(): string | undefined {
  const m = process.env.CITECHECK_MAILTO?.trim();
  return m && m.includes("@") ? m : undefined;
}

export function userAgent(): string {
  const mailto = politeMailto();
  return `citecheck/${VERSION} (+${REPO}${mailto ? `; mailto:${mailto}` : ""})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

/**
 * `fetch` with retry on *transient* failures (HTTP 429, 5xx, network errors,
 * timeouts). After the retries are exhausted on a transient failure it THROWS,
 * so callers can tell "couldn't reach the API" apart from a definitive answer.
 * A clean response — including a definitive 4xx like 404 — is returned as-is for
 * the caller to interpret.
 */
export async function fetchRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { headers, timeoutMs = 10_000, retries = 2 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`transient HTTP ${res.status}`);
        if (attempt < retries) {
          await sleep(300 * (attempt + 1) ** 2);
          continue;
        }
        throw lastErr;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(300 * (attempt + 1) ** 2);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}
