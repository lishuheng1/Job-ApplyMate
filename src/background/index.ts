import type {
  FocusedFieldWriteResult,
  LearnedFieldValue,
  Message,
  MessageResponse,
  UserProfile,
  ParsedResumeData,
  VisualRegionFillPayload,
  VisualRegionFillRequestPayload,
  WebDAVConfig,
} from '../shared/types.ts';
import { StorageService } from '../shared/storage.ts';
import {
  createBackupDocument,
  createBackupSummary,
  parseAndValidateBackup,
  serializeBackup,
} from '../shared/backup.ts';
import {
  enqueueSync,
  enqueueSyncAndWait,
  forceDownloadRemote,
  forceUploadLocal,
  resolveConflict,
} from '../shared/sync.ts';
import {
  normalizeWebDAVServerUrl,
  testConnection as testWebDAVConnection,
  validateWebDAVUrl,
} from '../services/webdav.ts';
import { parseResume, isStructuredType, parseStructuredResume } from '../parsers/index.ts';
import { NLPHelper } from '../utils/nlpHelper.ts';
import { LLMService } from '../services/llm/llmService.ts';
import {
  buildAnswerGenerationPrompt,
  buildResumeParsingPrompt,
  buildFieldMatchingPrompt,
  buildSectionFillPrompt,
} from '../services/llm/prompts.ts';
import type { AIFillSectionPayload } from '../services/llm/prompts.ts';
import type { LLMConfig } from '../services/llm/types.ts';
import { buildFieldMatchingCacheKey } from '../services/llm/fieldMatchingCache.ts';
import {
  getLearnedFieldsForDomain,
  updateLearnedFieldStore,
  type LearnedFieldStore,
} from '../shared/learnedFields.ts';
import {
  handleCreateApplicationRecord,
  handleCreateApplicationRecordDraft,
  handleDeleteApplicationRecord,
  handleExportApplicationRecordsCsv,
  handleGetApplicationRecordDraft,
  handleGetApplicationRecords,
  handleImportApplicationRecordsCsv,
  handleUpdateApplicationRecord,
} from './applicationRecords.ts';
import {
  captureVisibleRegion,
  handleVisualRegionFill,
} from './visualRegionFill.ts';
import { areEquivalentDates } from '../utils/dateValue.ts';
import { ensureContentScriptForTab } from './contentScriptConnection.ts';
import { createResumeVariant, getResumeLibrary } from '../shared/resumes.ts';

// Background Service Worker 入口
console.log('Background service worker started');

const aiFillControllers = new Map<string, AbortController>();

async function queueAutoSync(reason: string): Promise<'disabled' | 'queued'> {
  const config = await StorageService.getWebDAVConfig();
  if (!config?.enabled) return 'disabled';
  enqueueSync(reason);
  return 'queued';
}

async function handleGetLearnedFieldValues(domain: string): Promise<MessageResponse> {
  const settings = await StorageService.getSettings() || {};
  const store = (settings.learnedFieldValues || {}) as LearnedFieldStore;
  return { success: true, data: getLearnedFieldsForDomain(store, domain) };
}

async function handleSaveLearnedFieldValue(
  domain: string,
  entry: LearnedFieldValue,
): Promise<MessageResponse> {
  const normalizedDomain = domain.trim().toLowerCase();
  if (!normalizedDomain || !entry.signature.trim() || !entry.value.trim()) {
    return { success: false, error: '学习字段信息不完整' };
  }
  const [settingsValue, profile] = await Promise.all([
    StorageService.getSettings(),
    StorageService.getUserProfile(),
  ]);
  const settings = settingsValue || {};
  const store = (settings.learnedFieldValues || {}) as LearnedFieldStore;
  const nextStore = updateLearnedFieldStore(store, normalizedDomain, {
    signature: entry.signature,
    label: entry.label.slice(0, 160),
    value: entry.value.slice(0, 4000),
    profilePath: entry.profilePath || inferProfilePath(profile, entry.value),
    updatedAt: entry.updatedAt,
  });
  await StorageService.saveSettings({ ...settings, learnedFieldValues: nextStore });
  await queueAutoSync('learned-field-value');
  return { success: true };
}

