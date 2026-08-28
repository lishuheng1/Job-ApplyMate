import assert from 'node:assert/strict';
import test from 'node:test';
import { getLearnedFieldsForDomain, updateLearnedFieldStore } from './learnedFields.ts';

test('学习结果按网站和字段签名隔离并可覆盖更新', () => {
  const first = updateLearnedFieldStore({}, 'Jobs.Example.com', {
    signature: 'field-a', label: '毕业月份', value: '06月', updatedAt: '2026-08-01T00:00:00Z',
  });
  const second = updateLearnedFieldStore(first, 'jobs.example.com', {
    signature: 'field-a', label: '毕业月份', value: '6', updatedAt: '2026-08-02T00:00:00Z',
  });
  assert.equal(getLearnedFieldsForDomain(second, 'JOBS.EXAMPLE.COM')['field-a'].value, '6');
  assert.deepEqual(getLearnedFieldsForDomain(second, 'other.example.com'), {});
});

test('每个网站只保留最近的学习记录', () => {
  let store = {};
  for (let index = 0; index < 3; index++) {
    store = updateLearnedFieldStore(store, 'jobs.example.com', {
      signature: `field-${index}`, label: '', value: String(index), updatedAt: `2026-08-0${index + 1}T00:00:00Z`,
    }, 2);
  }
  assert.deepEqual(Object.keys(getLearnedFieldsForDomain(store, 'jobs.example.com')), ['field-2', 'field-1']);
});
