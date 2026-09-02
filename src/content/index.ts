import { FormDetector } from './formDetector';
import { FormFiller, type FillFailure, type FillSection } from './formFiller';
import { OpenQuestionDetector } from './openQuestionDetector';
import type { PageScanField, PageScanSection } from './pageScan';
import { FieldMatcher } from '../utils/fieldMatcher';
import {
  getChoiceQuestion,
  getControlOptions,
  getLogicalControlValue,
  isChoiceControl,
  isLogicalChoiceRepresentative,
} from './controlSemantics';
import { extractApplicationPageMetadata } from './applicationRecordMetadata.ts';
import { createVisualRegionFillController } from './visualRegionFill.ts';
import type {
  DetectedField,
  FocusedFieldWriteResult,
  LearnedFieldValue,
  Message,
  MessageResponse,
  UserProfile,
} from '../shared/types';

async function sendRuntimeMessage<T = any>(message: Message): Promise<MessageResponse<T>> {
  try {
    return await chrome.runtime.sendMessage(message) as MessageResponse<T>;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

console.log('Content script loaded');

// 初始化
const formDetector = new FormDetector();
const formFiller = new FormFiller();
const visualRegionFillController = createVisualRegionFillController({
  sendRuntimeMessage,
  fillElementValues: (values, shouldContinue) => formFiller.fillElementValues(
    values as Parameters<FormFiller['fillElementValues']>[0],
    shouldContinue,
  ),
  onFillComplete: () => showFailureReview(formFiller.getLastFailures()),
});
let detectedFields: DetectedField[] = [];
let lastFocusedControl:
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement
  | null = null;

async function getLearnedFieldValues(): Promise<Record<string, LearnedFieldValue>> {
  const response = await sendRuntimeMessage<Record<string, LearnedFieldValue>>({
    type: 'GET_LEARNED_FIELD_VALUES',
    payload: { domain: window.location.hostname },
  });
  return response.success && response.data ? response.data : {};
}

document.addEventListener('focusin', (event) => {
  const target = event.target;
  if (isWritableControl(target)) {
    lastFocusedControl = target;
  }
}, true);

function isWritableControl(
  target: EventTarget | null
): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLTextAreaElement) &&
    !(target instanceof HTMLSelectElement)
  ) {
    return false;
  }
  if (target.disabled) return false;

  if (target instanceof HTMLInputElement) {
    const unsupportedTypes = new Set([
      'hidden',
      'file',
      'button',
      'submit',
      'reset',
      'image',
    ]);
    if (unsupportedTypes.has(target.type.toLowerCase())) return false;
    if (target.readOnly) {
      return target.getAttribute('role') === 'combobox'
        || Boolean(target.closest('.ant-picker, .el-date-editor, .arco-picker, .semi-datepicker, [data-picker]'));
    }
  }

  if (target instanceof HTMLTextAreaElement && target.readOnly) return false;
  return true;
}

async function applyValueToFocusedControl(value: string): Promise<FocusedFieldWriteResult> {
  if (!lastFocusedControl) {
    return { written: false, reason: 'NO_FOCUSED_FIELD' };
  }
  if (!lastFocusedControl.isConnected) {
    lastFocusedControl = null;
    return { written: false, reason: 'FIELD_DETACHED' };
  }
  if (!isWritableControl(lastFocusedControl)) {
    return { written: false, reason: 'FIELD_NOT_WRITABLE' };
  }

  const written = await formFiller.fillFocusedControl(lastFocusedControl, value);
  return written
    ? { written: true }
    : { written: false, reason: 'VALUE_REJECTED' };
}

// 页面加载完成后检测表单
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDetection);
} else {
  initializeDetection();
}

function initializeDetection() {
  // 延迟检测，等待动态内容加载
  setTimeout(() => {
    detectedFields = formDetector.detectFields();
    injectAIButtons();
  }, 1000);

  // 开始监听 DOM 变化
  formDetector.startObserving((fields) => {
    detectedFields = fields;
    if (fields.length > 0) {
      console.log(`Re-detected ${fields.length} fields`);
      injectAIButtons();
    }
  });
}