function inferProfilePath(profile: UserProfile | null, expected: string): string | undefined {
  if (!profile || !expected.trim()) return undefined;
  const target = expected.replace(/\s+/g, ' ').trim().toLowerCase();
  const matches: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized === target || areEquivalentDates(value, expected)) matches.push(path);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (['fileData', 'parsedText', 'rawText', 'resume', 'resumes'].includes(key)) continue;
      visit(child, path ? `${path}.${key}` : key);
    }
  };
  visit(profile, '');
  return matches.sort((left, right) => left.length - right.length)[0];
}

// 监听消息
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    // 处理异步消息
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('Message handler error:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });

    // 返回 true 表示异步响应
    return true;
  }
);

// 处理消息
export async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender
): Promise<MessageResponse> {
  switch (message.type) {
    case 'GET_USER_PROFILE':
      return await handleGetUserProfile();

    case 'SAVE_USER_PROFILE':
      return await handleSaveUserProfile(message.payload);

    case 'GET_LEARNED_FIELD_VALUES':
      return await handleGetLearnedFieldValues(message.payload.domain);

    case 'SAVE_LEARNED_FIELD_VALUE':
      return await handleSaveLearnedFieldValue(message.payload.domain, message.payload.entry);

    case 'PARSE_RESUME':
      return await handleParseResume(
        message.payload.file,
        message.payload.fileType,
        message.payload.fileName,
        message.payload.category,
        message.payload.rawText
      );

    case 'CREATE_APPLICATION_RECORD_DRAFT':
      return await handleCreateApplicationRecordDraft(message.payload.tabId);

    case 'GET_APPLICATION_RECORD_DRAFT':
      return await handleGetApplicationRecordDraft(message.payload.draftId);

    case 'GET_APPLICATION_RECORDS':
      return await handleGetApplicationRecords();

    case 'CREATE_APPLICATION_RECORD':
      return await handleApplicationRecordMutation(
        () => handleCreateApplicationRecord(message.payload),
        'application-record-create',
      );

    case 'UPDATE_APPLICATION_RECORD':
      return await handleApplicationRecordMutation(
        () => handleUpdateApplicationRecord(message.payload),
        'application-record-update',
      );

    case 'DELETE_APPLICATION_RECORD':
      return await handleApplicationRecordMutation(
        () => handleDeleteApplicationRecord(message.payload.id),
        'application-record-delete',
      );

    case 'EXPORT_APPLICATION_RECORDS_CSV':
      return await handleExportApplicationRecordsCsv();

    case 'IMPORT_APPLICATION_RECORDS_CSV':
      return await handleApplicationRecordMutation(
        () => handleImportApplicationRecordsCsv(message.payload.csv),
        'application-record-import',
      );

    case 'GET_RESUME_DATA':
      return await handleGetResumeData();

    case 'GENERATE_ANSWER':
      return await handleGenerateAnswer(message.payload);

    case 'MATCH_FIELDS_LLM':
      return await handleMatchFieldsLLM(message.payload);

    case 'AI_FILL_SECTION':
      return await handleAIFillSection(message.payload);

    case 'AI_FILL_VISUAL_REGION':
      return await handleVisualRegionFillRequest(message.payload, sender);

    case 'CANCEL_AI_FILL':
      return handleCancelAIFill(message.payload.requestId);

    case 'WRITE_FOCUSED_FIELD':
      return await handleWriteFocusedField(message.payload.tabId, message.payload.value);

    case 'WRITE_FOCUSED_FIELD_FROM_PAGE':
      return sender.tab?.id
        ? await handleWriteFocusedField(sender.tab.id, message.payload.value)
        : { success: true, data: { written: false, reason: 'NO_ACTIVE_TAB' } };

    case 'ENSURE_CONTENT_SCRIPT':
      return await ensureContentScriptForTab(message.payload.tabId);

    case 'GET_LLM_CONFIG':
      return await handleGetLLMConfig();

    case 'SAVE_LLM_CONFIG':
      return await handleSaveLLMConfig(message.payload);

    case 'TEST_LLM_CONNECTION':
      return await handleTestConnection(message.payload);

    case 'EXPORT_BACKUP':
      return await handleExportBackup();

    case 'PREVIEW_BACKUP_IMPORT':
      return handlePreviewBackup(message.payload.json);

    case 'IMPORT_BACKUP':
      return await handleImportBackup(message.payload.json);

    case 'GET_WEBDAV_CONFIG':
      return { success: true, data: await StorageService.getWebDAVConfig() };

    case 'SAVE_WEBDAV_CONFIG':
      return await handleSaveWebDAVConfig(message.payload);

    case 'TEST_WEBDAV':
      return await handleTestWebDAV(message.payload);

    case 'GET_SYNC_STATUS':
      return { success: true, data: await StorageService.getSyncMetadata() };

    case 'SYNC_NOW':
      return { success: true, data: { status: await enqueueSyncAndWait('manual') } };

    case 'FORCE_UPLOAD_LOCAL':
      return { success: true, data: { status: await forceUploadLocal() } };

    case 'FORCE_DOWNLOAD_REMOTE':
      return { success: true, data: { status: await forceDownloadRemote() } };

    case 'RESOLVE_SYNC_CONFLICT':
      return {
        success: true,
        data: { status: await resolveConflict(message.payload.choice) },
      };

    default:
      return {
        success: false,
        error: 'Unknown message type'
      };
  }
}

