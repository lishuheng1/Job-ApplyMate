import { MessageService } from '../shared/message';
import type { Message, MessageResponse } from '../shared/types';

const FRAME_AWARE_MESSAGE_TYPES = new Set<Message['type']>([
  'DETECT_FIELDS',
  'PREVIEW_FILL',
  'FILL_FORM',
  'START_AI_PAGE_FILL',
  'UNDO_LAST_FILL',
]);

const CONNECTION_ERROR_PATTERN = /Receiving end does not exist|Could not establish connection/i;

type FrameResult = {
  frameId: number;
  response: MessageResponse<any>;
};

export function getUnsupportedPageMessage(url: string | undefined): string | null {
  if (!url) return null;

  if (/^(chrome|edge|brave|opera|vivaldi|about|devtools|view-source):/i.test(url)) {
    return '浏览器内部页面不允许扩展填写，请打开实际的招聘申请网页后再试。';
  }

  if (/^chrome-extension:/i.test(url)) {
    return '扩展页面不能作为招聘表单填写，请切换到实际的申请页面后再试。';
  }

  if (/^https?:\/\/(chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/i.test(url)) {
    return '浏览器扩展商店禁止网页扩展运行，请切换到实际的招聘申请页面。';
  }

  if (/^file:/i.test(url)) {
    return '当前是本地文件。请在扩展详情中开启“允许访问文件网址”，然后刷新页面再试。';
  }

  if (/\.pdf(?:[?#]|$)/i.test(url)) {
    return '浏览器内置的 PDF 页面不能直接填写，请打开招聘网站中的在线表单。';
  }

  return null;
}

function isConnectionError(response: MessageResponse): boolean {
  return !response.success && CONNECTION_ERROR_PATTERN.test(response.error || '');
}

async function getTargetFrameIds(tabId: number, message: Message): Promise<number[]> {
  if (!FRAME_AWARE_MESSAGE_TYPES.has(message.type)) return [0];

  const frames = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) || [];
  const ids = [...new Set([0, ...frames.map(frame => frame.frameId)])];
  return ids;
}

async function sendToFrames(tabId: number, frameIds: number[], message: Message): Promise<FrameResult[]> {
  return Promise.all(frameIds.map(async frameId => ({
    frameId,
    response: await MessageService.sendMessageToTab(tabId, message, { frameId }),
  })));
}

async function injectIntoFrames(tabId: number, frameIds: number[]): Promise<number[]> {
  const results = await Promise.all(frameIds.map(async frameId => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['content.js'],
      });
      return frameId;
    } catch (error) {
      console.debug(`Unable to inject content script into frame ${frameId}:`, error);
      return null;
    }
  }));

  return results.filter((frameId): frameId is number => frameId !== null);
}

function aggregateResponses<T>(message: Message, results: FrameResult[]): MessageResponse<T> {
  const successes = results.filter(result => result.response.success).map(result => result.response);

  if (successes.length === 0) {
    const firstNonConnectionError = results.find(result => !isConnectionError(result.response))?.response.error;
    return {
      success: false,
      error: firstNonConnectionError
        || '当前网页尚未连接到 Job ApplyMate。请刷新招聘页面后再试；扩展刚更新或重新加载后，已打开的网页必须刷新一次。',
    };
  }

  if (message.type === 'DETECT_FIELDS' || message.type === 'UNDO_LAST_FILL') {
    const count = successes.reduce((total, response) => total + Number(response.data?.count || 0), 0);
    return { success: true, data: { count } as T };
  }

  if (message.type === 'PREVIEW_FILL') {
    const items = successes.flatMap(response => response.data?.items || []);
    return { success: true, data: { items } as T };
  }

  return { success: true };
}

export async function sendMessageToActiveTab<T>(
  tabId: number,
  message: Message,
): Promise<MessageResponse<T>> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const unsupportedPageMessage = getUnsupportedPageMessage(tab?.url);
  if (unsupportedPageMessage) {
    return { success: false, error: unsupportedPageMessage };
  }

  const frameIds = await getTargetFrameIds(tabId, message);
  const initialResults = await sendToFrames(tabId, frameIds, message);
  const disconnectedFrameIds = initialResults
    .filter(result => isConnectionError(result.response))
    .map(result => result.frameId);

  if (disconnectedFrameIds.length === 0) {
    return aggregateResponses<T>(message, initialResults);
  }

  // 插件更新后，已打开的网页不会自动获得新版 content script。
  // 仅补载失联的 frame，避免对已经执行成功的 frame 重复发送填写指令。
  const injectedFrameIds = await injectIntoFrames(tabId, disconnectedFrameIds);
  if (injectedFrameIds.length === 0) {
    return aggregateResponses<T>(message, initialResults);
  }

  await new Promise(resolve => setTimeout(resolve, 120));
  const retryResults = await sendToFrames(tabId, injectedFrameIds, message);
  const retriedFrameIds = new Set(injectedFrameIds);
  const combinedResults = [
    ...initialResults.filter(result => !retriedFrameIds.has(result.frameId)),
    ...retryResults,
  ];

  return aggregateResponses<T>(message, combinedResults);
}
