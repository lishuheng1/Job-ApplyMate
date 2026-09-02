import type { Message, MessageResponse } from '../shared/types.ts';

const CONNECTION_ERROR = /Receiving end does not exist|Could not establish connection/i;

function isRestrictedPage(url: string): boolean {
  return (
    /^(chrome|edge|about|chrome-extension|edge-extension):\/\//i.test(url)
    || /^https:\/\/chromewebstore\.google\.com\//i.test(url)
    || /^https:\/\/microsoftedge\.microsoft\.com\/addons\//i.test(url)
  );
}

async function isContentReady(tabId: number, frameId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'PING_CONTENT',
    } satisfies Message, { frameId }) as MessageResponse<{ ready?: boolean }>;
    return response.success && response.data?.ready === true;
  } catch {
    return false;
  }
}

async function getFrameIds(tabId: number): Promise<number[]> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  return [...new Set([0, ...(frames || []).map(frame => frame.frameId)])];
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

    const frameIds = await getFrameIds(tabId);
    const disconnectedFrameIds: number[] = [];
    for (const frameId of frameIds) {
      if (!(await isContentReady(tabId, frameId))) disconnectedFrameIds.push(frameId);
    }

    if (disconnectedFrameIds.length === 0) {
      return { success: true, data: { ready: true } };
    }

    // 仅重启失联的 frame：避免在已经可用的页面或 iframe 中重复注册监听器、重复填写。
    const injectedFrameIds = (await Promise.all(disconnectedFrameIds.map(async frameId => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          files: ['content.js'],
        });
        return frameId;
      } catch {
        return null;
      }
    }))).filter((frameId): frameId is number => frameId !== null);

    if (!injectedFrameIds.includes(0)) {
      return { success: false, error: '页面脚本未能启动。请刷新招聘页面后再试。' };
    }

    for (const delay of [100, 200, 350]) {
      await new Promise(resolve => setTimeout(resolve, delay));
      if (await isContentReady(tabId, 0)) {
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
