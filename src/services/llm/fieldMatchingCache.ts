export interface CacheableField {
  index: number;
  name: string;
  id: string;
  placeholder: string;
  labelText: string;
  type: string;
  contextText?: string;
}

export interface CacheableAIFillField {
  index: number;
  rowIndex: number;
  name: string;
  label: string;
  type: string;
  options: string[];
  context: string;
  blockId?: string;
  blockContext?: string;
}

export function buildFieldMatchingCacheKey(domain: string, fields: CacheableField[]): string {
  const fingerprint = fields
    .map(field => [field.index, field.name, field.id, field.placeholder, field.labelText, field.type, field.contextText || '']
      .map(value => String(value).trim().toLowerCase()).join('\u001f'))
    .join('\u001e');
  let hash = 0x811c9dc5;
  for (let index = 0; index < fingerprint.length; index++) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fieldMatch_v3_${domain}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildAIFillValueCacheKey(
  domain: string,
  field: CacheableAIFillField,
  profileFingerprint: string,
): string {
  const source = JSON.stringify({
    domain: domain.trim().toLowerCase(),
    field: {
      rowIndex: field.rowIndex,
      name: field.name,
      label: field.label,
      type: field.type,
      options: field.options,
      context: field.context,
      blockId: field.blockId || '',
      blockContext: field.blockContext || '',
    },
    profileFingerprint,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `aiPageFill_v1_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
