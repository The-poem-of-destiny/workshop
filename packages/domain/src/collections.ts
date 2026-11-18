export const COLLECTION_LIMITS = {
  title: 120,
  description: 2_000,
  maxCollectionsPerAuthor: 50,
  maxProjectsPerCollection: 200,
} as const;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export interface CollectionMetadataInput {
  title: string;
  description?: string | null;
}

export function validateCollectionMetadata(
  input: CollectionMetadataInput,
): { ok: true; title: string; description: string } | { ok: false; message: string } {
  const title = input.title.trim();
  const description = (input.description ?? "").trim();
  if (!title) return { ok: false, message: "合集名称不能为空" };
  if (title.length > COLLECTION_LIMITS.title) {
    return { ok: false, message: `合集名称不能超过 ${COLLECTION_LIMITS.title} 个字符` };
  }
  if (description.length > COLLECTION_LIMITS.description) {
    return { ok: false, message: `合集简介不能超过 ${COLLECTION_LIMITS.description} 个字符` };
  }
  if (CONTROL_CHARACTERS.test(title) || CONTROL_CHARACTERS.test(description)) {
    return { ok: false, message: "合集名称或简介包含非法控制字符" };
  }
  return { ok: true, title, description };
}
