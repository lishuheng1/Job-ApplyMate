import type { UserProfile } from '../shared/types.ts';
import { buildBasicInfoItems } from '../sidepanel/basicInfo.ts';

const HOST_ID = 'job-applymate-info-overlay-host';
const POSITION_KEY = 'jobApplyMateInfoOverlayPosition';
const PANEL_WIDTH = 420;
const EDGE_GAP = 12;
const CONTROLLER_KEY = '__jobApplyMateInfoOverlayControllerV1__';

type Position = { left: number; top: number };
type FieldItem = { key: string; label: string; value: string };
type Section = { title: string; groups: Array<{ title?: string; fields: FieldItem[] }> };

export type InfoOverlayController = {
  open(resumeId?: string | null): Promise<void>;
  setResume(resumeId?: string | null): Promise<void>;
  destroy(): void;
};

export function clampOverlayPosition(
  position: Position,
  viewport: { width: number; height: number },
  panel: { width: number; height: number },
): Position {
  return {
    left: Math.max(EDGE_GAP, Math.min(position.left, viewport.width - panel.width - EDGE_GAP)),
    top: Math.max(EDGE_GAP, Math.min(position.top, viewport.height - panel.height - EDGE_GAP)),
  };
}

export function createInfoOverlayController(options: {
  getProfile: (resumeId?: string | null) => Promise<UserProfile | null>;
  writeValue: (value: string) => Promise<{ written: boolean; reason?: string }>;
  openSettings: () => void;
}): InfoOverlayController {
  const controllerRegistry = globalThis as typeof globalThis & {
    [CONTROLLER_KEY]?: InfoOverlayController;
  };
  // content.js 可能被网站导航和连接恢复流程重复注入。先停用旧控制器，避免多个“自动恢复”实例叠在一起。
  controllerRegistry[CONTROLLER_KEY]?.destroy();
  let host: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  let statusTimer: number | null = null;
  let visible = false;
  let disposed = false;
  let activeResumeId: string | null | undefined;

  const setHostPosition = (position: Position) => {
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const clamped = clampOverlayPosition(position, {
      width: window.innerWidth,
      height: window.innerHeight,
    }, {
      width: rect.width || Math.min(PANEL_WIDTH, window.innerWidth - EDGE_GAP * 2),
      height: rect.height || Math.min(760, window.innerHeight - EDGE_GAP * 2),
    });
    host.style.setProperty('left', `${clamped.left}px`, 'important');
    host.style.setProperty('top', `${clamped.top}px`, 'important');
    host.style.setProperty('right', 'auto', 'important');
  };

  const showStatus = (text: string, kind: 'normal' | 'success' | 'warning' = 'normal') => {
    const element = shadow?.querySelector<HTMLElement>('[data-overlay-status]');
    if (!element) return;
    element.textContent = text;
    element.dataset.kind = kind;
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (element.isConnected) {
        element.textContent = '先点击网页输入框，再点击下方资料';
        element.dataset.kind = 'normal';
      }
    }, 2800);
  };

  const ensureHost = () => {
    if (host?.isConnected && shadow) return;
    document.getElementById(HOST_ID)?.remove();
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-job-applymate-overlay', 'true');
    for (const [property, value] of Object.entries({
      position: 'fixed',
      top: '90px',
      right: '20px',
      width: `min(${PANEL_WIDTH}px, calc(100vw - ${EDGE_GAP * 2}px))`,
      height: `min(760px, calc(100vh - ${EDGE_GAP * 2}px))`,
      zIndex: '2147483647',
      display: 'none',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      colorScheme: 'light',
      isolation: 'isolate',
    })) {
      host.style.setProperty(property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`), value, 'important');
    }
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${OVERLAY_CSS}</style><main class="panel" aria-label="Job ApplyMate 信息浮窗">
      <header class="header" data-drag-handle>
        <div class="brand"><span class="brand-mark">✓</span><span><strong>Job ApplyMate</strong><small data-resume-label>默认资料</small></span></div>
        <div class="header-actions">
          <button class="icon-button" type="button" data-settings title="设置个人资料">设置</button>
          <button class="icon-button close-button" type="button" data-close title="关闭">×</button>
        </div>
      </header>
      <div class="status" data-overlay-status data-kind="normal">先点击网页输入框，再点击下方资料</div>
      <div class="content" data-overlay-content><div class="loading">正在加载资料…</div></div>
      <footer>拖动顶部可移动 · 位置会自动保存</footer>
    </main>`;
    document.documentElement.appendChild(host);

    shadow.querySelector('[data-close]')?.addEventListener('click', () => {
      visible = false;
      host?.style.setProperty('display', 'none', 'important');
    });
    shadow.querySelector('[data-settings]')?.addEventListener('click', options.openSettings);
    installDragging();
  };

  const installDragging = () => {
    const handle = shadow?.querySelector<HTMLElement>('[data-drag-handle]');
    if (!handle || !host) return;
    let drag: { pointerId: number; offsetX: number; offsetY: number } | null = null;
    handle.addEventListener('pointerdown', event => {
      if ((event.target as Element).closest('button')) return;
      const rect = host!.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      setHostPosition({ left: event.clientX - drag.offsetX, top: event.clientY - drag.offsetY });
    });
    const finishDrag = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId || !host) return;
      drag = null;
      const rect = host.getBoundingClientRect();
      void chrome.storage.local.set({ [POSITION_KEY]: { left: rect.left, top: rect.top } });
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
  };

  const renderProfile = (profile: UserProfile | null) => {
    const content = shadow?.querySelector<HTMLElement>('[data-overlay-content]');
    if (!content) return;
    const resumeLabel = shadow?.querySelector<HTMLElement>('[data-resume-label]');
    const selectedResume = activeResumeId
      ? profile?.resumes?.find(resume => resume.id === activeResumeId)
      : undefined;
    if (resumeLabel) {
      resumeLabel.textContent = selectedResume
        ? `${selectedResume.category} · ${selectedResume.fileName}`
        : '默认资料';
    }
    content.replaceChildren();
    if (!profile) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<strong>还没有个人资料</strong><span>请先在设置中保存资料。</span>';
      const button = document.createElement('button');
      button.className = 'primary-button';
      button.textContent = '去设置资料';
      button.addEventListener('click', options.openSettings);
      empty.appendChild(button);
      content.appendChild(empty);
      return;
    }

    for (const [sectionIndex, section] of buildSections(profile).entries()) {
      const details = document.createElement('details');
      details.className = 'section';
      details.open = sectionIndex < 2;
      const summary = document.createElement('summary');
      const fieldCount = section.groups.reduce((total, group) => total + group.fields.filter(field => field.value).length, 0);
      summary.innerHTML = `<span>${escapeHtml(section.title)}</span><span class="count">${fieldCount}</span>`;
      details.appendChild(summary);
      for (const group of section.groups) {
        const card = document.createElement('div');
        card.className = 'group';
        if (group.title) {
          const heading = document.createElement('div');
          heading.className = 'group-title';
          heading.textContent = group.title;
          card.appendChild(heading);
        }
        for (const field of group.fields) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'field';
          button.disabled = !field.value;
          button.dataset.profileKey = field.key;
          const label = document.createElement('span');
          label.className = 'field-label';
          label.textContent = field.label;
          const value = document.createElement('span');
          value.className = field.value ? 'field-value' : 'field-value empty-value';
          value.textContent = field.value || '未填写';
          button.append(label, value);
          if (field.value) {
            // 不让资料按钮抢走网页输入框焦点；即使页面的 focus 事件被框架拦截，仍能直接读取 activeElement。
            button.addEventListener('pointerdown', event => event.preventDefault());
            button.addEventListener('click', () => void writeField(field.value, field.label, button));
          }
          card.appendChild(button);
        }
        details.appendChild(card);
      }
      content.appendChild(details);
    }
  };

  const writeField = async (value: string, label: string, button: HTMLButtonElement) => {
    button.classList.add('working');
    showStatus(`正在写入“${label}”…`);
    try {
      const result = await options.writeValue(value);
      if (result.written) {
        showStatus(`已写入“${label}”`, 'success');
        return;
      }
      const reason = result.reason === 'NO_FOCUSED_FIELD'
        ? '请先点击网页中的目标输入框'
        : result.reason === 'FIELD_DETACHED'
          ? '网页字段已刷新，请重新点击后再试'
          : '该网页控件未接受这个值';
      try {
        await navigator.clipboard.writeText(value);
        showStatus(`${reason}，已复制“${label}”`, 'warning');
      } catch {
        showStatus(reason, 'warning');
      }
    } finally {
      button.classList.remove('working');
    }
  };

  const open = async (resumeId?: string | null) => {
    if (disposed) return;
    activeResumeId = resumeId;
    ensureHost();
    if (!host) return;
    visible = true;
    host.style.setProperty('display', 'block', 'important');
    const stored = await chrome.storage.local.get(POSITION_KEY).catch(() => ({})) as Record<string, unknown>;
    const position = stored[POSITION_KEY] as Position | undefined;
    if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
      setHostPosition(position);
    } else {
      setHostPosition({ left: window.innerWidth - Math.min(PANEL_WIDTH, window.innerWidth - EDGE_GAP * 2) - 20, top: 90 });
    }
    renderProfile(await options.getProfile(activeResumeId));
  };

  const setResume = async (resumeId?: string | null) => {
    if (disposed) return;
    activeResumeId = resumeId;
    if (visible) renderProfile(await options.getProfile(activeResumeId));
  };

  const onResize = () => {
    if (!visible || !host) return;
    const rect = host.getBoundingClientRect();
    setHostPosition({ left: rect.left, top: rect.top });
  };
  window.addEventListener('resize', onResize);
  const handleStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (visible && areaName === 'local' && changes.userProfile) {
      void options.getProfile(activeResumeId).then(renderProfile);
    }
  };
  chrome.storage.onChanged.addListener(handleStorageChange);

  const observer = new MutationObserver(() => {
    if (visible && host && !host.isConnected) document.documentElement.appendChild(host);
  });
  observer.observe(document.documentElement, { childList: true });

  const controller: InfoOverlayController = {
    open,
    setResume,
    destroy() {
      if (disposed) return;
      disposed = true;
      visible = false;
      if (statusTimer !== null) window.clearTimeout(statusTimer);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      chrome.storage.onChanged.removeListener(handleStorageChange);
      host?.remove();
      host = null;
      shadow = null;
    },
  };
  controllerRegistry[CONTROLLER_KEY] = controller;
  return controller;
}

