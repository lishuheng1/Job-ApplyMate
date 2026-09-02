import assert from 'node:assert/strict';
import test from 'node:test';
import { doesChoiceMatch, normalizeComparable } from './controlSemantics.ts';

test('单选项只匹配目标答案，不会因为目标为“是”而命中“否”', () => {
  assert.equal(doesChoiceMatch('no', '否', '是'), false);
  assert.equal(doesChoiceMatch('yes', '是', '是'), true);
  assert.equal(doesChoiceMatch('false', '否', 'no'), true);
});

test('布尔同义词与较长选项文字可以可靠匹配', () => {
  assert.equal(doesChoiceMatch('accepted', '同意', 'true'), true);
  assert.equal(doesChoiceMatch('full-time', '统招全日制', '全日制'), true);
  assert.equal(doesChoiceMatch('part-time', '非全日制', '全日制'), false);
});

test('比较前清理常见标点和空白', () => {
  assert.equal(normalizeComparable(' 是（推荐） '), '是推荐');
});
