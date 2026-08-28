import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPLICATION_RECORD_CSV_HEADERS,
  createApplicationRecordDraft,
  findApplicationRecordDuplicate,
  parseApplicationRecordsCsv,
  serializeApplicationRecordsCsv,
} from './applicationRecords.ts';
import { StorageService, STORAGE_KEYS } from './storage.ts';
import type { ApplicationRecord } from './types.ts';

test('createApplicationRecordDraft 默认状态为已投递并保留识别出的岗位信息', () => {
  const draft = createApplicationRecordDraft('2026-08-07T10:00:00.000Z', {
    companyName: '字节跳动',
    sourceSite: 'jobs.bytedance.com',
    sourceUrl: 'https://jobs.bytedance.com/example',
    pageTitle: '字节跳动校园招聘',
    jobTitle: '产品经理',
    location: '北京',
  });

  assert.equal(draft.status, '已投递');
  assert.equal(draft.jobTitle, '产品经理');
  assert.equal(draft.location, '北京');
  assert.equal(draft.companyName, '字节跳动');
});

test('findApplicationRecordDuplicate 按同公司加同链接命中', () => {
  const records = [{
    id: 'r1',
    companyName: '字节跳动',
    jobTitle: '',
    sourceSite: 'jobs.bytedance.com',
    sourceUrl: 'https://jobs.bytedance.com/example',
    status: '已投递',
    notes: '',
    appliedAt: '2026-08-07',
    location: '',
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
  }] satisfies ApplicationRecord[];

  assert.equal(
    findApplicationRecordDuplicate(records, {
      companyName: '字节跳动',
      sourceUrl: 'https://jobs.bytedance.com/example',
    })?.id,
    'r1',
  );
});

test('CSV 导出列头固定并包含全部字段', () => {
  assert.deepEqual(APPLICATION_RECORD_CSV_HEADERS, [
    'companyName', 'jobTitle', 'sourceSite', 'sourceUrl', 'status',
    'notes', 'appliedAt', 'location', 'createdAt', 'updatedAt',
  ]);
});

test('CSV 导入对非法状态给出 warning', () => {
  const csv = [
    APPLICATION_RECORD_CSV_HEADERS.join(','),
    '字节跳动,,jobs.bytedance.com,https://jobs.bytedance.com/example,未知状态,,2026-08-07,,2026-08-07T10:00:00.000Z,2026-08-07T10:00:00.000Z',
  ].join('\n');

  const result = parseApplicationRecordsCsv(csv);
  assert.equal(result.records.length, 0);
  assert.match(result.warnings[0] || '', /非法状态/);
});

test('CSV 导入导出后保留 companyName/sourceUrl/status', () => {
  const records: ApplicationRecord[] = [{
    id: 'r1',
    companyName: '字节跳动',
    jobTitle: '',
    sourceSite: 'jobs.bytedance.com',
    sourceUrl: 'https://jobs.bytedance.com/example',
    status: '已投递',
    notes: '一志愿',
    appliedAt: '2026-08-07',
    location: '北京',
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
  }];

  const roundtrip = parseApplicationRecordsCsv(serializeApplicationRecordsCsv(records));
  assert.equal(roundtrip.records[0]?.companyName, '字节跳动');
  assert.equal(roundtrip.records[0]?.sourceUrl, 'https://jobs.bytedance.com/example');
  assert.equal(roundtrip.records[0]?.status, '已投递');
});

test('StorageService 可保存并读取投递记录列表', async () => {
  const storageState: Record<string, unknown> = {};
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storageState[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(storageState, values),
      },
    },
  };

  const records: ApplicationRecord[] = [{
    id: 'r1',
    companyName: '字节跳动',
    jobTitle: '',
    sourceSite: 'jobs.bytedance.com',
    sourceUrl: 'https://jobs.bytedance.com/example',
    status: '已投递',
    notes: '',
    appliedAt: '2026-08-07',
    location: '',
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
  }];

  try {
    await StorageService.saveApplicationRecords(records);
    assert.deepEqual(storageState[STORAGE_KEYS.APPLICATION_RECORDS], records);
    assert.deepEqual(await StorageService.getApplicationRecords(), records);
  } finally {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});

test('StorageService 可新增、更新、删除单条投递记录', async () => {
  const storageState: Record<string, unknown> = {};
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storageState[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(storageState, values),
      },
    },
  };

  const created: ApplicationRecord = {
    id: 'r1',
    companyName: '字节跳动',
    jobTitle: '',
    sourceSite: 'jobs.bytedance.com',
    sourceUrl: 'https://jobs.bytedance.com/example',
    status: '已投递',
    notes: '',
    appliedAt: '2026-08-07',
    location: '',
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
  };

  try {
    await StorageService.createApplicationRecord(created);
    assert.equal((await StorageService.getApplicationRecords()).length, 1);

    const updated: ApplicationRecord = {
      ...created,
      status: '面试中',
      notes: '一面已过',
      updatedAt: '2026-08-08T10:00:00.000Z',
    };

    await StorageService.updateApplicationRecord(updated);
    assert.equal((await StorageService.getApplicationRecords())[0]?.status, '面试中');

    await StorageService.deleteApplicationRecord(created.id);
    assert.deepEqual(await StorageService.getApplicationRecords(), []);
  } finally {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});

test('StorageService 读取旧状态值时会自动归一化到新状态文案', async () => {
  const storageState: Record<string, unknown> = {
    [STORAGE_KEYS.APPLICATION_RECORDS]: [{
      id: 'legacy-r1',
      companyName: '字节跳动',
      jobTitle: '',
      sourceSite: 'jobs.bytedance.com',
      sourceUrl: 'https://jobs.bytedance.com/example',
      status: 'Offer',
      notes: '',
      appliedAt: '2026-08-07',
      location: '',
      createdAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
    }],
  };
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storageState[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(storageState, values),
      },
    },
  };

  try {
    const records = await StorageService.getApplicationRecords();
    assert.equal(records[0]?.status, 'offer');
  } finally {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});
