import React, { useEffect, useMemo, useState } from 'react';
import { APPLICATION_RECORD_STATUSES, normalizeApplicationRecordStatus } from '../shared/applicationRecords.ts';
import { MessageService } from '../shared/message.ts';
import type {
  ApplicationRecord,
  ApplicationRecordDraft,
  ApplicationRecordStatus,
} from '../shared/types.ts';

const EMPTY_FORM: ApplicationRecord = {
  id: '',
  companyName: '',
  jobTitle: '',
  sourceSite: '',
  sourceUrl: '',
  status: '已投递',
  notes: '',
  appliedAt: '',
  location: '',
  createdAt: '',
  updatedAt: '',
};

function createRecordId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `record_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getDraftIdFromSearch(search: string): string | null {
  const draftId = new URLSearchParams(search).get('draftId')?.trim();
  return draftId || null;
}

function normalizeDraftToRecord(draft: ApplicationRecordDraft): ApplicationRecord {
  return {
    ...EMPTY_FORM,
    ...draft,
    status: normalizeApplicationRecordStatus(draft.status) ?? '已投递',
    id: createRecordId(),
  };
}

export function ApplicationRecordCreateApp() {
  const draftId = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return getDraftIdFromSearch(window.location.search);
  }, []);
  const [form, setForm] = useState<ApplicationRecord>(EMPTY_FORM);
  const [loading, setLoading] = useState(Boolean(draftId));
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  useEffect(() => {
    if (!draftId) {
      return;
    }

    let cancelled = false;
    const loadDraft = async () => {
      setLoading(true);
      setErrorText('');

      const response = await MessageService.sendMessage<{
        draft: ApplicationRecordDraft;
        duplicate: ApplicationRecord | null;
      }>({
        type: 'GET_APPLICATION_RECORD_DRAFT',
        payload: { draftId },
      });

      if (cancelled) {
        return;
      }

      if (!response.success || !response.data?.draft) {
        setErrorText(response.error || '读取投递草稿失败');
        setLoading(false);
        return;
      }

      setForm(normalizeDraftToRecord(response.data.draft));
      setDuplicateId(response.data.duplicate?.id ?? null);
      setSuccessText(response.data.duplicate ? '已存在' : '');
      setLoading(false);
    };

    void loadDraft();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const updateField = <K extends keyof ApplicationRecord>(field: K, value: ApplicationRecord[K]) => {
    setForm(current => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrorText('');
    setSuccessText('');

    const nowIso = new Date().toISOString();
    const payload: ApplicationRecord = {
      ...form,
      id: form.id || createRecordId(),
      companyName: form.companyName.trim(),
      jobTitle: form.jobTitle.trim(),
      sourceSite: form.sourceSite.trim(),
      sourceUrl: form.sourceUrl.trim(),
      notes: form.notes.trim(),
      appliedAt: form.appliedAt.trim(),
      location: form.location.trim(),
      createdAt: form.createdAt || nowIso,
      updatedAt: nowIso,
    };

    const response = await MessageService.sendMessage<{ duplicate: ApplicationRecord | null }>({
      type: 'CREATE_APPLICATION_RECORD',
      payload,
    });

    if (!response.success) {
      setErrorText(response.error || '保存投递记录失败');
      setSaving(false);
      return;
    }

    setForm(payload);
    setDuplicateId(response.data?.duplicate?.id ?? null);
    setSuccessText(response.data?.duplicate ? '已存在' : '已保存');
    setSaving(false);
  };

  return (
    <main className="application-record-create-page">
      <section className="record-card">
        <header className="record-card-header">
          <div>
            <p className="record-eyebrow">Application Records</p>
            <h1>新建投递记录</h1>
            <p className="record-subtitle">
              {draftId ? '已根据当前页面生成草稿，可直接补全岗位信息后保存。' : '可手动补充并保存一条新的投递记录。'}
            </p>
          </div>
          <span className="record-status-pill">{form.status}</span>
        </header>

        {duplicateId && (
          <div className="record-banner" role="status">
            <span className="record-banner-tag">已存在</span>
            <span>检测到相同公司与链接的投递记录，仍可继续保存。</span>
          </div>
        )}

        {errorText && (
          <div className="record-feedback record-feedback-error" role="alert">
            {errorText}
          </div>
        )}

        <form className="record-form" onSubmit={event => void handleSubmit(event)}>
          <label className="record-field">
            <span>公司名称</span>
            <input
              type="text"
              value={form.companyName}
              onChange={event => updateField('companyName', event.target.value)}
              placeholder="请输入公司名称"
              disabled={loading || saving}
            />
          </label>

          <label className="record-field">
            <span>岗位名</span>
            <input
              type="text"
              value={form.jobTitle}
              onChange={event => updateField('jobTitle', event.target.value)}
              placeholder="请输入岗位名称"
              disabled={loading || saving}
            />
          </label>

          <div className="record-grid">
            <label className="record-field">
              <span>来源站点</span>
              <input
                type="text"
                value={form.sourceSite}
                onChange={event => updateField('sourceSite', event.target.value)}
                placeholder="如 jobs.bytedance.com"
                disabled={loading || saving}
              />
            </label>

            <label className="record-field">
              <span>投递状态</span>
              <select
                value={form.status}
                onChange={event => updateField('status', event.target.value as ApplicationRecordStatus)}
                disabled={loading || saving}
              >
                {APPLICATION_RECORD_STATUSES.map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="record-field">
            <span>职位链接</span>
            <input
              type="url"
              value={form.sourceUrl}
              onChange={event => updateField('sourceUrl', event.target.value)}
              placeholder="https://"
              disabled={loading || saving}
            />
          </label>

          <div className="record-grid">
            <label className="record-field">
              <span>投递日期</span>
              <input
                type="date"
                value={form.appliedAt}
                onChange={event => updateField('appliedAt', event.target.value)}
                disabled={loading || saving}
              />
            </label>

            <label className="record-field">
              <span>工作地点</span>
              <input
                type="text"
                value={form.location}
                onChange={event => updateField('location', event.target.value)}
                placeholder="如 北京 / 上海"
                disabled={loading || saving}
              />
            </label>
          </div>

          <label className="record-field">
            <span>备注</span>
            <textarea
              value={form.notes}
              onChange={event => updateField('notes', event.target.value)}
              placeholder="可记录投递渠道、跟进节点等"
              rows={4}
              disabled={loading || saving}
            />
          </label>

          <div className="record-form-actions">
            <button type="submit" className="record-submit-button" disabled={loading || saving}>
              {loading ? '正在加载草稿...' : saving ? '保存中...' : duplicateId ? '继续保存' : '保存投递记录'}
            </button>
            {successText && !duplicateId && (
              <span className="record-submit-status" role="status">
                {successText}
              </span>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}

export default ApplicationRecordCreateApp;
