import type { LearnedFieldValue } from './types.ts';

export type LearnedFieldStore = Record<string, Record<string, LearnedFieldValue>>;

export function getLearnedFieldsForDomain(
  store: LearnedFieldStore,
  domain: string,
): Record<string, LearnedFieldValue> {
  return store[domain.trim().toLowerCase()] || {};
}

export function updateLearnedFieldStore(
  store: LearnedFieldStore,
  domain: string,
  entry: LearnedFieldValue,
  limit = 200,
): LearnedFieldStore {
  const normalizedDomain = domain.trim().toLowerCase();
  const domainEntries = { ...(store[normalizedDomain] || {}), [entry.signature]: entry };
  return {
    ...store,
    [normalizedDomain]: Object.fromEntries(
      Object.entries(domainEntries)
        .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit),
    ),
  };
}
