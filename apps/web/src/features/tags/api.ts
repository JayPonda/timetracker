import {
  errorEnvelopeSchema,
  listTagsResponseSchema,
  tagResponseSchema,
  type CreateTagInput,
  type Tag,
  type UpdateTagInput,
} from '@pdm/shared';

/**
 * The tags API, same-origin only.
 *
 * Relative paths by construction (ADR 0001, `NFR-PRIV-01`). Responses are
 * parsed with the shared schemas, so the browser validates with the same
 * contract the server enforces.
 */

async function apiError(res: Response, fallback: string): Promise<Error> {
  try {
    const envelope = errorEnvelopeSchema.parse(await res.json());
    return new Error(envelope.error.message || `${fallback} (HTTP ${res.status})`);
  } catch {
    return new Error(`${fallback} (HTTP ${res.status})`);
  }
}

async function readTag(res: Response, fallback: string): Promise<Tag> {
  if (!res.ok) throw await apiError(res, fallback);
  return tagResponseSchema.parse(await res.json()).tag;
}

export async function fetchTags(signal: AbortSignal, includeArchived: boolean): Promise<Tag[]> {
  const path = includeArchived ? '/api/v1/tags?include_archived=true' : '/api/v1/tags';
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw await apiError(res, 'Could not load tags');
  return listTagsResponseSchema.parse(await res.json()).tags;
}

export async function createTag(input: CreateTagInput): Promise<Tag> {
  const res = await fetch('/api/v1/tags', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readTag(res, 'Could not create the tag');
}

export async function updateTag(id: number, input: UpdateTagInput): Promise<Tag> {
  const res = await fetch(`/api/v1/tags/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readTag(res, 'Could not update the tag');
}

export async function archiveTag(id: number): Promise<Tag> {
  const res = await fetch(`/api/v1/tags/${id}/archive`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readTag(res, 'Could not archive the tag');
}

export async function restoreTag(id: number): Promise<Tag> {
  const res = await fetch(`/api/v1/tags/${id}/restore`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readTag(res, 'Could not restore the tag');
}
