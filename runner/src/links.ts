/** GitHub's compare page for a branch against the project's default branch. Works before any PR exists. */
export const compareUrl = (repo: string, base: string, branch: string): string =>
  `https://github.com/${repo}/compare/${base}...${branch}`;
