export type BuiltArtifact = {
  kind: "compiler-package" | "specification-bundle";
  name: string;
  version: string | null;
  bytes: Buffer;
  size: number;
  sha256: string;
};
export function deliverMergedPullRequest(options: {
  github: unknown;
  context: {
    repo: { owner: string; repo: string };
    payload: {
      pull_request?: { merged: boolean; number: number; merge_commit_sha: string; base: { ref: string } };
      repository: { default_branch: string; html_url: string };
    };
    runId: number;
  };
  core: { info(message: string): void; warning(message: string): void; error(message: string): void };
  workspace?: string;
  build?: (input: { workspace: string; mergeSha: string; pullNumber: number }) => Promise<BuiltArtifact>;
}): Promise<unknown>;
