import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptDateValue, areEquivalentDates, findDateOptionIndex } from './dateValue.ts';

test('2020.06、2020.6 与 2020-06 表示同一个月份', () => {
  assert.equal(areEquivalentDates('2020.06', '2020.6'), true);
  assert.equal(areEquivalentDates('2020.06', '2020-06'), true);
});

test('根据网站控件类型和格式提示转换日期', () => {
  assert.equal(adaptDateValue('2020.6', { inputType: 'month' }), '2020-06');
  assert.equal(adaptDateValue('2020.6', { inputType: 'date' }), '2020-06-01');
  assert.equal(adaptDateValue('2020-6', { placeholder: 'YYYY.MM' }), '2020.06');
  assert.equal(adaptDateValue('2020-06', { placeholder: 'YYYY/M' }), '2020/6');
});

test('年份和月份拆分下拉框可以从完整年月选中对应项', () => {
  assert.equal(findDateOptionIndex('2020.06', ['请选择', '2019', '2020', '2021']), 2);
  assert.equal(findDateOptionIndex('2020.06', ['请选择', '5月', '6月', '7月']), 2);
  assert.equal(findDateOptionIndex('2020.06', ['请选择', '05', '06', '07']), 2);
  assert.equal(findDateOptionIndex('2020.06', ['Month', 'May', 'Jun', 'Jul']), 2);
  assert.equal(findDateOptionIndex('2020.06', ['请选择', '2019 年', '2020 年']), 2);
});