// 处理填充按钮点击
async function handleFillButtonClick() {
  await fillSection('all');
}

async function handleAIPageFill() {
  const status = showAIRegionStatus('正在扫描整页表单...');
  const requestId = crypto.randomUUID();
  let cancelled = false;

  status.setCancelHandler(async () => {
    if (cancelled) return;
    cancelled = true;
    status.update('正在终止 AI 扫描填充...');
    await sendRuntimeMessage({
      type: 'CANCEL_AI_FILL',
      payload: { requestId },
    });
    status.update('AI 扫描填充已终止', 'warning');
  });

  try {
    const response = await sendRuntimeMessage<UserProfile>({
      type: 'GET_USER_PROFILE',
    });
    if (!response.success || !response.data) {
      throw new Error('请先在插件选项页面中设置个人信息');
    }

    await formFiller.prepareDynamicSections(response.data, 'all');
    formFiller.beginFillSession();
    detectedFields = formDetector.detectFields();
    let scannedFields = collectPageScanFields();
    const learnedValues = await getLearnedFieldValues();
    const learnedFillItems = scannedFields.flatMap(field => {
      const learned = learnedValues[formFiller.getFieldSignature(field.element)];
      const value = formFiller.getLearnedValue(learned, response.data!);
      return value ? [{ element: field.element, value }] : [];
    });
    let filledCount = 0;
    if (learnedFillItems.length > 0) {
      filledCount += await formFiller.fillElementValues(learnedFillItems, () => !cancelled);
      scannedFields = collectPageScanFields();
    }
    if (scannedFields.length === 0) {
      status.update(
        filledCount > 0 ? `已使用学习记录填充 ${filledCount} 项` : '未检测到可扫描的空白表单字段',
        filledCount > 0 ? 'success' : 'warning',
      );
      showFailureReview(formFiller.getLastFailures());
      return;
    }

    status.update(`AI 正在按表单块识别 ${scannedFields.length} 个逻辑字段...`);
    filledCount += await fillPageScanGroup(
      'other',
      scannedFields,
      requestId,
      () => !cancelled,
    );

    if (cancelled) return;

    // AI 没有返回值的字段也属于本次未完成项，加入复盘面板供用户纠正和学习。
    for (const field of scannedFields) {
      if (!getControlValue(field.element)) {
        formFiller.markUnresolvedField(field.element, field.label || field.name || '未识别字段');
      }
    }

    const fileInputs = formDetector.findFileInputs();
    if (fileInputs.length > 0 && response.data.resume) {
      for (const fileInput of fileInputs) {
        await formFiller.uploadResume(
          fileInput,
          response.data.resume.fileData,
          response.data.resume.fileName,
        );
      }
    }

    status.update(`AI 扫描填充完成：已填 ${filledCount} 项`, 'success');
    showFailureReview(formFiller.getLastFailures());
  } catch (error) {
    if (cancelled) return;
    console.error('AI page scan fill failed:', error);
    status.update(
      `AI 扫描填充失败：${error instanceof Error ? error.message : '未知错误'}`,
      'error',
    );
  }
}