async function handleApplicationRecordMutation(
  operation: () => Promise<MessageResponse>,
  reason: string,
): Promise<MessageResponse> {
  const response = await operation();
  if (response.success) {
    await queueAutoSync(reason);
  }
  return response;
}

async function handleWriteFocusedField(
  tabId: number,
  value: string
): Promise<MessageResponse<FocusedFieldWriteResult>> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.id) {
      return { success: true, data: { written: false, reason: 'NO_ACTIVE_TAB' } };
    }

    const url = tab.url || '';
    if (isRestrictedPage(url)) {
      return { success: true, data: { written: false, reason: 'RESTRICTED_PAGE' } };
    }

    const frames = typeof chrome.webNavigation?.getAllFrames === 'function'
      ? (await chrome.webNavigation.getAllFrames({ tabId })) || []
      : [];
    const frameIds = frames.length > 0 ? frames.map(frame => frame.frameId) : [0];
    let fallback: MessageResponse<FocusedFieldWriteResult> | null = null;
    for (const frameId of frameIds) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: 'APPLY_FOCUSED_FIELD',
          payload: { value },
        } satisfies Message, { frameId }) as MessageResponse<FocusedFieldWriteResult>;
        fallback ||= response;
        if (response.success && response.data?.written) return response;
      } catch {
        // Continue: the focused control may live in another frame.
      }
    }
    return fallback || { success: true, data: { written: false, reason: 'NO_FOCUSED_FIELD' } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /Receiving end does not exist|Could not establish connection/i.test(message)
      ? 'NO_CONTENT_SCRIPT'
      : 'NO_ACTIVE_TAB';
    return { success: true, data: { written: false, reason } };
  }
}

async function handleVisualRegionFillRequest(
  payload: VisualRegionFillPayload | VisualRegionFillRequestPayload,
  sender: chrome.runtime.MessageSender,
): Promise<MessageResponse> {
  const requestId = payload.requestId?.trim();
  let controller: AbortController | undefined;
  if (requestId) {
    controller = new AbortController();
    aiFillControllers.set(requestId, controller);
  }

  try {
    if (isVisualRegionFillPayload(payload)) {
      return await handleVisualRegionFill(payload, undefined, controller?.signal);
    }

    const windowId = sender.tab?.windowId;
    if (typeof windowId !== 'number') {
      return { success: false, error: '无法获取当前页面截图' };
    }

    const image = await captureVisibleRegion(windowId, payload.region);
    if (controller?.signal.aborted) {
      return { success: false, error: 'AI 补填已终止' };
    }

    const strictPayload: VisualRegionFillPayload = { ...payload, image };
    return await handleVisualRegionFill(strictPayload, undefined, controller?.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, error: 'AI 补填已终止' };
    }
    throw error;
  } finally {
    if (requestId) {
      aiFillControllers.delete(requestId);
    }
  }
}

