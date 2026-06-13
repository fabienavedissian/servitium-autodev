// Host-side page fetch (token-free): global fetch + a dependency-free HTML->text reduction. Keeps
// the token-heavy EXTRACT stage cheap by handing it clean-ish text, not raw markup. HARD memory cap
// (streamed read, bytes bounded) so a giant page can never OOM-kill the run; failures degrade to ''.

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

// Read the body stream but stop after maxBytes (bounds memory hard; many pages are multi-MB).
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
        if (total >= maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
      }
    }
  } catch {
    /* partial read is fine */
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchPage(url: string, timeoutMs = 12_000, maxChars = 6000, maxBytes = 400_000): Promise<FetchedPage> {
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
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { url, ok: false, status: res.status, text: '' };
    }
    const raw = await readCapped(res, maxBytes);
    const text = (ct.includes('text/plain') ? raw : htmlToText(raw)).slice(0, maxChars);
    return { url, ok: true, status: res.status, text };
  } catch {
    return { url, ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch a batch with bounded concurrency. Each page is independently wrapped so one bad URL can never
// reject the batch (the run must survive any page). A hard race-timeout guarantees forward progress.
export async function fetchBatch(urls: string[], concurrency = 3): Promise<FetchedPage[]> {
  const out: FetchedPage[] = new Array(urls.length);
  let i = 0;
  const guard = async (url: string): Promise<FetchedPage> => {
    try {
      return await Promise.race([
        fetchPage(url),
        new Promise<FetchedPage>((resolve) => setTimeout(() => resolve({ url, ok: false, status: 0, text: '' }), 18_000)),
      ]);
    } catch {
      return { url, ok: false, status: 0, text: '' };
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (i < urls.length) {
      const idx = i++;
      out[idx] = await guard(urls[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