async function fillSection(section: FillSection) {
  try {
    // 获取用户资料
    const response = await sendRuntimeMessage<UserProfile>({
      type: 'GET_USER_PROFILE'
    });

    if (!response.success || !response.data) {
      alert('请先在插件选项页面中设置个人信息！');
      return;
    }

    // 先补足需要点击“添加”才会出现的动态经历行，再重新检测字段
    await formFiller.prepareDynamicSections(response.data, section);
    detectedFields = formDetector.detectFields();

    // 网站字段学习结果不依赖本次识别是否成功：即使规则和 AI 都不认识该字段，
    // 只要它与用户上次纠正的控件签名一致，就直接优先尝试填写。
    formFiller.beginFillSession();
    const learnedValues = await getLearnedFieldValues();
    const learnedUnmatchedItems = formDetector.getUnmatchedFields()
      .filter(({ element }) => section === 'all' || getElementSection(element) === section)
      .filter(({ element }) => !getControlValue(element) && isLikelyApplicationControl(element))
      .flatMap(({ element }) => {
        const learned = learnedValues[formFiller.getFieldSignature(element)];
        const value = formFiller.getLearnedValue(learned, response.data!);
        return value ? [{ element, value }] : [];
      });
    const learnedUnmatchedCount = await formFiller.fillElementValues(learnedUnmatchedItems);

    // 尝试用 LLM 匹配低置信度字段
    await enhanceDetectionWithLLM();

    const fieldsToFill = filterFieldsBySection(detectedFields, section)
      .filter(field => !getControlValue(field.element) && isLikelyApplicationControl(field.element));

    if (fieldsToFill.length === 0 && learnedUnmatchedCount === 0 && formFiller.getLastFailures().length === 0) {
      alert('未检测到可填充的表单字段');
      return;
    }

    // 填充表单
    await formFiller.fillForm(fieldsToFill, response.data, learnedValues);

    // 处理简历文件上传
    const fileInputs = formDetector.findFileInputs();
    if (fileInputs.length > 0 && response.data.resume) {
      for (const fileInput of fileInputs) {
        try {
          await formFiller.uploadResume(
            fileInput,
            response.data.resume.fileData,
            response.data.resume.fileName
          );
        } catch (error) {
          console.error('Failed to upload resume to input:', error);
        }
      }
    }

    // 显示成功消息
    showSuccessMessage();
    for (const unmatched of formDetector.getUnmatchedFields()) {
      const element = unmatched.element;
      const belongsToApplicationForm = isLikelyApplicationControl(element);
      if (belongsToApplicationForm && !getControlValue(element)) {
        formFiller.markUnresolvedField(unmatched.element);
      }
    }
    showFailureReview(formFiller.getLastFailures());

  } catch (error) {
    console.error('Fill form error:', error);
    alert('填充表单时出错，请查看控制台了解详情');
  }
}

function filterFieldsBySection(fields: DetectedField[], section: FillSection): DetectedField[] {
  if (section === 'all') return fields;

  return fields.filter(field => getElementSection(field.element) === section);
}

function getElementSection(element: Element): FillSection | null {
  const module = element.closest<HTMLElement>('[class*=applyFormModuleWrapper], section, fieldset, [role="group"]');
  const text = (module?.textContent || '').replace(/\s+/g, ' ').toLowerCase();

  if (/基本信息|personal information|contact information/.test(text)) return 'personal';
  if (/教育经历|教育背景|education/.test(text)) return 'education';
  if (/实习经历|工作经历|work experience|employment/.test(text)) return 'experience';
  if (/项目经历|project experience|projects/.test(text)) return 'projects';

  return null;
}

function startAIRegionSelection() {
  formFiller.beginFillSession();
  visualRegionFillController.beginVisualRegionFill();
}

type ScannedPageField = PageScanField & {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
};

