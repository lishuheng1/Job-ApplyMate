import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAIFillValueCacheKey, buildFieldMatchingCacheKey } from './fieldMatchingCache.ts';

const fields = [{ index: 0, name: 'email', id: '', placeholder: '', labelText: '邮箱', type: 'email' }];

test('字段缓存键包含页面字段指纹', () => {
  const original = buildFieldMatchingCacheKey('jobs.example.com', fields);
  assert.equal(original, buildFieldMatchingCacheKey('jobs.example.com', fields));
  assert.notEqual(original, buildFieldMatchingCacheKey('jobs.example.com', [{ ...fields[0], labelText: '联系电话' }]));
  assert.notEqual(original, buildFieldMatchingCacheKey('apply.example.com', fields));
});

test('逐项补填缓存同时绑定网站、字段和当前资料', () => {
  const field = {
    index: 0,
    rowIndex: 0,
    name: 'degree',
    label: '学历',
    type: 'combobox',
    options: ['本科', '硕士'],
    context: '教育经历',
  };
  const original = buildAIFillValueCacheKey('jobs.example.com', field, '{"degree":"本科"}');
  assert.equal(original, buildAIFillValueCacheKey('jobs.example.com', field, '{"degree":"本科"}'));
  assert.notEqual(original, buildAIFillValueCacheKey('jobs.example.com', field, '{"degree":"硕士"}'));
  assert.notEqual(original, buildAIFillValueCacheKey('apply.example.com', field, '{"degree":"本科"}'));
});
