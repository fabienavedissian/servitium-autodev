// Scans agent-authored OUTBOUND strings (PR body, lesson, branch, labels) before they leave the
// box. Complements the gitleaks gate, which only scans the worktree.
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'generic-bearer', re: /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/i },
];

export function scanSecret(text: string): { found: boolean; matches: string[] } {
  const matches = PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
  return { found: matches.length > 0, matches };
}