function collectPageScanFields(): ScannedPageField[] {
  const roots: ParentNode[] = [document];
  for (let index = 0; index < roots.length; index++) {
    for (const host of Array.from(roots[index].querySelectorAll('*'))) {
      if (host.shadowRoot && !roots.includes(host.shadowRoot)) roots.push(host.shadowRoot);
    }
  }
  const elements = roots.flatMap(root => Array.from(
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="hidden"]):not([type="file"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="range"]):not([type="color"]), textarea, select',
    ),
  )).filter(element => {
    if (!isLogicalChoiceRepresentative(element)) return false;
    const visible = element.getClientRects().length > 0
      || (isChoiceControl(element) && getControlOptions(element).length > 0);
    if (!visible || element.disabled) return false;
    if ('readOnly' in element && element.readOnly && element.getAttribute('role') !== 'combobox') {
      return false;
    }
    return !getControlValue(element) && isLikelyApplicationControl(element);
  });
  const blockIds = new WeakMap<HTMLElement, string>();
  const blockRows = new Map<PageScanSection, Map<HTMLElement, number>>();
  const fieldIdentities = new Map(elements.map(element => {
    const identifiers = FieldMatcher.extractIdentifiers(element);
    const identity = (identifiers.labelText || identifiers.name || identifiers.placeholder)
      .replace(/\d+/g, '#')
      .replace(/\s+/g, '')
      .toLowerCase();
    return [element, identity] as const;
  }));
  let nextBlockId = 1;

  return elements.map((element, index) => {
    const container = element.closest<HTMLElement>(
      '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name]',
    );
    const name = (
      element.getAttribute('data-form-field-name') ||
      container?.getAttribute('data-form-field-name') ||
      element.getAttribute('data-form-field-id') ||
      container?.getAttribute('data-form-field-id') ||
      (element as HTMLInputElement).name ||
      ''
    ).trim();
    const identifiers = FieldMatcher.extractIdentifiers(element);
    const label = (
      (isChoiceControl(element) ? getChoiceQuestion(element) : '') ||
      element.getAttribute('data-form-field-i18n-name') ||
      container?.getAttribute('data-form-field-i18n-name') ||
      identifiers.labelText ||
      identifiers.placeholder ||
      ''
    ).trim();
    const section = toPageScanSection(getElementSection(element));
    const block = findLogicalFormBlock(element, elements, fieldIdentities);
    let blockId = blockIds.get(block);
    if (!blockId) {
      blockId = `block-${nextBlockId++}`;
      blockIds.set(block, blockId);
    }
    const rows = blockRows.get(section) || new Map<HTMLElement, number>();
    if (!blockRows.has(section)) blockRows.set(section, rows);
    if (!rows.has(block)) rows.set(block, rows.size);
    const dateInputs = isDateRangeControl(name, label) && container
      ? Array.from(container.querySelectorAll('input:not([type="hidden"]), textarea, select'))
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      : [];
    const datePosition = dateInputs.indexOf(element);
    const isDateRange = dateInputs.length > 0;
    const context = `${getPageSectionName(section)}；${(container?.textContent || element.parentElement?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)}`;

    return {
      element,
      index,
      rowIndex: rows.get(block) || 0,
      section,
      name,
      label,
      type: isDateRange
        ? (datePosition === 1 ? 'date-end' : 'date-start')
        : isChoiceControl(element)
          ? element.type
          : (element.getAttribute('role') === 'combobox' ? 'combobox' : element.tagName.toLowerCase()),
      options: getKnownOptions(element, label, name),
      context,
      blockId,
      blockContext: `${getPageSectionName(section)}；${(block.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500)}`,
    };
  });
}

function isLikelyApplicationControl(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): boolean {
  const identifiers = FieldMatcher.extractIdentifiers(element);
  const semanticText = `${identifiers.name} ${identifiers.labelText} ${identifiers.placeholder} ${identifiers.contextText}`
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const applicationWords = /申请|应聘|求职|简历|个人信息|联系方式|教育|学历|学校|专业|实习|工作经历|项目经历|技能|证件|application|candidate|resume|education|employment|experience|project|skills?/i;
  const utilityWords = /搜索|查询|验证码|订阅|登录|注册|search|captcha|newsletter|sign\s*in|log\s*in/i;
  if (utilityWords.test(semanticText) && !applicationWords.test(semanticText)) return false;
  if (getElementSection(element)) return true;
  if (element.required || element.getAttribute('aria-required') === 'true') return true;
  if (element.closest(
    '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name], [class*=applyForm], [class*=formItem], [class*=form-item]'
  )) return true;
  const form = element.closest('form');
  if (!form) return false;
  const formText = (form.textContent || '').replace(/\s+/g, ' ').slice(0, 3000);
  const controlCount = form.querySelectorAll('input:not([type="hidden"]), textarea, select').length;
  return controlCount >= 2 && applicationWords.test(`${formText} ${semanticText}`);
}

