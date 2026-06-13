// Load an ESM-only module from this CommonJS codebase without TypeScript
// downleveling the dynamic import() into a require() (which throws ERR_REQUIRE_ESM).
// The agent SDK and octokit are ESM-only; this is the single seam that bridges them.
export const importEsm: <T = unknown>(specifier: string) => Promise<T> = new Function(
  'specifier',
  'return import(specifier)',
) as never;
