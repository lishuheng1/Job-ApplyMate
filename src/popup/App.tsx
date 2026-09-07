import React, { useState, useEffect } from 'react';
import { MessageService } from '../shared/message';
import type { FillPreviewItem, Message, MessageResponse, UserProfile } from '../shared/types';
import type { LLMConfig } from '../services/llm/types';

const APPLICATION_RECORDS_PAGE = 'src/application-records/index.html';

interface TabMessageSession {
  ready?: boolean;
  frameIds?: number[];
  fillFrameIds?: number[];
}

interface FillPreviewResponse {
  items: FillPreviewItem[];
  detectedCount?: number;
}

function getRuntimeUrl(path: string): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL(path)
    : `/${path.replace(/^\//, '')}`;
}

export async function openApplicationRecordCreateWindow(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('没有可用的当前页面');
  }

  const draftResponse = await MessageService.sendMessage<{ draftId: string }>({
    type: 'CREATE_APPLICATION_RECORD_DRAFT',
    payload: { tabId: tab.id },
  });
  if (!draftResponse.success || !draftResponse.data?.draftId) {
    throw new Error(draftResponse.error || '无法创建投递记录草稿');
  }

  await chrome.windows.create({
    url: getRuntimeUrl(`${APPLICATION_RECORDS_PAGE}?draftId=${encodeURIComponent(draftResponse.data.draftId)}`),
    type: 'popup',
    width: 520,
    height: 760,
    focused: true,
  });
}

export async function openApplicationRecordOptions(): Promise<void> {
  await chrome.tabs.create({
    url: getRuntimeUrl('src/options/index.html?tab=application-records'),
  });
}