function isVisualRegionFillPayload(
  payload: VisualRegionFillPayload | VisualRegionFillRequestPayload,
): payload is VisualRegionFillPayload {
  return 'image' in payload && Boolean(payload.image?.base64 && payload.image?.mimeType);
}

function isRestrictedPage(url: string): boolean {
  return (
    /^(chrome|edge|about|chrome-extension|edge-extension):\/\//i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com\//i.test(url) ||
    /^https:\/\/microsoftedge\.microsoft\.com\/addons\//i.test(url)
  );
}

async function handleAIFillSection(
  payload: AIFillSectionPayload
): Promise<MessageResponse<Record<string, string>>> {
  const controller = new AbortController();
  aiFillControllers.set(payload.requestId, controller);

  try {
    const config = await StorageService.getLLMConfig();
    if (!config?.apiKey) {
      return { success: false, error: '请先在设置中配置 AI 服务' };
    }

    const profile = await StorageService.getUserProfile();
    if (!profile) {
      return { success: false, error: '请先保存个人资料' };
    }

    const llm = new LLMService(config);
    const { system, user } = buildSectionFillPrompt(payload, profile);
    const result = await llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], controller.signal, { temperature: 0 });

    let jsonStr = result.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const rawMappings = JSON.parse(jsonStr) as Record<string, unknown>;
    const validFields = new Map(payload.fields.map(field => [String(field.index), field]));
    const allowedProfileValues = collectProfileValues(profile);
    const mappings: Record<string, string> = {};

    for (const [index, rawValue] of Object.entries(rawMappings)) {
      const field = validFields.get(index);
      if (!field || typeof rawValue !== 'string') continue;

      const value = rawValue.trim();
      if (!value) continue;
      if (field.options.length > 0 && !field.options.includes(value)) continue;
      if (!isAllowedProfileValue(value, allowedProfileValues)) continue;
      mappings[index] = value;
    }

    return { success: true, data: mappings };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, error: 'AI 补填已终止' };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI 补填失败',
    };
  } finally {
    aiFillControllers.delete(payload.requestId);
  }
}

function collectProfileValues(profile: UserProfile): string[] {
  const values: string[] = [];
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string') {
      if (value.trim() && key !== 'id') values.push(value.trim());
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item));
      return;
    }
    for (const [childKey, child] of Object.entries(value)) {
      if (['resume', 'resumes', 'fileData', 'parsedText', 'rawText'].includes(childKey)) continue;
      visit(child, childKey);
    }
  };
  visit(profile);
  return values;
}

function isAllowedProfileValue(value: string, allowed: string[]): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (allowed.some(candidate => (
    candidate.replace(/\s+/g, ' ').trim().toLowerCase() === normalized
    || areEquivalentDates(candidate, value)
  ))) return true;
  const year = normalized.match(/^((?:19|20)\d{2})年?$/)?.[1];
  const month = normalized.match(/^(0?[1-9]|1[0-2])(?:月|月份)$/)?.[1];
  if (allowed.some(candidate => {
    const compact = candidate.replace(/\s+/g, '').toLowerCase();
    if (year && compact.startsWith(year)) return true;
    if (month) {
      const candidateMonth = compact.match(/^(?:19|20)\d{2}[./-](\d{1,2})/)?.[1];
      if (candidateMonth && Number(candidateMonth) === Number(month)) return true;
    }
    if (normalized.length < 2 || normalized.length > 30 || compact.length > 30) return false;
    const negative = (text: string) => /^[不非无未否]/.test(text);
    return negative(compact) === negative(normalized)
      && (compact.includes(normalized) || normalized.includes(compact));
  })) return true;
  const parts = value.split(/[,，、/|;；\n]+/).map(part => part.trim()).filter(Boolean);
  return parts.length > 1 && parts.every(part => allowed.some(candidate => (
    candidate.toLowerCase() === part.toLowerCase()
  )));
}