function findLogicalFormBlock(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  allElements: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  fieldIdentities: Map<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, string>,
): HTMLElement {
  let current: HTMLElement | null = element.parentElement;
  let best = element.parentElement || document.body;
  for (let depth = 0; current && current !== document.body && depth < 8; depth++, current = current.parentElement) {
    const members = allElements.filter(candidate => current?.contains(candidate));
    const memberCount = members.length;
    if (memberCount > 14) break;
    const textLength = (current.textContent || '').replace(/\s+/g, '').length;
    const identities = members.map(candidate => fieldIdentities.get(candidate) || '').filter(Boolean);
    const crossesRepeatedRows = memberCount >= 4 && new Set(identities).size < identities.length;
    if (crossesRepeatedRows && best !== element.parentElement) break;
    if (memberCount >= 2 && textLength <= 600) best = current;
    if (current.matches('fieldset, [role="group"], [role="radiogroup"], [class*=row], [class*=entry], [class*=record]') && memberCount >= 2) {
      best = current;
    }
  }
  return best;
}

function getControlValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (isChoiceControl(element)) return getLogicalControlValue(element);
  const container = element.closest<HTMLElement>(
    '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name]',
  );
  return (
    container?.querySelector('.ud__select__selector__selectItem')?.textContent ||
    element.value ||
    ''
  ).trim();
}

function isDateRangeControl(name: string, label: string): boolean {
  return name === 'start_end_time' || label === '起止时间';
}

function toPageScanSection(section: FillSection | null): PageScanSection {
  return section && section !== 'all' ? section : 'other';
}

function getPageSectionName(section: PageScanSection): string {
  return {
    personal: '基本信息',
    education: '教育经历',
    experience: '实习经历',
    projects: '项目经历',
    other: '其它表单',
  }[section];
}

async function fillPageScanGroup(
  section: PageScanSection,
  fields: ScannedPageField[],
  requestId: string,
  shouldContinue: () => boolean,
): Promise<number> {
  const response = await sendRuntimeMessage<Record<string, string>>({
    type: 'AI_FILL_SECTION',
    payload: {
      requestId,
      section,
      domain: window.location.hostname,
      fields: fields.map(field => ({
        index: field.index,
        rowIndex: field.rowIndex,
        name: field.name,
        label: field.label,
        type: field.type,
        options: field.options,
        context: field.context,
      })),
    },
  });

  if (!response.success || !response.data) {
    throw new Error(response.error || 'AI 未返回扫描结果');
  }

  const values = Object.entries(response.data)
    .map(([index, value]) => {
      const field = fields.find(item => item.index === Number(index));
      return field ? { element: field.element, value } : null;
    })
    .filter((item): item is {
      element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      value: string;
    } => Boolean(item))
    .sort((a, b) => getDateRangeFillPriority(a.element) - getDateRangeFillPriority(b.element));

  return formFiller.fillElementValues(values, shouldContinue);
}

function showAIRegionStatus(initialText: string) {
  const element = document.createElement('div');
  const textElement = document.createElement('span');
  const cancelButton = document.createElement('button');
  element.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:1000005;max-width:440px;padding:12px 14px;border-radius:8px;background:#24262d;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.28);font:500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;gap:12px;';
  textElement.textContent = initialText;
  cancelButton.type = 'button';
  cancelButton.textContent = '终止';
  cancelButton.style.cssText = 'flex:none;padding:5px 10px;border:1px solid rgba(255,255,255,.65);border-radius:5px;background:transparent;color:#fff;cursor:pointer;font:500 12px inherit;';
  element.append(textElement, cancelButton);
  document.body.appendChild(element);

  return {
    setCancelHandler(handler: () => void | Promise<void>) {
      cancelButton.onclick = () => {
        cancelButton.disabled = true;
        cancelButton.textContent = '终止中';
        void handler();
      };
    },
    update(text: string, type: 'normal' | 'success' | 'warning' | 'error' = 'normal') {
      textElement.textContent = text;
      element.style.background = type === 'success'
        ? '#15803d'
        : type === 'warning'
          ? '#a16207'
          : type === 'error'
            ? '#b91c1c'
            : '#24262d';
      if (type !== 'normal') {
        cancelButton.remove();
        setTimeout(() => element.remove(), 5000);
      }
    },
  };
}

