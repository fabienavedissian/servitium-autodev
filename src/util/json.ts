// Agents are asked to output strict JSON but sometimes wrap it in a ```json fence or add prose.
// This extracts and parses the first JSON object/array; returns null on failure (never throws).
export function parseJsonLoose<T = unknown>(text: string): T | null {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/m.exec(t);
  if (fence) t = fence[1].trim();
  const block = /[{[][\s\S]*[}\]]/.exec(t);
  const candidate = block ? block[0] : t;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