function handleCancelAIFill(requestId: string): MessageResponse {
  const controller = aiFillControllers.get(requestId);
  if (!controller) {
    return { success: true, data: { cancelled: false } };
  }

  controller.abort();
  aiFillControllers.delete(requestId);
  return { success: true, data: { cancelled: true } };
}

// 获取用户资料
async function handleGetUserProfile(): Promise<MessageResponse<UserProfile>> {
  try {
    const profile = await StorageService.getUserProfile();
    return {
      success: true,
      data: profile || undefined
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get user profile'
    };
  }
}

// 保存用户资料
async function handleSaveUserProfile(
  profile: UserProfile
): Promise<MessageResponse> {
  try {
    const success = await StorageService.saveUserProfile(profile);
    const sync = success ? await queueAutoSync('profile-save') : 'disabled';
    return {
      success,
      data: success ? { localSaved: true, sync } : undefined,
      error: success ? undefined : 'Failed to save user profile'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save user profile'
    };
  }
}

/** 去掉空字符串/空白值，避免解析结果把已填字段清空 */
function dropEmptyValues<T extends object>(source: T | undefined): Partial<T> {
  if (!source) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && !value.trim()) continue;
    if (value === null || value === undefined) continue;
    result[key] = value;
  }
  return result as Partial<T>;
}

/**
 * 解析结果为空数组时保留原有内容。
 * 直接用 `parsed || current` 不行：空数组是真值，会把已有记录清空。
 */
function pickNonEmpty<T>(parsed: T[] | undefined, current: T[] | undefined): T[] {
  if (parsed && parsed.length > 0) return parsed;
  return current || [];
}

