// Token-free dedup. Repetition is the #1 reason a veille feed gets abandoned, so this is load-bearing
// and deliberately simple: a canonical URL OR a normalized-title key. No SimHash/embeddings at this
// volume (~50 signals/day) — exact canonical match handles the vast majority.

// Strip tracking params, fragment, trailing slash, scheme, leading www. so the same page from two
// links collapses to one key.
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    const drop = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^ref$/i, /^ref_src$/i, /^mc_/i, /^igshid$/i];
    for (const key of [...u.searchParams.keys()]) if (drop.some((re) => re.test(key))) u.searchParams.delete(key);
    const host = u.host.replace(/^www\./i, '').toLowerCase();
    let path = u.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    const qs = u.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, '');
  }
}

export function domainOf(raw: string): string {
  try {
    return new URL(raw.trim()).host.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

// Normalize a title for the fallback key: lowercase, strip punctuation, collapse whitespace.
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// The signal dedup key: prefer the canonical URL; fall back to angle + normalized title so two
// articles about the same thing from different URLs still collapse within a lane.
export function signalDedupKey(angle: string, title: string, url?: string): string {
  if (url && /^https?:\/\//i.test(url)) return `url:${canonicalizeUrl(url)}`;
  return `t:${angle}:${normalizeTitle(title)}`;
}

export interface DedupItem {
  angle: string;
  title: string;
  url?: string;
}

export interface DedupResult<T extends DedupItem> {
  fresh: (T & { dedupKey: string })[]; // first occurrence, not seen before
  seen: (T & { dedupKey: string })[]; // collides with `known` (resurfacing) or an earlier item this batch
}

// Split a batch against a set of already-known keys. Within-batch duplicates collapse too (first wins).
export function dedupSignals<T extends DedupItem>(items: T[], known: Set<string> = new Set()): DedupResult<T> {
  const fresh: (T & { dedupKey: string })[] = [];
  const seen: (T & { dedupKey: string })[] = [];
  const batch = new Set<string>();
  for (const it of items) {
    const dedupKey = signalDedupKey(it.angle, it.title, it.url);
    const withKey = { ...it, dedupKey };
    if (known.has(dedupKey) || batch.has(dedupKey)) seen.push(withKey);
    else {
      batch.add(dedupKey);
      fresh.push(withKey);
    }
  }
  return { fresh, seen };
}
