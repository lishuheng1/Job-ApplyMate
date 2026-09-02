import type { Message, MessageResponse } from '../shared/types.ts';

const CONNECTION_ERROR = /Receiving end does not exist|Could not establish connection/i;

function isRestrictedPage(url: string): boolean {
  return (
    /^(chrome|edge|about|chrome-extension|edge-extension):\/\//i.test(url)
    || /^https:\/\/chromewebstore\.google\.com\//i.test(url)
    || /^https:\/\/microsoftedge\.microsoft\.com\/addons\//i.test(url)
  );
}

async function isContentReady(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'PING_CONTENT',
    } satisfies Message) as MessageResponse<{ ready?: boolean }>;
    return response.success && response.data?.ready === true;
  } catch {
    return false;
  }
}

/**
 * 页面侧采用 chaunyoffer 同样的握手机制：先探测，确实缺失才注入，然后再次确认。
 * 填充指令不再承担“把脚本叫醒”的职责，避免在不同网站的 iframe 中相互干扰。
 */
export async function ensureContentScriptForTab(
  tabId: number,
): Promise<MessageResponse<{ ready: boolean }>> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.id) return { success: false, error: '没有可用的当前网页' };
    if (isRestrictedPage(tab.url || '')) {
      return { success: false, error: '浏览器内部页面、扩展商店和内置 PDF 页面不能填写' };
    }

    if (await isContentReady(tabId)) {
      return { success: true, data: { ready: true } };
    }

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    });

    for (const delay of [100, 200, 350]) {
      await new Promise(resolve => setTimeout(resolve, delay));
      if (await isContentReady(tabId)) {
        return { success: true, data: { ready: true } };
      }
    }

    return {
      success: false,
      error: '页面脚本未能启动。请刷新招聘页面后再试。',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (CONNECTION_ERROR.test(message)) {
      return { success: false, error: '页面脚本未连接，请刷新招聘页面后再试。' };
    }
    return { success: false, error: `当前页面暂不支持填写：${message}` };
  }
}
