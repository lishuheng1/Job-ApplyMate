import type {
  ApplicationPageMetadata,
  ApplicationRecord,
  ApplicationRecordDraft,
  ApplicationRecordStatus,
} from './types.ts';

export const APPLICATION_RECORD_STATUSES: ApplicationRecordStatus[] = [
  '待投递',
  '已投递',
  '已笔试',
  '面试中',
  'offer',
  '终止',
];

const LEGACY_APPLICATION_RECORD_STATUS_MAP: Record<string, ApplicationRecordStatus> = {
  待投: '待投递',
  已投递: '已投递',
  笔试: '已笔试',
  面试: '面试中',
  Offer: 'offer',
  offer: 'offer',
  终止: '终止',
};

export const APPLICATION_RECORD_CSV_HEADERS = [
  'companyName',
  'jobTitle',
  'sourceSite',
  'sourceUrl',
  'status',
  'notes',
  'appliedAt',
  'location',
  'createdAt',
  'updatedAt',
] as const;

type ApplicationRecordCsvHeader = typeof APPLICATION_RECORD_CSV_HEADERS[number];

function isApplicationRecordStatus(value: string): value is ApplicationRecordStatus {
  return APPLICATION_RECORD_STATUSES.includes(value as ApplicationRecordStatus);
}

export function normalizeApplicationRecordStatus(value: string | undefined): ApplicationRecordStatus | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  if (isApplicationRecordStatus(normalized)) {
    return normalized;
  }
  return LEGACY_APPLICATION_RECORD_STATUS_MAP[normalized] ?? null;
}

export function normalizeApplicationRecord(record: ApplicationRecord): ApplicationRecord {
  return {
    ...record,
    status: normalizeApplicationRecordStatus(record.status) ?? '已投递',
  };
}

export function normalizeApplicationRecords(records: ApplicationRecord[] | undefined | null): ApplicationRecord[] {
  return (records ?? []).map(normalizeApplicationRecord);
}

function normalizeText(value: string | undefined): string {
  return value?.trim() ?? '';
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function generateRecordId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const nextChar = csv[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }

      row.push(cell);
      if (row.some(value => value !== '')) {
        rows.push(row);
      }

      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.some(value => value !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

export function createApplicationRecordDraft(
  nowIso: string,
  metadata: ApplicationPageMetadata,
): ApplicationRecordDraft {
  return {
    companyName: metadata.companyName,
    jobTitle: metadata.jobTitle || '',
    sourceSite: metadata.sourceSite,
    sourceUrl: metadata.sourceUrl,
    status: '已投递',
    notes: '',
    appliedAt: nowIso.slice(0, 10),
    location: metadata.location || '',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function findApplicationRecordDuplicate(
  records: ApplicationRecord[],
  candidate: Pick<ApplicationRecord, 'companyName' | 'sourceUrl'>,
): ApplicationRecord | null {
  const normalizedCompanyName = normalizeText(candidate.companyName);
  const normalizedSourceUrl = normalizeText(candidate.sourceUrl);

  return records.find(record =>
    normalizeText(record.companyName) === normalizedCompanyName
    && normalizeText(record.sourceUrl) === normalizedSourceUrl,
  ) ?? null;
}

export function serializeApplicationRecordsCsv(records: ApplicationRecord[]): string {
  const lines = [
    APPLICATION_RECORD_CSV_HEADERS.join(','),
    ...records.map(record => APPLICATION_RECORD_CSV_HEADERS.map((header) => {
      return escapeCsvCell(record[header as ApplicationRecordCsvHeader] ?? '');
    }).join(',')),
  ];

  return lines.join('\n');
}

export function parseApplicationRecordsCsv(csv: string): {
  records: ApplicationRecord[];
  warnings: string[];
  error?: string;
} {
  const rows = parseCsvRows(csv);
  const warnings: string[] = [];

  if (rows.length === 0) {
    return { records: [], warnings: ['CSV 内容为空'] };
  }

  const [headerRow, ...dataRows] = rows;
  const normalizedHeaderRow = headerRow.map(header => header.trim());

  if (
    normalizedHeaderRow.length !== APPLICATION_RECORD_CSV_HEADERS.length
    || APPLICATION_RECORD_CSV_HEADERS.some((header, index) => normalizedHeaderRow[index] !== header)
  ) {
    return {
      records: [],
      warnings: ['CSV 表头不合法，必须与固定列头完全一致'],
      error: 'CSV 表头不合法，必须与固定列头完全一致',
    };
  }

  const records: ApplicationRecord[] = [];

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const valuesByHeader = Object.fromEntries(
      APPLICATION_RECORD_CSV_HEADERS.map((header, headerIndex) => [header, row[headerIndex] ?? '']),
    ) as Record<ApplicationRecordCsvHeader, string>;

    const status = normalizeApplicationRecordStatus(valuesByHeader.status);
    if (!status) {
      warnings.push(`第 ${rowNumber} 行存在非法状态: ${valuesByHeader.status}`);
      return;
    }

    records.push({
      id: generateRecordId(),
      companyName: valuesByHeader.companyName ?? '',
      jobTitle: valuesByHeader.jobTitle ?? '',
      sourceSite: valuesByHeader.sourceSite ?? '',
      sourceUrl: valuesByHeader.sourceUrl ?? '',
      status,
      notes: valuesByHeader.notes ?? '',
      appliedAt: valuesByHeader.appliedAt ?? '',
      location: valuesByHeader.location ?? '',
      createdAt: valuesByHeader.createdAt ?? '',
      updatedAt: valuesByHeader.updatedAt ?? '',
    });
  });

  return { records, warnings };
}
