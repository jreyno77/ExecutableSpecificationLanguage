export type PullRequestMetadata = {
  taskIds: string[];
  deliveryKind: "planned" | "incident-recovery" | null;
  incidentNumbers: number[];
};
export function readPullRequestMetadata(body: string | null | undefined): PullRequestMetadata;
export function assertCommitIdentity(actual: string, expected: string, label: string): void;
export function assertUploadedAsset(
  asset: { state: string; size: number; digest?: string | null; browser_download_url?: string },
  expected: { size: number; sha256: string },
): void;
export function describeCommitInventory(
  commits: Array<{
    sha: string;
    html_url: string;
    commit: { author?: { date?: string | null } | null; committer?: { date?: string | null } | null };
  }>,
  expectedCommitCount: number,
): {
  commitsComplete: boolean;
  expectedCommitCount: number;
  observedCommitCount: number;
  commits: Array<{ sha: string; url: string; authoredAt: string | null; committedAt: string | null }>;
};
