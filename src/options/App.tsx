import React, { useState, useEffect } from 'react';
import { MessageService } from '../shared/message';
import type {
  UserProfile,
  PersonalInfo,
  CustomInformation,
  ParsedResumeData,
} from '../shared/types';
import { AISettings } from './AISettings';
import { EducationSection } from './EducationSection';
import { ExperienceSection } from './ExperienceSection';
import { DataSyncSettings } from './DataSyncSettings';
import { ApplicationRecordsSection } from './ApplicationRecordsSection';
import { parsePDF } from '../parsers/pdfParser';
import { parseDOCX } from '../parsers/docxParser';
import { removeResumeVariant } from '../shared/resumes.ts';

const OPTION_TABS = [
  'personal',
  'education',
  'experience',
  'custom',
  'resume',
  'ai',
  'data-sync',
  'application-records',
] as const;

type OptionTab = typeof OPTION_TABS[number];

function getInitialActiveTab(search: string): OptionTab {
  const tab = new URLSearchParams(search).get('tab');
  return OPTION_TABS.includes(tab as OptionTab) ? tab as OptionTab : 'personal';
}

function hasChromeApis(): boolean {
  return typeof chrome !== 'undefined'
    && typeof chrome.storage !== 'undefined'
    && typeof chrome.runtime !== 'undefined';
}

/** MIME 类型到扩展名的兜底映射，用于文件名缺少扩展名的情况 */
const MIME_TO_EXT: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/markdown': 'md',
  'text/plain': 'txt',
};
const LOCAL_RESUME_PARSE_TIMEOUT_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * 解析上传文件的类型。优先取文件名扩展名；
 * 文件名无扩展名（或含多个点导致误判）时回退到 MIME 类型。
 */
function resolveFileType(file: File): string {
  const name = file.name.trim();
  const dotIndex = name.lastIndexOf('.');
  const ext = dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';

  const known = ['pdf', 'doc', 'docx', 'md', 'markdown', 'txt', 'json'];
  if (known.includes(ext)) return ext;

  return MIME_TO_EXT[file.type] || ext;
}

/**
 * 汇总本次实际提取到的内容，用于上传后的提示。
 * 解析请求成功不代表提取到了字段，提示需要如实反映结果。
 */
function summarizeParsed(data: ParsedResumeData | undefined): string {
  if (!data) return '';

  const personalCount = Object.values(data.personal || {})
    .filter(value => typeof value === 'string' && value.trim()).length;

  const parts: string[] = [];
  if (personalCount > 0) parts.push(`个人信息 ${personalCount} 项`);
  if (data.education?.length) parts.push(`教育经历 ${data.education.length} 条`);
  if (data.experience?.length) parts.push(`工作/实习经历 ${data.experience.length} 条`);
  if (data.projects?.length) parts.push(`项目经历 ${data.projects.length} 条`);
  if (data.skills?.length) parts.push(`技能 ${data.skills.length} 项`);

  return parts.join('、');
}

/**
 * 在设置页（有 DOM）先把需要 DOM 的格式解析成文本。
 * PDF.js 需要 DOM；mammoth 的依赖 bluebird 在 service worker 中挑选调度器时
 * 可能触碰 document 而报 ReferenceError，故一并在此处理。
 * 其余纯文本格式返回 undefined，交由后台解析。
 */
async function preParseInPage(
  fileType: string,
  base64Data: string
): Promise<string | undefined> {
  switch (fileType) {
    case 'pdf':
      return await parsePDF(base64Data);
    case 'doc':
    case 'docx':
      return await parseDOCX(base64Data);
    default:
      return undefined;
  }
}

function resizeAutoGrowTextarea(element: HTMLTextAreaElement): void {
  const singleLineHeight = 39;
  element.style.height = 'auto';
  element.style.height = `${Math.max(singleLineHeight, element.scrollHeight)}px`;
}

