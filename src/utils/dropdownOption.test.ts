import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dropdownValueMatches,
  findBestDropdownOptionIndex,
  scoreDropdownOption,
  splitCascaderValue,
  splitMultiDropdownValue,
} from './dropdownOption.ts';
import { normalizePoliticalStatusValue } from '../shared/personal.ts';

test('优先选择精确或同义下拉选项', () => {
  assert.equal(findBestDropdownOptionIndex('本科', ['请选择', '专科', '大学本科', '硕士']), 2);
  assert.equal(findBestDropdownOptionIndex('yes', ['否', '是']), 1);
  assert.equal(dropdownValueMatches('大学本科', '本科'), true);
});

test('不会把肯定值误匹配到含有相同文字的否定选项', () => {
  assert.equal(scoreDropdownOption('全日制', '非全日制'), -1);
  assert.equal(scoreDropdownOption('是', '是否接受调剂'), -1);
  assert.equal(findBestDropdownOptionIndex('本科', ['非本科专业', '大学本科']), 1);
});

test('日期选项兼容补零和不同分隔符', () => {
  assert.equal(findBestDropdownOptionIndex('2020.06', ['2020.5', '2020-6', '2020.07']), 1);
});

test('政治面貌只匹配同一身份，不把预备党员选成其他党派', () => {
  const options = ['请选择', '中共党员', '民主党派', '中共预备党员', '群众'];
  assert.equal(findBestDropdownOptionIndex('中共预备党员', options), 3);
  assert.equal(findBestDropdownOptionIndex('预备党员', options), 3);
  assert.equal(findBestDropdownOptionIndex('党员', options), 1);
  assert.equal(scoreDropdownOption('中共预备党员', '民主党派'), -1);
  assert.equal(scoreDropdownOption('中共预备党员', '中共党员'), -1);
  assert.equal(normalizePoliticalStatusValue('预备党员'), '中共预备党员');
  assert.equal(normalizePoliticalStatusValue('党员'), '中共党员');
});

test('多选和级联值只在对应模式下拆分', () => {
  assert.deepEqual(splitMultiDropdownValue('北京，上海、深圳'), ['北京', '上海', '深圳']);
  assert.deepEqual(splitCascaderValue('浙江省 / 杭州市 / 西湖区'), ['浙江省', '杭州市', '西湖区']);
  assert.deepEqual(splitCascaderValue('2020/06'), ['2020/06']);
});
