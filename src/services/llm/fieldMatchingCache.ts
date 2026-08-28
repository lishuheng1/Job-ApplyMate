export interface CacheableField {
  index: number;
  name: string;
  id: string;
  placeholder: string;
  labelText: string;
  type: string;
}

export function buildFieldMatchingCacheKey(domain: string, fields: CacheableField[]): string {
  const fingerprint = fields
    .map(field => [field.index, field.name, field.id, field.placeholder, field.labelText, field.type]
      .map(value => String(value).trim().toLowerCase()).join('\u001f'))
    .join('\u001e');
  let hash = 0x811c9dc5;
  for (let index = 0; index < fingerprint.length; index++) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fieldMatch_v2_${domain}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
