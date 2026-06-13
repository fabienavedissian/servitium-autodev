/**
 * Verifies the GitHub PAT: authenticates and reads the `auto`-labelled issue queue on the target
 * repo. Run: node --env-file-if-exists=.env dist/scripts/github-smoketest.js
 */
import { loadGithub } from '../src/github/client';

async function main(): Promise<void> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    console.error('Set GITHUB_PAT (or .env).');
    process.exit(1);
  }
  const org = process.env.GITHUB_ORG ?? 'fabienavedissian';
  const repo = (process.env.TARGET_REPOS ?? 'servitium-api').split(',')[0].trim();
  try {
    const gh = await loadGithub(pat, org);
    const auto = await gh.listOpenIssuesByLabel(repo, 'auto');
    console.log(`\n=== GitHub PAT verification ===`);
    console.log(`auth + read OK on ${org}/${repo}. Open 'auto' issues: ${auto.length}`);
    for (const i of auto.slice(0, 8)) console.log(` - #${i.number} ${i.title}`);
    process.exit(0);
  } catch (e) {
    console.error('GitHub call FAILED:', String(e).slice(0, 400));
    process.exit(2);
  }
}

main();
