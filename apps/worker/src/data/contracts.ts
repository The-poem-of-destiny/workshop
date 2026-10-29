import type { ProjectEntryIndex, ProjectPreviewKind } from "@workshop/contracts";
import type { ProjectEntryKind } from "@workshop/domain";

export interface ProjectPreviewTarget {
  projectId: string;
  revisionId: string;
  kind: ProjectPreviewKind;
  r2Key: string | null;
  sha256: string | null;
  entryCount: number;
}

export interface PrevalidatedContent {
  presence: Record<ProjectEntryKind, boolean>;
  counts: Record<ProjectEntryKind, number>;
  hashes: Partial<Record<ProjectEntryKind, string>>;
  conflict: string | null;
  error: string | null;
  entries: ProjectEntryIndex["entries"];
}