function getKnownOptions(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  label: string,
  name: string,
): string[] {
  const semanticOptions = getControlOptions(element);
  if (semanticOptions.length > 0) return semanticOptions;
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options)
      .filter(option => !option.disabled && Boolean(option.value || option.text.trim()))
      .map(option => option.text.trim())
      .filter(Boolean);
  }
  const controlledId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
  if (controlledId) {
    const controlled = document.getElementById(controlledId);
    const options = Array.from(controlled?.querySelectorAll<HTMLElement>('[role="option"]') || [])
      .map(option => (option.textContent || '').trim()).filter(Boolean);
    if (options.length > 0) return options;
  }
  if (label === '学历类型' || name === 'education_type') {
    return ['海外及港澳台', '统招全日制', '统招非全日制', '自考', '其他'];
  }
  if (label === '学历' || name === 'degree') {
    return ['高中', '专科', '本科', '硕士', '博士'];
  }
  return [];
}

function getDateRangeFillPriority(element: Element): number {
  const container = element.closest<HTMLElement>(
    '[data-form-field-id="start_end_time"], [data-form-field-name="start_end_time"], [data-form-field-i18n-name="起止时间"]'
  );
  if (!container) return 2;

  const inputs = Array.from(
    container.querySelectorAll('input:not([type="hidden"]), textarea, select')
  ).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  return inputs.indexOf(element) === 1 ? 0 : 1;
}

// 使用 LLM 增强字段检测
async function enhanceDetectionWithLLM() {
  const unmatched = formDetector.getUnmatchedFields()
    .filter(({ element }) => !getControlValue(element) && isLikelyApplicationControl(element));
  if (unmatched.length === 0) return;

  try {
    const payload = {
      fields: unmatched.map((f, i) => ({
        index: i,
        name: f.identifiers.name,
        id: f.identifiers.id,
        placeholder: f.identifiers.placeholder,
        labelText: f.identifiers.labelText,
        type: f.identifiers.type,
        contextText: f.identifiers.contextText,
      })),
      domain: window.location.hostname,
    };

    const response = await sendRuntimeMessage({
      type: 'MATCH_FIELDS_LLM',
      payload,
    });

    if (response.success && response.data) {
      const mappings = response.data as Record<string, string>;
      for (const [indexStr, fieldType] of Object.entries(mappings)) {
        const idx = parseInt(indexStr);
        if (fieldType !== 'unknown' && unmatched[idx]) {
          detectedFields.push({
            element: unmatched[idx].element,
            fieldType,
            confidence: 0.75,
          });
        }
      }
    }
  } catch (error) {
    console.warn('LLM field matching failed:', error);
  }
}

// 注入 AI 生成按钮到开放性问题旁
function injectAIButtons() {
  const detector = new OpenQuestionDetector();
  const openFields = detector.detect();

  for (const field of openFields) {
    if (field.element.parentElement?.querySelector('.ai-gen-btn')) continue;

    const btn = document.createElement('button');
    btn.className = 'ai-gen-btn';
    btn.textContent = 'AI 生成';
    btn.style.cssText = `
      margin-left: 8px; margin-top: 6px; padding: 4px 12px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white; border: none; border-radius: 4px;
      font-size: 12px; cursor: pointer; display: inline-block;
    `;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.textContent = '生成中...';
      (btn as HTMLButtonElement).disabled = true;

      const response = await sendRuntimeMessage({
        type: 'GENERATE_ANSWER',
        payload: {
          questionText: field.questionText,
          context: field.context,
          fieldMaxLength: parseInt(field.element.getAttribute('maxlength') || '0') || undefined,
          language: /[一-鿿]/.test(field.questionText) ? 'zh' : 'en',
        },
      });

      if (response.success && response.data) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(field.element, response.data.answer);
        } else {
          field.element.value = response.data.answer;
        }
        field.element.dispatchEvent(new Event('input', { bubbles: true }));
        field.element.dispatchEvent(new Event('change', { bubbles: true }));
        field.element.style.border = '2px solid #667eea';
        btn.textContent = 'AI 生成 ✓';
      } else {
        btn.textContent = '生成失败';
        console.error('Generation failed:', response.error);
      }

      setTimeout(() => {
        btn.textContent = 'AI 生成';
        (btn as HTMLButtonElement).disabled = false;
      }, 3000);
    });

    field.element.insertAdjacentElement('afterend', btn);
  }
}

