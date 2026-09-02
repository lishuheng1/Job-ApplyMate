import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureContentScriptForTab } from './contentScriptConnection.ts';

test('内容脚本失联时按握手流程注入并确认就绪', async () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  let pingCount = 0;
  const injections: unknown[] = [];
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      async get() { return { id: 7, url: 'https://jobs.example.com/apply' }; },
      async sendMessage() {
        pingCount += 1;
        if (pingCount === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { success: true, data: { ready: true } };
      },
    },
    webNavigation: {
      async getAllFrames() { return [{ frameId: 0 }]; },
    },
    scripting: {
      async executeScript(options: unknown) { injections.push(options); },
    },
  };

  try {
    const response = await ensureContentScriptForTab(7);
    assert.deepEqual(response, { success: true, data: { ready: true } });
    assert.equal(injections.length, 1);
  } finally {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});

test('浏览器内部页面不会尝试注入', async () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  let injected = false;
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: { async get() { return { id: 7, url: 'chrome://extensions/' }; } },
    webNavigation: { async getAllFrames() { return [{ frameId: 0 }]; } },
    scripting: { async executeScript() { injected = true; } },
  };

  try {
    const response = await ensureContentScriptForTab(7);
    assert.equal(response.success, false);
    assert.match(response.error || '', /不能填写/);
    assert.equal(injected, false);
  } finally {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});
