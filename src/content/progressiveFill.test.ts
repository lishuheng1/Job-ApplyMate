import assert from 'node:assert/strict';
import test from 'node:test';
import { runProgressiveFill } from './progressiveFill.ts';

test('逐项返回后立即写入，后续失败不会撤销已经完成的项目', async () => {
  const committed: number[] = [];

  await assert.rejects(() => runProgressiveFill({
    items: [1, 2, 3],
    resolveValue: async item => {
      if (item === 3) throw new Error('接口超时');
      return `value-${item}`;
    },
    applyValue: async item => {
      committed.push(item);
      return true;
    },
  }), /接口超时/);

  assert.deepEqual(committed, [1, 2]);
});

test('终止后不再请求下一项，已填写结果保持不变', async () => {
  const requested: number[] = [];
  const committed: number[] = [];
  let running = true;

  const result = await runProgressiveFill({
    items: [1, 2, 3],
    shouldContinue: () => running,
    resolveValue: async item => {
      requested.push(item);
      return `value-${item}`;
    },
    applyValue: async item => {
      committed.push(item);
      running = false;
      return true;
    },
  });

  assert.deepEqual(requested, [1]);
  assert.deepEqual(committed, [1]);
  assert.deepEqual(result, { processedCount: 1, filledCount: 1, cancelled: true });
});