function showFailureReview(failures: FillFailure[]): void {
  document.getElementById('job-applymate-failure-review')?.remove();
  if (failures.length === 0) return;

  const panel = document.createElement('section');
  const header = document.createElement('div');
  const title = document.createElement('strong');
  const subtitle = document.createElement('span');
  const list = document.createElement('div');
  const skipAll = document.createElement('button');
  panel.id = 'job-applymate-failure-review';
  panel.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:1000008;width:min(460px,calc(100vw - 36px));max-height:min(680px,calc(100vh - 36px));display:flex;flex-direction:column;overflow:hidden;border:1px solid #9fded0;border-radius:18px 18px 18px 6px;background:#f8fffd;color:#0b2630;box-shadow:0 24px 70px rgba(7,59,76,.28);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  header.style.cssText = 'padding:16px 18px 14px;background:linear-gradient(135deg,#073b4c,#0f766e);color:#fff;';
  title.style.cssText = 'display:block;font-size:16px;line-height:1.3;';
  subtitle.textContent = '可以修正后填写并记住，也可以跳过本次。';
  subtitle.style.cssText = 'display:block;margin-top:5px;color:rgba(255,255,255,.72);font-size:12px;';
  list.style.cssText = 'display:grid;gap:10px;padding:12px;overflow:auto;';
  skipAll.type = 'button';
  skipAll.textContent = '本次全部不填';
  skipAll.style.cssText = 'margin:0 12px 12px;min-height:38px;border:1px solid #bfd9d3;border-radius:10px;background:#fff;color:#526b6e;font-weight:650;cursor:pointer;';

  let remaining = failures.length;
  const updateTitle = () => {
    title.textContent = `${remaining} 项未能自动填写`;
    if (remaining === 0) panel.remove();
  };
  updateTitle();
  header.append(title, subtitle);

  for (const failure of failures) {
    const row = document.createElement('div');
    const label = document.createElement('div');
    const options = formFiller.getCorrectionOptions(failure.element);
    const input = options.length > 0
      ? document.createElement('select')
      : document.createElement('input');
    const actions = document.createElement('div');
    const remember = document.createElement('button');
    const skip = document.createElement('button');
    const feedback = document.createElement('div');
    row.style.cssText = 'padding:12px;border:1px solid #d5e6e1;border-radius:12px;background:#fff;';
    label.textContent = failure.label || failure.fieldType;
    label.style.cssText = 'margin-bottom:7px;font-weight:700;color:#163b43;';
    if (input instanceof HTMLSelectElement) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '请选择网站中的选项';
      input.appendChild(placeholder);
      for (const optionText of options) {
        const option = document.createElement('option');
        option.value = optionText;
        option.textContent = optionText;
        input.appendChild(option);
      }
      input.value = options.includes(failure.attemptedValue) ? failure.attemptedValue : '';
    } else {
      input.value = failure.attemptedValue;
      input.placeholder = '输入网站接受的值';
      const sourceType = failure.element instanceof HTMLInputElement ? failure.element.type : '';
      input.type = sourceType === 'date' || sourceType === 'month' ? sourceType : 'text';
    }
    input.style.cssText = 'width:100%;min-height:38px;padding:8px 10px;box-sizing:border-box;border:1px solid #bfd9d3;border-radius:9px;background:#fff;color:#0b2630;outline:none;';
    actions.style.cssText = 'display:flex;gap:8px;margin-top:9px;';
    remember.type = 'button';
    remember.textContent = '填写并记住';
    remember.style.cssText = 'flex:1;min-height:34px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;';
    skip.type = 'button';
    skip.textContent = '本次不填';
    skip.style.cssText = 'min-height:34px;padding:0 12px;border:1px solid #d5e6e1;border-radius:9px;background:#f6faf9;color:#607477;font-weight:650;cursor:pointer;';
    feedback.style.cssText = 'min-height:0;margin-top:0;color:#c2410c;font-size:12px;';

    const removeRow = () => {
      row.remove();
      remaining--;
      updateTitle();
    };
    skip.onclick = removeRow;
    remember.onclick = async () => {
      const value = input.value.trim();
      if (!value) {
        feedback.textContent = '请先输入准备填写的值';
        feedback.style.marginTop = '7px';
        return;
      }
      remember.disabled = true;
      remember.textContent = '正在填写...';
      const count = await formFiller.fillElementValues([{ element: failure.element, value }]);
      if (count === 0) {
        feedback.textContent = '仍未写入，请填写网站下拉选项中显示的准确文字后重试';
        feedback.style.marginTop = '7px';
        remember.disabled = false;
        remember.textContent = '再次尝试';
        return;
      }
      const saved = await sendRuntimeMessage({
        type: 'SAVE_LEARNED_FIELD_VALUE',
        payload: {
          domain: window.location.hostname,
          entry: {
            signature: failure.signature,
            label: failure.label,
            value,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      if (!saved.success) {
        feedback.textContent = saved.error || '已填写，但保存学习记录失败';
        feedback.style.marginTop = '7px';
        remember.disabled = false;
        remember.textContent = '重新保存';
        return;
      }
      removeRow();
    };
    actions.append(remember, skip);
    row.append(label, input, actions, feedback);
    list.append(row);
  }

  skipAll.onclick = () => panel.remove();
  panel.append(header, list, skipAll);
  document.body.append(panel);
}

// 显示成功消息
function showSuccessMessage() {
  const message = document.createElement('div');
  message.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000000;
    background: #10b981;
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 10px;
    animation: slideIn 0.3s ease;
  `;

  message.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>表单填充成功！</span>
  `;

  document.body.appendChild(message);

  setTimeout(() => {
    message.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => {
      document.body.removeChild(message);
    }, 300);
  }, 3000);
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_APPLICATION_PAGE_METADATA') {
    sendResponse({
      success: true,
      data: extractApplicationPageMetadata(document, window.location.href),
    });
    return true;
  }

  if (message.type === 'DETECT_FIELDS') {
    detectedFields = formDetector.detectFields();
    sendResponse({
      success: true,
      data: {
        count: detectedFields.length,
        fields: detectedFields.map((f) => ({
          fieldType: f.fieldType,
          confidence: f.confidence
        }))
      }
    });
    return true;
  }

  if (message.type === 'FILL_FORM') {
    handleFillButtonClick().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (message.type === 'PREVIEW_FILL') {
    sendRuntimeMessage<UserProfile>({ type: 'GET_USER_PROFILE' }).then(response => {
      if (!response.success || !response.data) {
        sendResponse({ success: false, error: '请先保存个人资料' });
        return;
      }
      detectedFields = formDetector.detectFields();
      sendResponse({
        success: true,
        data: { items: formFiller.buildFillPreview(detectedFields, response.data) },
      });
    }).catch(error => {
      sendResponse({ success: false, error: error instanceof Error ? error.message : '生成预览失败' });
    });
    return true;
  }

  if (message.type === 'UNDO_LAST_FILL') {
    formFiller.undoLastFill().then((count) => {
      sendResponse({ success: true, data: { count } });
    }).catch((error) => {
      sendResponse({ success: false, error: error instanceof Error ? error.message : '撤销失败' });
    });
    return true;
  }

  if (message.type === 'START_AI_PAGE_FILL') {
    handleAIPageFill().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'AI 扫描填充失败',
      });
    });
    return true;
  }

  if (message.type === 'START_AI_REGION_FILL') {
    startAIRegionSelection();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'APPLY_FOCUSED_FIELD') {
    applyValueToFocusedControl(message.payload.value).then((result) => {
      sendResponse({ success: true, data: result });
    }).catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : '写入目标字段失败',
      });
    });
    return true;
  }
});

// 添加 CSS 动画
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);
