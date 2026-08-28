import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../shared/types.ts';
import type { ApplicationRecord } from '../shared/types.ts';
import {
  handleCreateApplicationRecord,
  handleCreateApplicationRecordDraft,
  handleDeleteApplicationRecord,
  handleExportApplicationRecordsCsv,
  handleGetApplicationRecordDraft,
  handleGetApplicationRecords,
  handleImportApplicationRecordsCsv,
  handleUpdateApplicationRecord,
} from './applicationRecords.ts';

function installChromeStub() {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const storageState: Record<string, unknown> = {};
  const sentMessages: Message[] = [];

  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storageState[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(storageState, values),
      },
    },
    tabs: {
      get: async (tabId: number) => ({
        id: tabId,
        url: 'https://jobs.bytedance.com/campus',
      }),
      sendMessage: async (_tabId: number, message: Message) => {
        sentMessages.push(message);
        return {
          success: true,
          data: {
            companyName: '字节跳动',
            sourceSite: 'jobs.bytedance.com',
            sourceUrl: 'https://jobs.bytedance.com/campus',
            pageTitle: '字节跳动校园招聘',
          },
        };
      },
    },
  };

  return {
    storageState,
    sentMessages,
    restore() {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    },
  };
}

function buildRecord(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: 'r1',
    companyName: '字节跳动',
    jobTitle: '',
    sourceSite: 'jobs.bytedance.com',
    sourceUrl: 'https://jobs.bytedance.com/campus',
    status: '已投递',
    notes: '',
    appliedAt: '2026-08-07',
    location: '',
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
    ...overrides,
  };
}

test('创建草稿时返回 duplicate 但不阻止后续创建', async () => {
  const stub = installChromeStub();

  try {
    const first = await handleCreateApplicationRecord(buildRecord());
    assert.equal(first.success, true);
    assert.equal(first.data?.duplicate, null);

    const createdDraft = await handleCreateApplicationRecordDraft(1);
    assert.equal(createdDraft.success, true);

    const second = await handleGetApplicationRecordDraft(createdDraft.data!.draftId);
    assert.equal(second.success, true);
    assert.equal(second.data?.draft.companyName, '字节跳动');
    assert.equal(second.data?.duplicate?.id, 'r1');
    assert.deepEqual(stub.sentMessages, [{
      type: 'GET_APPLICATION_PAGE_METADATA',
      payload: null,
    }]);
  } finally {
    stub.restore();
  }
});

test('背景层 CRUD 与 CSV handler 可独立运行', async () => {
  const stub = installChromeStub();

  try {
    await handleCreateApplicationRecord(buildRecord());

    const listResponse = await handleGetApplicationRecords();
    assert.equal(listResponse.success, true);
    assert.equal(listResponse.data?.length, 1);

    const updated = buildRecord({
      status: '面试中',
      notes: '一面通过',
      updatedAt: '2026-08-08T10:00:00.000Z',
    });
    const updateResponse = await handleUpdateApplicationRecord(updated);
    assert.equal(updateResponse.success, true);
    assert.equal((await handleGetApplicationRecords()).data?.[0]?.status, '面试中');

    const exportResponse = await handleExportApplicationRecordsCsv();
    assert.equal(exportResponse.success, true);
    assert.match(exportResponse.data?.filename || '', /^application-records-/);
    assert.match(exportResponse.data?.csv || '', /companyName,jobTitle,sourceSite,sourceUrl,status/);

    const importResponse = await handleImportApplicationRecordsCsv(exportResponse.data!.csv);
    assert.equal(importResponse.success, true);
    assert.equal(importResponse.data?.imported, 1);
    assert.equal(importResponse.data?.warnings.length, 1);
    assert.match(importResponse.data?.warnings[0] || '', /重复/);
    assert.equal((await handleGetApplicationRecords()).data?.length, 2);

    const deleteResponse = await handleDeleteApplicationRecord('r1');
    assert.equal(deleteResponse.success, true);
    assert.equal((await handleGetApplicationRecords()).data?.length, 1);
  } finally {
    stub.restore();
  }
});

