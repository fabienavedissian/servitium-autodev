// Host-side page fetch (token-free): global fetch + a dependency-free HTML->text reduction. Keeps
// the token-heavy EXTRACT stage cheap by handing it clean-ish text, not raw markup. Failures degrade
// to an empty string (the page is simply skipped, never crashes the run).

export interface FetchedPage {
  url: string;
  ok: boolean;
  status: number;
  text: string;
}

const STRIP_BLOCKS = /<(script|style|noscript|svg|head|nav|footer|form)[\s\S]*?<\/\1>/gi;

export function htmlToText(html: string): string {
  return html
    .replace(STRIP_BLOCKS, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
    .trim();
}

export async function fetchPage(url: string, timeoutMs = 12_000, maxChars = 6000): Promise<FetchedPage> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ServitiumIntel/1.0)', accept: 'text/html,application/xhtml+xml' },
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!res.ok || !/text\/html|text\/plain|application\/xhtml/i.test(ct)) {
      return { url, ok: false, status: res.status, text: '' };
    }
    const raw = await res.text();
    const text = (ct.includes('text/plain') ? raw : htmlToText(raw)).slice(0, maxChars);
    return { url, ok: true, status: res.status, text };
  } catch {
    return { url, ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch a batch with bounded concurrency (politeness + speed). Order preserved.
export async function fetchBatch(urls: string[], concurrency = 4): Promise<FetchedPage[]> {
  const out: FetchedPage[] = new Array(urls.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (i < urls.length) {
      const idx = i++;
      out[idx] = await fetchPage(urls[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
