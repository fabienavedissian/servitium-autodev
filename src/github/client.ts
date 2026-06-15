import { importEsm } from '../esm';

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface GithubClient {
  listOpenIssuesByLabel(repo: string, label: string): Promise<GithubIssue[]>;
  setLabels(repo: string, issueNumber: number, labels: string[]): Promise<void>;
  createDraftPr(repo: string, head: string, base: string, title: string, body: string): Promise<{ number: number; url: string }>;
  listRepos(): Promise<string[]>;
  listBranches(repo: string): Promise<string[]>;
}

// Fallback repo list if the live GitHub listing can't be fetched (PAT/API hiccup),
// so the dashboard repo picker is never empty.
const KNOWN_REPOS = [
  'servitium-api', 'servitium-center', 'servitium-portal', 'servitium-ui',
  'servitium-gui', 'servitium-game', 'servitium-discord', 'servitium-shared', 'servitium-autodev',
];

// octokit is ESM-only -> loaded via the dynamic-import seam. PAT is scoped to servitium-api with
// contents + pull_requests:write, NO merge/admin/workflows. createDraftPr always passes draft:true.
export async function loadGithub(pat: string, org: string): Promise<GithubClient> {
  const mod = await importEsm<{ Octokit: new (o: { auth: string }) => GithubApi }>('octokit');
  const kit = new mod.Octokit({ auth: pat });
  return {
    async listOpenIssuesByLabel(repo, label) {
      const r = await kit.rest.issues.listForRepo({ owner: org, repo, state: 'open', labels: label });
      return r.data
        .filter((i) => !i.pull_request)
        .map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body ?? '',
          labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
        }));
    },
    async setLabels(repo, issueNumber, labels) {
      await kit.rest.issues.setLabels({ owner: org, repo, issue_number: issueNumber, labels });
    },
    async createDraftPr(repo, head, base, title, body) {
      const r = await kit.rest.pulls.create({ owner: org, repo, head, base, title, body, draft: true });
      return { number: r.data.number, url: r.data.html_url };
    },
    async listRepos() {
      try {
        const out: string[] = [];
        for (let page = 1; page <= 5; page += 1) {
          const r = await kit.rest.repos.listForAuthenticatedUser({ per_page: 100, page, affiliation: 'owner', sort: 'full_name' });
          for (const repo of r.data) {
            const ownerOk = !org || (repo.owner?.login ?? '').toLowerCase() === org.toLowerCase();
            // Only the Servitium projects — the account also holds unrelated repos.
            if (ownerOk && repo.name.startsWith('servitium-')) out.push(repo.name);
          }
          if (r.data.length < 100) break;
        }
        return out.length ? Array.from(new Set(out)).sort() : [...KNOWN_REPOS];
      } catch {
        return [...KNOWN_REPOS];
      }
    },
    async listBranches(repo) {
      const out: string[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const r = await kit.rest.repos.listBranches({ owner: org, repo, per_page: 100, page });
        for (const b of r.data) out.push(b.name);
        if (r.data.length < 100) break;
      }
      return out;
    },
  };
}

// Minimal structural view of the octokit surface used above (avoids depending on its ESM types).
interface GithubApi {
  rest: {
    issues: {
      listForRepo(p: { owner: string; repo: string; state: string; labels: string }): Promise<{
        data: { number: number; title: string; body: string | null; pull_request?: unknown; labels?: (string | { name?: string })[] }[];
      }>;
      setLabels(p: { owner: string; repo: string; issue_number: number; labels: string[] }): Promise<unknown>;
    };
    pulls: {
      create(p: { owner: string; repo: string; head: string; base: string; title: string; body: string; draft: boolean }): Promise<{
        data: { number: number; html_url: string };
      }>;
    };
    repos: {
      listForAuthenticatedUser(p: { per_page: number; page: number; affiliation: string; sort: string }): Promise<{
        data: { name: string; owner?: { login?: string } }[];
      }>;
      listBranches(p: { owner: string; repo: string; per_page: number; page: number }): Promise<{
        data: { name: string }[];
      }>;
    };
  };
}
