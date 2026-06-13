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
}

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
  };
}