// 解析简历
async function handleParseResume(
  fileData: string,
  fileType: string,
  fileName: string,
  category?: string,
  preParsedText?: string
): Promise<MessageResponse> {
  try {
    const rawText = preParsedText ?? await parseResume(fileData, fileType);

    let parsedData: ParsedResumeData;
    let parseMethod: 'structured' | 'llm' | 'regex' = 'regex';
    let llmError: string | undefined;

    if (isStructuredType(fileType)) {
      // JSON 简历本身已结构化，直接映射，避免 LLM 二次推断带来的误差
      parsedData = parseStructuredResume(rawText);
      parseMethod = 'structured';
    } else {
      const llmConfig = await StorageService.getLLMConfig();
      if (llmConfig?.apiKey) {
        try {
          parsedData = await parseResumeWithLLM(rawText, llmConfig);
          parseMethod = 'llm';
        } catch (error) {
          // 静默回退会让用户以为 AI 生效了，这里记下原因并回报给界面
          llmError = error instanceof Error ? error.message : String(error);
          console.warn('LLM resume parsing failed, falling back to regex:', error);
          parsedData = NLPHelper.parseResumeText(rawText);
        }
      } else {
        parsedData = NLPHelper.parseResumeText(rawText);
      }
    }

    const currentProfile = await StorageService.getUserProfile();

    const resume = createResumeVariant({
      fileName,
      fileData,
      fileType,
      parsedText: rawText,
      uploadDate: new Date().toISOString(),
    }, {
      id: `resume-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      category,
    });
    const updatedProfile: UserProfile = {
      // 解析结果里的空值不能覆盖用户已填的内容
      personal: {
        ...(currentProfile?.personal || {}),
        ...dropEmptyValues(parsedData.personal)
      } as any,
      education: pickNonEmpty(parsedData.education, currentProfile?.education) as any,
      experience: pickNonEmpty(parsedData.experience, currentProfile?.experience) as any,
      projects: pickNonEmpty(parsedData.projects, currentProfile?.projects) as any,
      customInformation: currentProfile?.customInformation || [],
      skills: pickNonEmpty(parsedData.skills, currentProfile?.skills),
      certifications: currentProfile?.certifications || [],
      // resume 继续保留为旧版本兼容入口；新功能使用 resumes 简历库。
      resume,
      resumes: [...getResumeLibrary(currentProfile || {}), resume],
    };

    const saved = await StorageService.saveUserProfile(updatedProfile);
    if (!saved) {
      return { success: false, error: '简历已解析，但保存个人信息失败' };
    }
    await queueAutoSync('resume-save');

    return {
      success: true,
      data: {
        parsedData,
        rawText,
        parseMethod,
        llmError
      }
    };
  } catch (error) {
    console.error('Resume parsing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse resume'
    };
  }
}

// 获取简历数据
async function handleGetResumeData(): Promise<MessageResponse> {
  try {
    const profile = await StorageService.getUserProfile();
    return {
      success: true,
      data: profile?.resume || null
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get resume data'
    };
  }
}

// LLM 简历解析
async function parseResumeWithLLM(
  rawText: string,
  config: LLMConfig
): Promise<ParsedResumeData> {
  const llm = new LLMService(config);
  const { system, user } = buildResumeParsingPrompt(rawText);

  const result = await llm.chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], undefined, { temperature: 0 });

  let jsonStr = result.content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr);

  return {
    personal: parsed.personal,
    education: (parsed.education || []).map((e: any, i: number) => ({
      id: `edu-${i}`, ...e
    })),
    experience: (parsed.experience || []).map((e: any, i: number) => ({
      id: `exp-${i}`, ...e
    })),
    projects: (parsed.projects || []).map((p: any, i: number) => ({
      id: `proj-${i}`, ...p
    })),
    skills: parsed.skills || [],
    rawText,
  };
}

// AI 生成开放性问题回答
async function handleGenerateAnswer(
  payload: { questionText: string; context?: string; fieldMaxLength?: number; language?: 'zh' | 'en' }
): Promise<MessageResponse> {
  try {
    const config = await StorageService.getLLMConfig();
    if (!config?.apiKey) {
      return { success: false, error: '请先在设置中配置AI服务' };
    }

    const profile = await StorageService.getUserProfile();
    if (!profile) {
      return { success: false, error: '请先填写个人信息' };
    }

    const llm = new LLMService(config);
    const { system, user } = buildAnswerGenerationPrompt(payload, profile);

    const result = await llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);

    return { success: true, data: { answer: result.content } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI生成失败',
    };
  }
}

// LLM 语义字段匹配
async function handleMatchFieldsLLM(
  payload: { fields: Array<{ index: number; name: string; id: string; placeholder: string; labelText: string; type: string; contextText?: string }>; domain: string }
): Promise<MessageResponse> {
  try {
    const cacheKey = buildFieldMatchingCacheKey(payload.domain, payload.fields);
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) {
      const cachedResult = cached[cacheKey] as Record<string, string>;
      const allCovered = payload.fields.every(f => f.index.toString() in cachedResult);
      if (allCovered) {
        return { success: true, data: cachedResult };
      }
    }

    const config = await StorageService.getLLMConfig();
    if (!config?.apiKey) {
      return { success: false, error: 'LLM not configured' };
    }

    const llm = new LLMService(config);
    const { system, user } = buildFieldMatchingPrompt(payload.fields);

    const result = await llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], undefined, { temperature: 0 });

    let jsonStr = result.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const rawMappings: Record<string, unknown> = JSON.parse(jsonStr);
    const validIndexes = new Set(payload.fields.map(field => String(field.index)));
    const validFieldTypes = new Set([
      'name', 'gender', 'birthDate', 'phone', 'email', 'wechat', 'idCard',
      'school', 'college', 'educationType', 'major', 'degree', 'gpa',
      'selfEvaluation', 'educationStartDate', 'graduationDate', 'company',
      'position', 'startDate', 'endDate', 'description', 'projectName',
      'projectRole', 'projectStartDate', 'projectEndDate', 'projectDescription',
      'projectAchievements', 'projectTechnologies', 'skills', 'resumeFile', 'unknown',
    ]);
    const mappings: Record<string, string> = {};
    for (const [index, fieldType] of Object.entries(rawMappings)) {
      if (validIndexes.has(index) && typeof fieldType === 'string' && validFieldTypes.has(fieldType)) {
        mappings[index] = fieldType;
      }
    }

    await chrome.storage.local.set({ [cacheKey]: mappings });

    return { success: true, data: mappings };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '字段匹配失败',
    };
  }
}

// 获取 LLM 配置
async function handleGetLLMConfig(): Promise<MessageResponse> {
  try {
    const config = await StorageService.getLLMConfig();
    return { success: true, data: config };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get LLM config',
    };
  }
}

// 保存 LLM 配置
async function handleSaveLLMConfig(config: LLMConfig): Promise<MessageResponse> {
  try {
    const success = await StorageService.saveLLMConfig(config);
    const sync = success ? await queueAutoSync('llm-save') : 'disabled';
    return {
      success,
      data: success ? { localSaved: true, sync } : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save LLM config',
    };
  }
}

function backupFilename(date = new Date()): string {
  const compact = date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `job-applymate-backup-${compact}.json`;
}

async function handleExportBackup(): Promise<MessageResponse> {
  const [data, webdavConfig] = await Promise.all([
    StorageService.getBackupData(),
    StorageService.getWebDAVConfig(),
  ]);
  const document = createBackupDocument(
    data,
    chrome.runtime.getManifest().version,
    undefined,
    webdavConfig,
  );
  return {
    success: true,
    data: {
      json: serializeBackup(document),
      filename: backupFilename(),
    },
  };
}

function handlePreviewBackup(json: string): MessageResponse {
  const parsed = parseAndValidateBackup(json);
  if (!parsed.success) {
    return { success: false, error: `${parsed.error.code}: ${parsed.error.message}` };
  }
  return { success: true, data: createBackupSummary(parsed.document) };
}

async function handleImportBackup(json: string): Promise<MessageResponse> {
  const parsed = parseAndValidateBackup(json);
  if (!parsed.success) {
    return { success: false, error: `${parsed.error.code}: ${parsed.error.message}` };
  }
  // 备份里带 WebDAV 设置时一并恢复；旧备份没有该字段则保留当前配置。
  await StorageService.replaceBusinessData(parsed.document.data, parsed.document.webdavConfig);
  const sync = await queueAutoSync('backup-import');
  return {
    success: true,
    data: { imported: true, summary: createBackupSummary(parsed.document), sync },
  };
}

async function handleSaveWebDAVConfig(config: WebDAVConfig): Promise<MessageResponse> {
  const urlError = config.serverUrl.trim() ? validateWebDAVUrl(config.serverUrl) : null;
  if (config.enabled && !config.serverUrl.trim()) {
    return { success: false, error: '启用同步前请填写 WebDAV 服务器地址' };
  }
  if (urlError) return { success: false, error: urlError };
  await StorageService.saveWebDAVConfig({
    ...config,
    serverUrl: config.serverUrl.trim()
      ? normalizeWebDAVServerUrl(config.serverUrl)
      : '',
    username: config.username.trim(),
  });
  return { success: true };
}

async function handleTestWebDAV(config: WebDAVConfig): Promise<MessageResponse> {
  try {
    const result = await testWebDAVConnection(config);
    return {
      success: true,
      data: {
        exists: result.exists,
        message: result.exists ? '连接成功，已找到远端文件' : '连接成功，远端文件尚未创建',
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'WebDAV 连接测试失败',
    };
  }
}

// 测试 LLM 连接
// payload 为界面上当前填写的配置；缺省时回退到已保存的配置
async function handleTestConnection(payload?: LLMConfig | null): Promise<MessageResponse> {
  try {
    const config = payload ?? await StorageService.getLLMConfig();
    if (!config?.apiKey?.trim()) {
      return { success: false, error: '请先填写 API Key' };
    }
    if (!config.baseUrl?.trim()) {
      return { success: false, error: '请先填写 API 地址' };
    }
    if (!config.model?.trim()) {
      return { success: false, error: '请先填写模型名称' };
    }

    const llm = new LLMService(config);
    await llm.testConnection();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '连接测试失败',
    };
  }
}

// 监听安装事件
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details.reason);

  if (details.reason === 'install') {
    // 首次安装时打开选项页面
    chrome.runtime.openOptionsPage();
  }
});
