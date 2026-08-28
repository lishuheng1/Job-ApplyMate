import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { openApplicationRecordOptions } from './App.tsx';

test('popup 右上角渲染新建投递记录和打开投递记录按钮', async () => {
  const popupModule = await import('./App.tsx');
  const html = renderToStaticMarkup(React.createElement(popupModule.default));
  assert.match(html, /新建投递记录/);
  assert.match(html, /打开投递记录/);
});

test('打开投递记录入口打开带 query 的设置页标签', async () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const createdTabs: Array<{ url?: string }> = [];

  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      getURL(path: string) {
        return `chrome-extension://test/${path}`;
      },
    },
    tabs: {
      async create(options: { url?: string }) {
        createdTabs.push(options);
      },
    },
  };

  try {
    await openApplicationRecordOptions();
    assert.equal(createdTabs.length, 1);
    assert.equal(
      createdTabs[0]?.url,
      'chrome-extension://test/src/options/index.html?tab=application-records',
    );
  } finally {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});
