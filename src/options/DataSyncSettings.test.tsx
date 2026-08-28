import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('WebDAV 同步文案明确说明投递记录会额外保留 CSV 副本', () => {
  const source = readFileSync(new URL('./DataSyncSettings.tsx', import.meta.url), 'utf8');
  assert.match(source, /投递记录会额外保留一份 CSV 副本/);
});

test('本地 JSON 备份文案明确排除投递记录', () => {
  const source = readFileSync(new URL('./DataSyncSettings.tsx', import.meta.url), 'utf8');
  assert.match(source, /导入或导出个人资料、简历原文件、AI 配置和通用设置，不包含投递记录。/);
});

test('立即同步按钮不再要求启用自动同步', () => {
  const source = readFileSync(new URL('./DataSyncSettings.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /disabled=\{busy !== null \|\| !config\.enabled\}/);
  assert.match(source, /disabled=\{busy !== null\}/);
});

test('立即同步成功后显示明确成功提示', () => {
  const source = readFileSync(new URL('./DataSyncSettings.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /操作未完成，请查看下方同步状态/);
  assert.match(source, /同步完成/);
});