test('连续保存同一条新建记录时不会生成重复 id 记录', async () => {
  const stub = installChromeStub();

  try {
    const firstPayload = buildRecord({
      id: 'same-record-id',
      status: '已投递',
      notes: '首次保存',
      updatedAt: '2026-08-08T10:00:00.000Z',
    });
    const secondPayload = buildRecord({
      id: 'same-record-id',
      status: '面试中',
      notes: '再次保存',
      updatedAt: '2026-08-08T12:00:00.000Z',
    });

    const firstResponse = await handleCreateApplicationRecord(firstPayload);
    assert.equal(firstResponse.success, true);

    const secondResponse = await handleCreateApplicationRecord(secondPayload);
    assert.equal(secondResponse.success, true);

    const records = (await handleGetApplicationRecords()).data ?? [];
    assert.equal(records.length, 1);
    assert.equal(records[0]?.id, 'same-record-id');
    assert.equal(records[0]?.status, '面试中');
    assert.equal(records[0]?.notes, '再次保存');
    assert.equal(records[0]?.updatedAt, '2026-08-08T12:00:00.000Z');
  } finally {
    stub.restore();
  }
});

test('CSV 导入会追加记录且保留未参与导入的现有记录', async () => {
  const stub = installChromeStub();

  try {
    const existingRecord = buildRecord({
      id: 'existing-record',
      companyName: '字节跳动',
      sourceUrl: 'https://jobs.bytedance.com/existing',
    });
    await handleCreateApplicationRecord(existingRecord);

    const csv = [
      'companyName,jobTitle,sourceSite,sourceUrl,status,notes,appliedAt,location,createdAt,updatedAt',
      '腾讯,后台开发,tencent.com,https://careers.tencent.com/example,已投递,,2026-08-09,深圳,2026-08-09T10:00:00.000Z,2026-08-09T10:00:00.000Z',
    ].join('\n');

    const importResponse = await handleImportApplicationRecordsCsv(csv);
    assert.equal(importResponse.success, true);
    assert.equal(importResponse.data?.imported, 1);
    assert.deepEqual(importResponse.data?.warnings, []);

    const records = (await handleGetApplicationRecords()).data ?? [];
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map(record => record.id),
      ['existing-record', records[1]!.id],
    );
    assert.equal(records[0]?.companyName, '字节跳动');
    assert.equal(records[1]?.companyName, '腾讯');
  } finally {
    stub.restore();
  }
});

test('非法 CSV 表头导入返回失败而不是 success + 0', async () => {
  const stub = installChromeStub();

  try {
    const invalidCsv = [
      'companyName,jobTitle,sourceUrl,status',
      '字节跳动,前端开发,https://jobs.bytedance.com/example,已投递',
    ].join('\n');

    const response = await handleImportApplicationRecordsCsv(invalidCsv);
    assert.equal(response.success, false);
    assert.match(response.error || '', /CSV 表头不合法/);
    assert.equal((await handleGetApplicationRecords()).data?.length, 0);
  } finally {
    stub.restore();
  }
});

test('CSV 导入命中已有重复时保留新 id 并返回 warning', async () => {
  const stub = installChromeStub();

  try {
    const existingRecord = buildRecord({
      id: 'existing-record',
      companyName: '字节跳动',
      sourceUrl: 'https://jobs.bytedance.com/campus',
    });
    await handleCreateApplicationRecord(existingRecord);

    const csv = [
      'companyName,jobTitle,sourceSite,sourceUrl,status,notes,appliedAt,location,createdAt,updatedAt',
      '字节跳动,,jobs.bytedance.com,https://jobs.bytedance.com/campus,已投递,,2026-08-07,,2026-08-07T11:00:00.000Z,2026-08-07T11:00:00.000Z',
    ].join('\n');

    const importResponse = await handleImportApplicationRecordsCsv(csv);
    assert.equal(importResponse.success, true);
    assert.equal(importResponse.data?.imported, 1);
    assert.equal(importResponse.data?.warnings.length, 1);
    assert.match(importResponse.data?.warnings[0] || '', /重复/);

    const records = (await handleGetApplicationRecords()).data ?? [];
    assert.equal(records.length, 2);
    assert.equal(records[0]?.id, 'existing-record');
    assert.notEqual(records[1]?.id, 'existing-record');
    assert.equal(records[1]?.companyName, '字节跳动');
    assert.equal(records[1]?.sourceUrl, 'https://jobs.bytedance.com/campus');
  } finally {
    stub.restore();
  }
});