function App() {
  const [profile, setProfile] = useState<UserProfile>({
    personal: {} as PersonalInfo,
    education: [],
    experience: [],
    projects: [],
    customInformation: [],
    skills: [],
    certifications: []
  });
  const [loading, setLoading] = useState(hasChromeApis());
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<OptionTab>(() => {
    if (typeof window === 'undefined') {
      return 'personal';
    }

    return getInitialActiveTab(window.location.search);
  });
  const [dataRevision, setDataRevision] = useState(0);
  const [parsingResume, setParsingResume] = useState(false);
  const [resumeCategory, setResumeCategory] = useState('');
  const [resumeNotice, setResumeNotice] = useState<{
    type: 'info' | 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [saveNotice, setSaveNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!saveNotice) return;
    const timer = window.setTimeout(() => setSaveNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

  useEffect(() => {
    if (!hasChromeApis()) {
      setLoading(false);
      return;
    }

    void loadProfile();
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes.userProfile) {
        void loadProfile();
        setDataRevision(revision => revision + 1);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const loadProfile = async () => {
    if (!hasChromeApis()) {
      setLoading(false);
      return;
    }

    try {
      const response = await MessageService.sendMessage<UserProfile>({
        type: 'GET_USER_PROFILE'
      });

      if (response.success && response.data) {
        setProfile(response.data);
      } else if (response.success) {
        setProfile({
          personal: {} as PersonalInfo,
          education: [],
          experience: [],
          projects: [],
          customInformation: [],
          skills: [],
          certifications: [],
        });
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExternalDataChange = () => {
    void loadProfile();
    setDataRevision(revision => revision + 1);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await MessageService.sendMessage({
        type: 'SAVE_USER_PROFILE',
        payload: profile
      });

      if (response.success) {
        setSaveNotice({ type: 'success', text: '保存成功' });
      } else {
        setSaveNotice({
          type: 'error',
          text: `保存失败：${response.error || '未知错误'}`,
        });
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveNotice({ type: 'error', text: '保存时出错，请稍后重试' });
    } finally {
      setSaving(false);
    }
  };

  const handlePersonalChange = (field: keyof PersonalInfo, value: string) => {
    setProfile({
      ...profile,
      personal: {
        ...profile.personal,
        [field]: value
      }
    });
  };

  const addCustomInformation = () => {
    const item: CustomInformation = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: '',
      content: '',
    };
    setProfile({
      ...profile,
      customInformation: [...(profile.customInformation || []), item],
    });
  };

  const updateCustomInformation = (
    id: string,
    field: 'name' | 'content',
    value: string
  ) => {
    setProfile({
      ...profile,
      customInformation: (profile.customInformation || []).map(item =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    });
  };

  const removeCustomInformation = (id: string) => {
    setProfile({
      ...profile,
      customInformation: (profile.customInformation || []).filter(item => item.id !== id),
    });
  };

  const updateResumeCategory = (id: string, category: string) => {
    setProfile(current => ({
      ...current,
      resumes: (current.resumes || []).map(resume => (
        resume.id === id ? { ...resume, category } : resume
      )),
    }));
  };

  const removeResume = async (id: string) => {
    const removed = (profile.resumes || []).find(resume => resume.id === id);
    if (!removed || !window.confirm(`确认删除“${removed.category || '未分类'}｜${removed.fileName}”吗？`)) return;
    const nextProfile = removeResumeVariant(profile, id);
    setProfile(nextProfile);
    setSaving(true);
    try {
      const response = await MessageService.sendMessage({
        type: 'SAVE_USER_PROFILE',
        payload: nextProfile,
      });
      if (response.success) {
        setSaveNotice({ type: 'success', text: '简历已删除并保存' });
      } else {
        setSaveNotice({ type: 'error', text: `删除保存失败：${response.error || '未知错误'}` });
        void loadProfile();
      }
    } catch (error) {
      console.error('Remove resume error:', error);
      setSaveNotice({ type: 'error', text: '删除保存失败，请重试' });
      void loadProfile();
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsingResume(true);
    setResumeNotice({ type: 'info', text: `正在解析「${file.name}」，请稍候...` });

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      const fileType = resolveFileType(file);

      try {
        // PDF 与 DOCX 依赖的库需要 DOM，在设置页（有 DOM）先解析出文本，
        // 后台就无需再触碰这些库
        const rawText = await withTimeout(
          preParseInPage(fileType, base64Data),
          LOCAL_RESUME_PARSE_TIMEOUT_MS,
          '本地读取超过 30 秒，请确认文件不是扫描版或损坏文件',
        );

        const response = await MessageService.sendMessage({
          type: 'PARSE_RESUME',
          payload: {
            file: base64Data,
            fileType,
            fileName: file.name,
            category: resumeCategory.trim() || '未分类',
            rawText,
          }
        });

        if (response.success && response.data) {
          const result = response.data as {
            parsedData?: ParsedResumeData;
            parseMethod?: 'structured' | 'llm' | 'regex';
            llmError?: string;
          };
          const summary = summarizeParsed(result.parsedData);
          setSaveNotice({ type: 'success', text: '简历已加入资料库，可在插件中切换使用' });

          if (result.llmError) {
            // AI 解析失败会静默回退到正则，必须让用户知道，否则会误以为 AI 生效了
            setResumeNotice({
              type: 'warning',
              text: `「${file.name}」AI 解析失败，已改用本地规则解析${summary ? `，提取 ${summary}` : '，未提取到字段'}。`
                + `失败原因：${result.llmError}`,
            });
          } else if (summary) {
            const prefix = result.parseMethod === 'llm' ? 'AI 解析完成' : '解析完成';
            setResumeNotice({
              type: 'success',
              text: `「${file.name}」${prefix}，已提取 ${summary}，请核对。`,
            });
          } else {
            setResumeNotice({
              type: 'warning',
              text: `「${file.name}」已读取，但没能提取到可用字段。`
                + '若为扫描版 PDF（图片型）需改用文字版；也可在设置中配置 AI 服务提升提取效果。',
            });
          }

          loadProfile();
          setResumeCategory('');
        } else {
          const message = response.error || '未知错误';
          setSaveNotice({ type: 'error', text: '简历解析失败，请重试' });
          setResumeNotice({ type: 'error', text: `简历解析失败：${message}` });
        }
      } catch (error) {
        console.error('Upload error:', error);
        setSaveNotice({ type: 'error', text: '上传简历时出错，请稍后重试' });
        setResumeNotice({ type: 'error', text: '上传简历时出错，请稍后重试。' });
      } finally {
        setParsingResume(false);
        e.target.value = '';
      }
    };
    reader.onerror = () => {
      setParsingResume(false);
      setSaveNotice({ type: 'error', text: '读取简历失败' });
      setResumeNotice({ type: 'error', text: `无法读取「${file.name}」，请检查文件是否损坏。` });
      e.target.value = '';
    };
    reader.onabort = () => {
      setParsingResume(false);
      setResumeNotice({ type: 'warning', text: `已停止读取「${file.name}」。` });
      e.target.value = '';
    };

    reader.readAsDataURL(file);
  };

  if (loading) {
    return <div className="options-loading">加载中...</div>;
  }

  return (
    <div className="options-shell">
      {saveNotice && (
        <div
          className={`save-toast ${saveNotice.type}`}
          role="status"
          aria-live="polite"
        >
          {saveNotice.text}
        </div>
      )}
      <header className="options-header">
        <div className="options-header-inner">
          <img
            className="options-brand-mark"
            src={typeof chrome !== 'undefined' && chrome.runtime?.getURL
              ? chrome.runtime.getURL('icons/icon128.png')
              : '/icons/icon128.png'}
            alt=""
          />
          <div>
            <span className="options-brand-name">JOB APPLYMATE</span>
            <h1>建立你的申请资料库</h1>
            <p>一次整理，之后每份网申都能快速、准确地调用。</p>
          </div>
        </div>
      </header>

      <div className="options-content">
        <nav className="options-tabs" aria-label="设置分类">
          <button
            onClick={() => setActiveTab('personal')}
            className={activeTab === 'personal' ? 'options-tab active' : 'options-tab'}
          >
            基本信息
          </button>
          <button
            onClick={() => setActiveTab('education')}
            className={activeTab === 'education' ? 'options-tab active' : 'options-tab'}
          >
            教育经历
          </button>
          <button
            onClick={() => setActiveTab('experience')}
            className={activeTab === 'experience' ? 'options-tab active' : 'options-tab'}
          >
            实习与项目
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={activeTab === 'custom' ? 'options-tab active' : 'options-tab'}
          >
            添加自定义信息
          </button>
          <button
            onClick={() => setActiveTab('resume')}
            className={activeTab === 'resume' ? 'options-tab active' : 'options-tab'}
          >
            简历库
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={activeTab === 'ai' ? 'options-tab active' : 'options-tab'}
          >
            AI设置
          </button>
          <button
            onClick={() => setActiveTab('data-sync')}
            className={activeTab === 'data-sync' ? 'options-tab active' : 'options-tab'}
          >
            数据与同步
          </button>
          <button
            onClick={() => setActiveTab('application-records')}
            className={activeTab === 'application-records' ? 'options-tab active' : 'options-tab'}
          >
            投递记录
          </button>
        </nav>

        <div className="options-panel">
          {activeTab === 'personal' && (
            <div className="options-form">
              <h2 className="section-title">个人基本信息</h2>

              <div style={styles.formGroup}>
                <label style={styles.label}>姓名 *</label>
                <input
                  type="text"
                  value={profile.personal.name || ''}
                  onChange={(e) => handlePersonalChange('name', e.target.value)}
                  style={styles.input}
                  placeholder="请输入姓名"
                />
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>性别</label>
                  <select
                    value={profile.personal.gender || ''}
                    onChange={(e) => handlePersonalChange('gender', e.target.value)}
                    style={styles.input}
                  >
                    <option value="">请选择</option>
                    <option value="男">男</option>
                    <option value="女">女</option>
                  </select>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>出生日期</label>
                  <input
                    type="text"
                    value={profile.personal.birthDate || ''}
                    onChange={(e) => handlePersonalChange('birthDate', e.target.value)}
                    style={styles.input}
                    placeholder="如 2002年5月 或 2002-05"
                  />
                </div>
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>政治面貌</label>
                  <select
                    value={profile.personal.politicalStatus || ''}
                    onChange={(e) => handlePersonalChange('politicalStatus', e.target.value)}
                    style={styles.input}
                  >
                    <option value="">请选择</option>
                    <option value="中共党员">中共党员</option>
                    <option value="中共预备党员">中共预备党员</option>
                    <option value="共青团员">共青团员</option>
                    <option value="群众">群众</option>
                    <option value="民主党派">民主党派</option>
                  </select>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>民族</label>
                  <input
                    type="text"
                    value={profile.personal.ethnicity || ''}
                    onChange={(e) => handlePersonalChange('ethnicity', e.target.value)}
                    style={styles.input}
                    placeholder="如 汉族"
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>手机号 *</label>
                <input
                  type="tel"
                  value={profile.personal.phone || ''}
                  onChange={(e) => handlePersonalChange('phone', e.target.value)}
                  style={styles.input}
                  placeholder="请输入手机号"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>邮箱 *</label>
                <input
                  type="email"
                  value={profile.personal.email || ''}
                  onChange={(e) => handlePersonalChange('email', e.target.value)}
                  style={styles.input}
                  placeholder="请输入邮箱"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>微信号</label>
                <input
                  type="text"
                  value={profile.personal.wechat || ''}
                  onChange={(e) => handlePersonalChange('wechat', e.target.value)}
                  style={styles.input}
                  placeholder="请输入微信号"
                />
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>籍贯</label>
                  <input
                    type="text"
                    value={profile.personal.hometown || ''}
                    onChange={(e) => handlePersonalChange('hometown', e.target.value)}
                    style={styles.input}
                    placeholder="如 河北省石家庄市"
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>现居地</label>
                  <input
                    type="text"
                    value={profile.personal.currentAddress || ''}
                    onChange={(e) => handlePersonalChange('currentAddress', e.target.value)}
                    style={styles.input}
                    placeholder="如 北京市海淀区"
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>身份证号</label>
                <input
                  type="text"
                  value={profile.personal.idCard || ''}
                  onChange={(e) => handlePersonalChange('idCard', e.target.value)}
                  style={styles.input}
                  placeholder="部分网申需要，可留空"
                  autoComplete="off"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>自我评价</label>
                <textarea
                  value={profile.personal.selfEvaluation || ''}
                  onChange={(e) => {
                    resizeAutoGrowTextarea(e.currentTarget);
                    handlePersonalChange('selfEvaluation', e.target.value);
                  }}
                  ref={(element) => {
                    if (element) resizeAutoGrowTextarea(element);
                  }}
                  style={{ ...styles.input, ...styles.autoGrowTextarea }}
                  placeholder="简要描述个人优势、能力特点和职业倾向，可用于网申自我评价字段"
                  rows={1}
                />
              </div>

              <div className="info-note">
                提示：带 * 的为必填项。你也可以通过上传简历来快速填充这些信息。
                身份证号仅保存在本地浏览器中，不会上传到任何服务器。
              </div>
            </div>
          )}

          {activeTab === 'education' && (
            <div className="options-form">
              <EducationSection
                items={profile.education || []}
                onChange={education => setProfile({ ...profile, education })}
              />
            </div>
          )}

          {activeTab === 'experience' && (
            <div className="options-form">
              <ExperienceSection
                experience={profile.experience || []}
                projects={profile.projects || []}
                skills={profile.skills || []}
                onChangeExperience={experience => setProfile({ ...profile, experience })}
                onChangeProjects={projects => setProfile({ ...profile, projects })}
                onChangeSkills={skills => setProfile({ ...profile, skills })}
              />
            </div>
          )}

          {activeTab === 'custom' && (
            <div className="options-form">
              <div className="custom-information-header">
                <div>
                  <h2 className="section-title">自定义信息</h2>
                  <p className="custom-information-description">
                    添加网申中经常使用、但不属于现有分类的信息。
                  </p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={addCustomInformation}>
                  添加
                </button>
              </div>

              {(profile.customInformation || []).length === 0 ? (
                <div className="custom-information-empty">
                  <p>暂无自定义信息</p>
                  <span>点击“添加”创建信息名称和信息内容。</span>
                </div>
              ) : (
                <div className="custom-information-list">
                  {(profile.customInformation || []).map((item, index) => (
                    <section className="custom-information-item" key={item.id}>
                      <div className="custom-information-item-header">
                        <h3>自定义信息 {index + 1}</h3>
                        <button
                          type="button"
                          className="custom-information-remove"
                          onClick={() => removeCustomInformation(item.id)}
                          aria-label={`删除自定义信息 ${index + 1}`}
                        >
                          删除
                        </button>
                      </div>
                      <div className="custom-information-fields">
                        <label>
                          <span>信息名称</span>
                          <input
                            type="text"
                            value={item.name}
                            onChange={event =>
                              updateCustomInformation(item.id, 'name', event.target.value)
                            }
                            placeholder="例如：期望薪资"
                          />
                        </label>
                        <label>
                          <span>信息内容</span>
                          <textarea
                            value={item.content}
                            onChange={event =>
                              updateCustomInformation(item.id, 'content', event.target.value)
                            }
                            placeholder="请输入需要快速填写或复制的内容"
                            rows={3}
                          />
                        </label>
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'resume' && (
            <div className="options-form">
              <h2 className="section-title">简历库</h2>

              <label className="resume-category-field">
                <span>本次添加到哪个分类</span>
                <input
                  type="text"
                  value={resumeCategory}
                  onChange={event => setResumeCategory(event.target.value)}
                  placeholder="例如：产品岗、运营岗、数据分析岗"
                  maxLength={40}
                />
                <small>分类仅用于插件内区分，上传到网站时仍保留文件的原始名称。</small>
              </label>

              <div className="upload-container">
                <div className={parsingResume ? 'upload-area parsing' : 'upload-area'}>
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  <p className="upload-title">{parsingResume ? '正在解析简历...' : '点击或拖拽文件到此处上传'}</p>
                  <p className="upload-hint">
                    {parsingResume ? '请保持当前页面打开，解析完成后会自动提示。' : '支持 PDF、DOCX、MD、TXT、JSON 格式'}
                  </p>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.md,.txt,.json"
                    onChange={handleFileUpload}
                    className="file-input"
                    disabled={parsingResume}
                  />
                </div>

                {resumeNotice && (
                  <div className={`resume-notice ${resumeNotice.type}`} role="status" aria-live="polite">
                    {resumeNotice.text}
                  </div>
                )}

                {(profile.resumes || []).length > 0 && (
                  <div className="resume-info">
                    <h3>已保存 {profile.resumes?.length || 0} 份简历</h3>
                    <div className="resume-library-list">
                      {(profile.resumes || []).map(resume => (
                        <article className="resume-library-item" key={resume.id}>
                          <div className="resume-file-icon" aria-hidden="true">
                            {resume.fileType.toUpperCase().slice(0, 4)}
                          </div>
                          <div className="resume-library-main">
                            <input
                              type="text"
                              value={resume.category}
                              onChange={event => updateResumeCategory(resume.id, event.target.value)}
                              placeholder="未分类"
                              aria-label={`${resume.fileName}的分类`}
                              maxLength={40}
                            />
                            <strong title={resume.fileName}>{resume.fileName}</strong>
                            <small>添加于 {new Date(resume.uploadDate).toLocaleDateString('zh-CN')}</small>
                          </div>
                          <button
                            type="button"
                            className="resume-remove-button"
                            onClick={() => removeResume(resume.id)}
                          >
                            删除
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                <div className="info-note">
                  每份简历会独立保存解析资料，切换简历时悬浮窗和自动填写内容会同步切换；新增简历不会覆盖已有资料。删除后会立即保存，修改分类后请点击下方“保存设置”。
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai' && <AISettings dataRevision={dataRevision} />}

          {activeTab === 'data-sync' && (
            <DataSyncSettings onDataChanged={handleExternalDataChange} />
          )}

          {activeTab === 'application-records' && <ApplicationRecordsSection />}

          {activeTab !== 'ai' && activeTab !== 'data-sync' && activeTab !== 'application-records' && (
            <div className="options-actions">
            <button onClick={handleSave} disabled={saving} className="btn btn-primary">
              {saving ? '保存中...' : '保存设置'}
            </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  formGroup: {
    marginBottom: '20px',
    flex: 1
  },
  formRow: {
    display: 'flex',
    gap: '20px'
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#333'
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid var(--color-border)',
    borderRadius: '9px',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit'
  },
  autoGrowTextarea: {
    minHeight: '39px',
    height: '39px',
    lineHeight: '18px',
    overflowY: 'hidden',
    resize: 'none'
  }
};

export default App;
