import type { ProjectEntryIndex, ProjectPreviewKind } from "@workshop/contracts";
import type { ProjectEntryKind } from "@workshop/domain";

export interface ProjectPreviewTarget {
  projectId: string;
  versionId: string;
  kind: ProjectPreviewKind;
  r2Key: string | null;
  sha256: string | null;
  entryCount: number;
}

export interface PrevalidatedContent {
  presence: Record<ProjectEntryKind, boolean>;
  counts: Record<ProjectEntryKind, number>;
  hashes: Partial<Record<ProjectEntryKind, string>>;
  error: string | null;
  entries: ProjectEntryIndex["entries"];
}

export interface RunTarget {
  id: string;
  project_id: string;
  version_id: string;
  base_published_version_id: string | null;
  status: string;
  check_status: string;
  check_attempts: number;
  lease_token: string | null;
  lease_until: string | null;
  client_gate: string | null;
  checker_version: string | null;
}
