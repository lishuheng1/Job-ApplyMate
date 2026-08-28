import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFieldMatchingCacheKey } from './fieldMatchingCache.ts';

const fields = [{ index: 0, name: 'email', id: '', placeholder: '', labelText: '邮箱', type: 'email' }];

test('字段缓存键包含页面字段指纹', () => {
  const original = buildFieldMatchingCacheKey('jobs.example.com', fields);
  assert.equal(original, buildFieldMatchingCacheKey('jobs.example.com', fields));
  assert.notEqual(original, buildFieldMatchingCacheKey('jobs.example.com', [{ ...fields[0], labelText: '联系电话' }]));
  assert.notEqual(original, buildFieldMatchingCacheKey('apply.example.com', fields));
});
