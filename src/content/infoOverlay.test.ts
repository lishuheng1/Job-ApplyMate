import assert from 'node:assert/strict';
import test from 'node:test';
import { clampOverlayPosition } from './infoOverlay.ts';

test('悬浮窗位置始终限制在可见区域内', () => {
  assert.deepEqual(
    clampOverlayPosition({ left: 900, top: -50 }, { width: 1000, height: 700 }, { width: 420, height: 600 }),
    { left: 568, top: 12 },
  );
  assert.deepEqual(
    clampOverlayPosition({ left: -200, top: 300 }, { width: 1000, height: 700 }, { width: 420, height: 600 }),
    { left: 12, top: 88 },
  );
});
