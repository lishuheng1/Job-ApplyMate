import assert from 'node:assert/strict';
import test from 'node:test';
import { getUnsupportedPageMessage, sendMessageToActiveTab } from './tabMessaging.ts';

test('为浏览器受限页面返回明确提示', () => {
  assert.match(getUnsupportedPageMessage('chrome://extensions') || '', /浏览器内部页面/);
  assert.match(getUnsupportedPageMessage('file:///C:/resume.pdf') || '', /允许访问文件网址/);
  assert.equal(getUnsupportedPageMessage('https://jobs.example.com/apply'), null);
});

test('插件更新后为失联的主页面补载 content script 并重试', async () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const injectedFrames: number[][] = [];
  let sendCount = 0;

  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      async get() {
        return { url: 'https://jobs.example.com/apply' };
      },
      async sendMessage() {
        sendCount += 1;
        if (sendCount === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { success: true, data: { count: 2 } };
      },
    },
    webNavigation: {
      async getAllFrames() {
        return [{ frameId: 0 }];
      },
    },
    scripting: {
      async executeScript(options: { target: { frameIds: number[] } }) {
        injectedFrames.push(options.target.frameIds);
      },
    },
  };

  try {
    const response = await sendMessageToActiveTab<{ count: number }>(1, { type: 'DETECT_FIELDS' });
    assert.equal(response.success, true);
    assert.equal(response.data?.count, 2);
    assert.deepEqual(injectedFrames, [[0]]);
  } finally {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});

test('只重试失联的内嵌页面，不重复执行已经成功的主页面', async () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const sends: number[] = [];

  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      async get() {
        return { url: 'https://jobs.example.com/apply' };
      },
      async sendMessage(_tabId: number, _message: unknown, options: { frameId: number }) {
        sends.push(options.frameId);
        if (options.frameId === 1 && sends.filter(id => id === 1).length === 1) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { success: true, data: { count: options.frameId === 0 ? 2 : 1 } };
      },
    },
    webNavigation: {
      async getAllFrames() {
        return [{ frameId: 0 }, { frameId: 1 }];
      },
    },
    scripting: {
      async executeScript() {},
    },
  };

  try {
    const response = await sendMessageToActiveTab<{ count: number }>(1, { type: 'DETECT_FIELDS' });
    assert.equal(response.success, true);
    assert.equal(response.data?.count, 3);
    assert.deepEqual(sends, [0, 1, 1]);
  } finally {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});

test('重连仍失败时不再暴露浏览器英文底层错误', async () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      async get() {
        return { url: 'https://jobs.example.com/apply' };
      },
      async sendMessage() {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
    },
    webNavigation: {
      async getAllFrames() {
        return [{ frameId: 0 }];
      },
    },
    scripting: {
      async executeScript() {},
    },
  };

  try {
    const response = await sendMessageToActiveTab(1, { type: 'FILL_FORM' });
    assert.equal(response.success, false);
    assert.match(response.error || '', /刷新招聘页面/);
    assert.doesNotMatch(response.error || '', /Could not establish connection/);
  } finally {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});