function buildSections(profile: UserProfile): Section[] {
  const recordFields = <T extends { id: string }>(
    prefix: string,
    records: T[],
    fields: Array<{ key: keyof T; label: string }>,
    title: (record: T, index: number) => string,
  ) => records.map((record, index) => ({
    title: title(record, index),
    fields: fields.map(field => ({
      key: `${prefix}-${record.id}-${String(field.key)}`,
      label: field.label,
      value: String(record[field.key] ?? '').trim(),
    })),
  }));

  return [
    {
      title: '基本信息',
      groups: [{ fields: buildBasicInfoItems(profile.personal).map(item => ({
        key: `personal-${String(item.key)}`,
        label: item.label,
        value: item.value,
      })) }],
    },
    {
      title: '教育经历',
      groups: recordFields('education', profile.education, [
        { key: 'school', label: '学校' }, { key: 'college', label: '学院' },
        { key: 'educationType', label: '学习形式' }, { key: 'major', label: '专业' },
        { key: 'majorCategory', label: '专业类别' }, { key: 'degree', label: '学历层次' },
        { key: 'academicDegree', label: '学位' }, { key: 'startDate', label: '入学时间' },
        { key: 'endDate', label: '毕业时间' }, { key: 'gpa', label: 'GPA / 成绩' },
        { key: 'ranking', label: '排名' },
      ], (record, index) => [record.degree, record.school].filter(Boolean).join(' · ') || `教育经历 ${index + 1}`),
    },
    {
      title: '实习经历',
      groups: recordFields('experience', profile.experience, [
        { key: 'company', label: '公司 / 机构' }, { key: 'position', label: '岗位' },
        { key: 'startDate', label: '开始时间' }, { key: 'endDate', label: '结束时间' },
        { key: 'description', label: '工作内容' }, { key: 'achievements', label: '成果' },
      ], (record, index) => record.company || `实习经历 ${index + 1}`),
    },
    {
      title: '项目经历',
      groups: recordFields('projects', profile.projects, [
        { key: 'name', label: '项目名称' }, { key: 'role', label: '角色' },
        { key: 'startDate', label: '开始时间' }, { key: 'endDate', label: '结束时间' },
        { key: 'description', label: '项目描述' }, { key: 'achievements', label: '成果' },
        { key: 'technologies', label: '技术栈' },
      ], (record, index) => record.name || `项目经历 ${index + 1}`),
    },
    {
      title: '技能与证书',
      groups: [
        { title: '技能', fields: profile.skills.map((value, index) => ({ key: `skill-${index}`, label: `技能 ${index + 1}`, value })) },
        ...recordFields('certifications', profile.certifications, [
          { key: 'name', label: '证书名称' }, { key: 'issuer', label: '颁发机构' },
          { key: 'date', label: '获得时间' }, { key: 'credentialId', label: '证书编号' },
        ], (record, index) => record.name || `证书 ${index + 1}`),
      ],
    },
    {
      title: '自定义信息',
      groups: [{ fields: (profile.customInformation || []).map((record, index) => ({
        key: `custom-${record.id}`,
        label: record.name.trim() || `自定义信息 ${index + 1}`,
        value: record.content.trim(),
      })) }],
    },
  ];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

const OVERLAY_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel { height: 100%; overflow: hidden; display: flex; flex-direction: column; color: #173336; background: #f7fbfa; border: 1px solid #b8d9d5; border-radius: 18px; box-shadow: 0 18px 48px rgba(12, 49, 52, .24), 0 3px 12px rgba(12, 49, 52, .16); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .header { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 12px 16px; color: white; background: linear-gradient(135deg, #0d6966, #11887d); cursor: move; user-select: none; touch-action: none; }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .brand > span:last-child { display: flex; flex-direction: column; }
  .brand strong { font-size: 16px; letter-spacing: .1px; }
  .brand small { margin-top: 1px; color: rgba(255,255,255,.76); font-size: 11px; }
  .brand-mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: #0d6966; background: #eafff9; font-size: 18px; font-weight: 800; }
  .header-actions { display: flex; align-items: center; gap: 5px; }
  button { font: inherit; }
  .icon-button { border: 0; border-radius: 8px; padding: 6px 8px; color: white; background: rgba(255,255,255,.13); cursor: pointer; }
  .icon-button:hover { background: rgba(255,255,255,.23); }
  .close-button { width: 30px; font-size: 20px; line-height: 18px; }
  .status { flex: none; padding: 9px 14px; color: #426164; background: #e8f5f3; border-bottom: 1px solid #d1e6e3; font-size: 12px; }
  .status[data-kind="success"] { color: #075e43; background: #dff7ec; }
  .status[data-kind="warning"] { color: #895208; background: #fff3d9; }
  .content { flex: 1; min-height: 0; overflow: auto; padding: 10px; scrollbar-color: #9bc9c3 transparent; }
  .section { margin-bottom: 9px; border: 1px solid #d6e8e5; border-radius: 12px; background: white; overflow: hidden; }
  summary { display: flex; align-items: center; justify-content: space-between; padding: 11px 12px; color: #173f41; background: #eff8f6; cursor: pointer; font-weight: 700; }
  summary::-webkit-details-marker { display: none; }
  .count { min-width: 23px; padding: 1px 7px; border-radius: 999px; color: #0e6f69; background: #d8efeb; text-align: center; font-size: 11px; }
  .group { padding: 8px; border-top: 1px solid #e5f0ee; }
  .group-title { padding: 2px 4px 7px; color: #31575a; font-size: 12px; font-weight: 700; }
  .field { width: 100%; display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 9px; align-items: start; margin: 0 0 6px; padding: 9px 10px; border: 1px solid #dceae8; border-radius: 9px; color: #173336; background: #fbfefd; cursor: pointer; text-align: left; transition: border-color .15s, background .15s, transform .15s; }
  .field:last-child { margin-bottom: 0; }
  .field:hover:not(:disabled) { border-color: #5bb2a8; background: #edf9f6; transform: translateY(-1px); }
  .field.working { opacity: .65; }
  .field:disabled { cursor: default; opacity: .54; }
  .field-label { color: #627c7e; font-size: 12px; font-weight: 650; }
  .field-value { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  .empty-value { color: #9aacab; }
  .loading, .empty { display: flex; min-height: 220px; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #648083; text-align: center; }
  .empty strong { color: #274d50; font-size: 16px; }
  .primary-button { margin-top: 8px; padding: 9px 16px; border: 0; border-radius: 9px; color: white; background: #11857b; cursor: pointer; font-weight: 700; }
  footer { flex: none; padding: 8px 12px; color: #789092; background: white; border-top: 1px solid #e2eeec; font-size: 11px; text-align: center; }
`;