function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(typeof window !== 'undefined');
  const [filling, setFilling] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [startingAIRegion, setStartingAIRegion] = useState(false);
  const [openingView, setOpeningView] = useState(false);
  const [openingApplicationCreate, setOpeningApplicationCreate] = useState(false);
  const [openingApplicationRecords, setOpeningApplicationRecords] = useState(false);
  const [detectedFields, setDetectedFields] = useState(0);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    loadProfile();
    detectFields();
  }, []);

  const loadProfile = async () => {
    try {
      const response = await MessageService.sendMessage<UserProfile>({
        type: 'GET_USER_PROFILE'
      });

      if (response.success && response.data) {
        setProfile(response.data);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const detectFields = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const response = await sendMessageToActiveTab<{ count: number }>(tab.id, {
        type: 'DETECT_FIELDS'
      });

      if (response.success && response.data) {
        setDetectedFields(response.data.count);
      }
    } catch (error) {
      console.error('Failed to detect fields:', error);
    }
  };

  const handleFillForm = async () => {
    if (!profile) {
      alert('请先设置个人信息！');
      openOptions();
      return;
    }

    setFilling(true);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) {
        throw new Error('No active tab');
      }

      // 预览与正式填写共享一次页面握手和 frame 列表。
      const messageSession: TabMessageSession = {};
      const preview = await sendMessageToActiveTab<FillPreviewResponse>(tab.id, {
        type: 'PREVIEW_FILL',
      }, messageSession);
      if (preview.success && preview.data?.items?.length) {
        const lines = preview.data.items.slice(0, 12)
          .map(item => `${item.label}：${item.value}`);
        const remaining = preview.data.items.length - lines.length;
        const confirmed = window.confirm(
          `准备填写 ${preview.data.items.length} 项：\n\n${lines.join('\n')}`
          + (remaining > 0 ? `\n……另有 ${remaining} 项` : '')
          + '\n\n确认写入吗？写入后可使用“撤销上次填充”。'
        );
        if (!confirmed) return;
      }

      const response = await sendMessageToActiveTab(tab.id, {
        type: 'FILL_FORM',
        payload: { reusePreview: true },
      }, messageSession);

      if (response.success) {
        alert('表单填充成功！');
      } else {
        alert('填充失败：' + (response.error || '未知错误'));
      }
    } catch (error) {
      console.error('Fill form error:', error);
      alert('填充表单时出错');
    } finally {
      setFilling(false);
    }
  };

  const handleAIScanFill = async () => {
    if (!profile) {
      alert('请先设置个人信息！');
      openOptions();
      return;
    }

    setAiScanning(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) {
        throw new Error('No active tab');
      }

      const response = await sendMessageToActiveTab(tab.id, {
        type: 'START_AI_PAGE_FILL',
      });

      if (!response.success) {
        alert('AI 扫描填充失败：' + (response.error || '未知错误'));
        return;
      }

      window.close();
    } catch (error) {
      console.error('AI scan fill error:', error);
      alert('启动 AI 扫描填充时出错');
    } finally {
      setAiScanning(false);
    }
  };

  const handleUndoLastFill = async () => {
    setUndoing(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('没有可用的当前页面');
      const response = await sendMessageToActiveTab<{ count: number }>(tab.id, { type: 'UNDO_LAST_FILL' });
      if (!response.success) throw new Error(response.error || '撤销失败');
      alert(response.data?.count ? `已恢复 ${response.data.count} 个字段` : '没有可撤销的填写');
    } catch (error) {
      alert(error instanceof Error ? error.message : '撤销失败');
    } finally {
      setUndoing(false);
    }
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const handleOpenApplicationRecordCreate = async () => {
    setOpeningApplicationCreate(true);
    try {
      await openApplicationRecordCreateWindow();
      window.close();
    } catch (error) {
      alert(error instanceof Error ? error.message : '打开新建投递记录失败');
      setOpeningApplicationCreate(false);
    }
  };

  const handleOpenApplicationRecords = async () => {
    setOpeningApplicationRecords(true);
    try {
      await openApplicationRecordOptions();
      window.close();
    } catch (error) {
      alert(error instanceof Error ? error.message : '打开投递记录失败');
      setOpeningApplicationRecords(false);
    }
  };

  const handleStartAIRegionFill = async () => {
    if (!profile) {
      alert('请先设置个人信息！');
      openOptions();
      return;
    }

    setStartingAIRegion(true);
    try {
      const llmConfigResponse = await MessageService.sendMessage<LLMConfig>({
        type: 'GET_LLM_CONFIG',
      });
      if (!llmConfigResponse.success || !llmConfigResponse.data?.apiKey?.trim()) {
        throw new Error('请先在设置中配置 AI 服务');
      }
      if (!llmConfigResponse.data.model.trim()) {
        throw new Error('请先在设置中填写模型名称');
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('没有可用的当前页面');

      const response = await sendMessageToActiveTab(tab.id, {
        type: 'START_AI_REGION_FILL',
      });
      if (!response.success) {
        throw new Error(response.error || '无法启动 AI 框选补填');
      }

      window.close();
    } catch (error) {
      alert(error instanceof Error ? error.message : '启动 AI 框选补填失败');
      setStartingAIRegion(false);
    }
  };

  const handleOpenSidePanel = async () => {
    setOpeningView(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('没有可用的当前页面');
      const response = await sendMessageToActiveTab<{ opened: boolean }>(tab.id, {
        type: 'OPEN_INFO_OVERLAY',
      });
      if (!response.success) throw new Error(response.error || '当前页面无法打开信息浮窗');
      window.close();
    } catch (error) {
      alert(error instanceof Error ? error.message : '打开资料窗口失败');
      setOpeningView(false);
    }
  };

  const sendMessageToActiveTab = async <T,>(
    tabId: number,
    message: Message,
    session?: TabMessageSession,
  ): Promise<MessageResponse<T>> => {
    const activeSession = session || {};
    const ensurePageReady = async (): Promise<MessageResponse<{ ready: boolean }>> =>
      MessageService.sendMessage<{ ready: boolean }>({
        type: 'ENSURE_CONTENT_SCRIPT',
        payload: { tabId },
      });

    if (!activeSession.ready) {
      const readiness = await ensurePageReady();
      if (!readiness.success) {
        return { success: false, error: readiness.error || '当前页面未能准备就绪' };
      }
      activeSession.ready = true;
    }

    const frameAwareTypes = new Set(['DETECT_FIELDS', 'PREVIEW_FILL', 'FILL_FORM', 'START_AI_PAGE_FILL', 'UNDO_LAST_FILL']);
    const sendOnce = async (): Promise<MessageResponse<T>> => {
      if (!frameAwareTypes.has(message.type)) {
        return MessageService.sendMessageToTab<T>(tabId, message, { frameId: 0 });
      }

      if (!activeSession.frameIds) {
        const frames = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) || [];
        activeSession.frameIds = frames.length > 0
          ? [...new Set(frames.map(frame => frame.frameId))]
          : [0];
      }
      const frameIds = message.type === 'FILL_FORM' && activeSession.fillFrameIds?.length
        ? activeSession.fillFrameIds
        : activeSession.frameIds;
      const frameResponses = await Promise.all(frameIds.map(async frameId => ({
        frameId,
        response: await MessageService.sendMessageToTab<any>(tabId, message, { frameId }),
      })));
      const successes = frameResponses.filter(item => item.response.success);
      if (successes.length === 0) return frameResponses[0]?.response as MessageResponse<T>;

      if (message.type === 'DETECT_FIELDS' || message.type === 'UNDO_LAST_FILL') {
        const count = successes.reduce((total, item) => total + Number(item.response.data?.count || 0), 0);
        return { success: true, data: { count } as T };
      }
      if (message.type === 'PREVIEW_FILL') {
        activeSession.fillFrameIds = successes
          .filter(item => Number(item.response.data?.detectedCount || 0) > 0 || item.response.data?.items?.length > 0)
          .map(item => item.frameId);
        const items = successes.flatMap(item => item.response.data?.items || []);
        const detectedCount = successes.reduce(
          (total, item) => total + Number(item.response.data?.detectedCount || 0),
          0,
        );
        return { success: true, data: { items, detectedCount } as T };
      }
      return { success: true };
    };

    let response = await sendOnce();
    const isDisconnected = () => !response.success
      && /Receiving end does not exist|Could not establish connection/i.test(response.error || '');

    if (isDisconnected()) {
      activeSession.ready = false;
      activeSession.frameIds = undefined;
      activeSession.fillFrameIds = undefined;
      const reconnect = await ensurePageReady();
      if (reconnect.success) {
        activeSession.ready = true;
        response = await sendOnce();
      }
    }

    if (isDisconnected()) {
      return {
        success: false,
        error: '当前网页未能连接到插件。请刷新招聘页面后重试。',
      };
    }

    return response;
  };

  if (loading) {
    return (
      <div className="popup-shell">
        <div className="popup-loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <img
          className="popup-brand-mark"
          src={getRuntimeUrl('icons/icon128.png')}
          alt=""
          aria-hidden="true"
        />
        <div>
          <h1>Job ApplyMate</h1>
          <p>你的求职申请搭档</p>
        </div>
        <div className="popup-header-actions">
          <button
            type="button"
            className="header-action-button"
            onClick={() => void handleOpenApplicationRecordCreate()}
            disabled={openingApplicationCreate || openingApplicationRecords}
          >
            {openingApplicationCreate ? '打开中...' : '新建投递记录'}
          </button>
          <button
            type="button"
            className="header-action-button header-action-button-secondary"
            onClick={() => void handleOpenApplicationRecords()}
            disabled={openingApplicationCreate || openingApplicationRecords}
          >
            {openingApplicationRecords ? '打开中...' : '打开投递记录'}
          </button>
        </div>
      </header>

      <div className="popup-content">
        {profile ? (
          <div className="profile-section">
            <div className="profile-card">
              <div className="profile-card-heading">当前信息</div>
              <div className="profile-row">
                <span className="profile-label">姓名</span>
                <span className="profile-value">{profile.personal.name || '未设置'}</span>
              </div>
              <div className="profile-row">
                <span className="profile-label">邮箱</span>
                <span className="profile-value">{profile.personal.email || '未设置'}</span>
              </div>
              <div className="profile-row">
                <span className="profile-label">手机</span>
                <span className="profile-value">{profile.personal.phone || '未设置'}</span>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{detectedFields}</div>
                <div className="stat-label">可填字段</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{profile.education.length}</div>
                <div className="stat-label">教育经历</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{profile.experience.length}</div>
                <div className="stat-label">工作经历</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="popup-empty-state">
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <p className="empty-title">尚未设置个人信息</p>
            <p className="empty-subtitle">完成资料设置后即可开始自动填充</p>
          </div>
        )}

        <div className="popup-actions">
          <button
            onClick={() => void handleOpenSidePanel()}
            disabled={openingView}
            className="button button-secondary"
          >
            {openingView ? '正在打开浮窗...' : '打开信息浮窗'}
          </button>

          <div className="fill-button-pair">
            <button
              onClick={handleFillForm}
              disabled={!profile || filling || aiScanning || startingAIRegion}
              className="button button-primary"
            >
              {filling ? '填充中...' : '快速填充'}
            </button>

            <button
              onClick={handleAIScanFill}
              disabled={!profile || filling || aiScanning || startingAIRegion}
              className="button button-ai"
            >
              {aiScanning ? '扫描中...' : 'AI 扫描填充'}
            </button>
          </div>

          <button
            onClick={handleStartAIRegionFill}
            disabled={!profile || filling || startingAIRegion}
            className="button button-tonal"
          >
            {startingAIRegion ? '正在启动框选...' : 'AI 框选补填'}
          </button>

          <button
            onClick={() => void handleUndoLastFill()}
            disabled={undoing || filling || aiScanning}
            className="button button-secondary"
          >
            {undoing ? '正在撤销...' : '撤销上次填充'}
          </button>

          <button onClick={openOptions} className="button button-quiet">
            设置个人信息
          </button>
        </div>

        {detectedFields === 0 && profile && (
          <div className="popup-hint">
            当前页面未检测到可填充的表单字段
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
