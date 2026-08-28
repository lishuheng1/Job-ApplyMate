import React, { useEffect, useMemo, useRef, useState } from 'react';
import { APPLICATION_RECORD_STATUSES, normalizeApplicationRecord } from '../shared/applicationRecords.ts';
import { MessageService } from '../shared/message.ts';
import type { ApplicationRecord, ApplicationRecordStatus } from '../shared/types.ts';

interface ApplicationRecordsSectionProps {
  initialMode?: 'list' | 'new';
  initialRecords?: ApplicationRecord[];
}

type NoticeState = {
  type: 'success' | 'error' | 'info';
  text: string;
} | null;

type ColumnKey =
  | 'companyName'
  | 'jobTitle'
  | 'sourceUrl'
  | 'status'
  | 'appliedAt'
  | 'location'
  | 'notes';

type SortRule = {
  key: ColumnKey;
  direction: 'asc' | 'desc';
};

type SortState = SortRule[];

type ColumnDefinition = {
  key: ColumnKey;
  label: string;
  sortable: boolean;
  cellClassName?: string;
};

const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  { key: 'companyName', label: '公司', sortable: true },
  { key: 'jobTitle', label: '岗位', sortable: true },
  { key: 'sourceUrl', label: '链接', sortable: true, cellClassName: 'application-records-cell-link' },
  { key: 'status', label: '状态', sortable: true },
  { key: 'appliedAt', label: '投递日期', sortable: true },
  { key: 'location', label: '工作地点', sortable: true },
  { key: 'notes', label: '备注', sortable: true },
];

const FILTER_FIELDS: Array<{ key: 'companyName' | 'jobTitle' | 'status'; label: string; type: 'text' | 'status' }> = [
  { key: 'companyName', label: '公司', type: 'text' },
  { key: 'jobTitle', label: '岗位', type: 'text' },
  { key: 'status', label: '状态', type: 'status' },
];

function defaultSort(records: ApplicationRecord[]): ApplicationRecord[] {
  return [...records].map(normalizeApplicationRecord).sort((left, right) => {
    const leftValue = left.appliedAt || left.updatedAt || left.createdAt;
    const rightValue = right.appliedAt || right.updatedAt || right.createdAt;
    return rightValue.localeCompare(leftValue);
  });
}

function cloneRecord(record: ApplicationRecord): ApplicationRecord {
  return { ...record };
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function matchesKeyword(value: string, keyword: string): boolean {
  if (!keyword) {
    return true;
  }
  return value.toLowerCase().includes(keyword);
}

function trimRecord(record: ApplicationRecord): ApplicationRecord {
  return {
    ...record,
    companyName: record.companyName.trim(),
    jobTitle: record.jobTitle.trim(),
    sourceSite: record.sourceSite.trim(),
    sourceUrl: record.sourceUrl.trim(),
    notes: record.notes.trim(),
    appliedAt: record.appliedAt.trim(),
    location: record.location.trim(),
  };
}

function getColumnValue(record: ApplicationRecord, key: ColumnKey): string {
  return record[key] ?? '';
}

function applySort(records: ApplicationRecord[], sortState: SortState): ApplicationRecord[] {
  if (sortState.length === 0) {
    return defaultSort(records);
  }

  const sorted = [...records].sort((left, right) => {
    for (const rule of sortState) {
      const leftValue = getColumnValue(left, rule.key);
      const rightValue = getColumnValue(right, rule.key);
      const comparison = leftValue.localeCompare(rightValue, 'zh-CN');

      if (comparison !== 0) {
        return rule.direction === 'asc' ? comparison : -comparison;
      }
    }

    return 0;
  });
  return sorted;
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.75 13.75V16.25H6.25L14.8 7.7L12.3 5.2L3.75 13.75Z" />
      <path d="M10.95 6.55L13.45 9.05" />
      <path d="M11.95 4.2L14.45 6.7" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.75 6.25H15.25" />
      <path d="M7.25 6.25V4.75H12.75V6.25" />
      <path d="M6.5 6.25V14.5C6.5 15.05 6.95 15.5 7.5 15.5H12.5C13.05 15.5 13.5 15.05 13.5 14.5V6.25" />
      <path d="M8.5 8.75V13" />
      <path d="M11.5 8.75V13" />
    </svg>
  );
}

function SortIcon({ direction }: { direction?: 'asc' | 'desc' }) {
  if (direction) {
    return (
      <span className="application-records-sort-icon is-active" aria-hidden="true">
        {direction === 'asc' ? '↑' : '↓'}
      </span>
    );
  }

  return (
    <span className="application-records-sort-icon application-records-sort-icon-hint application-records-sort-icon-dual" aria-hidden="true">
      <span className="application-records-sort-icon-arrow">↑</span>
      <span className="application-records-sort-icon-arrow">↓</span>
    </span>
  );
}

export function ApplicationRecordsSection({
  initialMode: _initialMode = 'list',
  initialRecords = [],
}: ApplicationRecordsSectionProps): React.JSX.Element {
  const [records, setRecords] = useState<ApplicationRecord[]>(() => defaultSort(initialRecords));
  const [loading, setLoading] = useState(initialRecords.length === 0);
  const [busyAction, setBusyAction] = useState<'import' | 'export' | 'save' | 'delete' | null>(null);
  const [errorText, setErrorText] = useState('');
  const [notice, setNotice] = useState<NoticeState>(null);
  const [sortState, setSortState] = useState<SortState>([]);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnKey, string>>>({});
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRecord, setDraftRecord] = useState<ApplicationRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadRecords = async () => {
    setLoading(true);
    setErrorText('');
    const response = await MessageService.sendMessage<ApplicationRecord[]>({
      type: 'GET_APPLICATION_RECORDS',
    });

    if (!response.success) {
      setErrorText(response.error || '读取投递记录失败');
      setLoading(false);
      return;
    }

    setRecords(defaultSort(response.data ?? []));
    setLoading(false);
  };

  useEffect(() => {
    if (initialRecords.length > 0) {
      return;
    }
    void loadRecords();
  }, [initialRecords.length]);

  const filteredRecords = useMemo(() => {
    const nextRecords = records.filter(record => (
      Object.entries(columnFilters).every(([key, value]) => (
        matchesKeyword(
          getColumnValue(record, key as ColumnKey).toLowerCase(),
          normalizeKeyword(value || ''),
        )
      ))
    ));
    return applySort(nextRecords, sortState);
  }, [columnFilters, records, sortState]);

  const beginEdit = (record: ApplicationRecord) => {
    setEditingId(record.id);
    setDraftRecord(cloneRecord(record));
    setErrorText('');
    setNotice(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftRecord(null);
  };

  const updateDraftField = <K extends keyof ApplicationRecord>(field: K, value: ApplicationRecord[K]) => {
    setDraftRecord(current => current ? { ...current, [field]: value } : current);
  };

  const handleSort = (key: ColumnKey) => {
    setSortState(current => {
      const existingIndex = current.findIndex(rule => rule.key === key);

      if (existingIndex === -1) {
        return [...current, { key, direction: 'asc' }];
      }

      const existingRule = current[existingIndex];
      if (existingRule.direction === 'asc') {
        return current.map(rule => (
          rule.key === key ? { ...rule, direction: 'desc' } : rule
        ));
      }

      return current.filter(rule => rule.key !== key);
    });
  };

  const getSortDirection = (key: ColumnKey): 'asc' | 'desc' | undefined => (
    sortState.find(rule => rule.key === key)?.direction
  );

  const handleSave = async () => {
    if (!draftRecord) {
      return;
    }

    setBusyAction('save');
    setErrorText('');
    const payload = trimRecord({
      ...draftRecord,
      updatedAt: new Date().toISOString(),
    });
    const response = await MessageService.sendMessage({
      type: 'UPDATE_APPLICATION_RECORD',
      payload,
    });

    if (!response.success) {
      setErrorText(response.error || '保存投递记录失败');
      setBusyAction(null);
      return;
    }

    setRecords(current => defaultSort(current.map(record => (
      record.id === payload.id ? payload : record
    ))));
    setEditingId(null);
    setDraftRecord(null);
    setBusyAction(null);
    setNotice({ type: 'success', text: '投递记录已更新' });
  };

  const handleDelete = async (record: ApplicationRecord) => {
    if (
      typeof window !== 'undefined'
      && typeof window.confirm === 'function'
      && !window.confirm(`确定删除 ${record.companyName || '该条'} 投递记录吗？`)
    ) {
      return;
    }

    setBusyAction('delete');
    setErrorText('');
    const response = await MessageService.sendMessage({
      type: 'DELETE_APPLICATION_RECORD',
      payload: { id: record.id },
    });

    if (!response.success) {
      setErrorText(response.error || '删除投递记录失败');
      setBusyAction(null);
      return;
    }

    setRecords(current => current.filter(item => item.id !== record.id));
    if (editingId === record.id) {
      cancelEdit();
    }
    setBusyAction(null);
    setNotice({ type: 'success', text: '投递记录已删除' });
  };

  const handleExport = async () => {
    setBusyAction('export');
    setErrorText('');
    const response = await MessageService.sendMessage<{ csv: string; filename: string }>({
      type: 'EXPORT_APPLICATION_RECORDS_CSV',
    });

    if (!response.success || !response.data) {
      setErrorText(response.error || '导出 CSV 失败');
      setBusyAction(null);
      return;
    }

    if (typeof document !== 'undefined') {
      const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = response.data.filename;
      link.click();
      URL.revokeObjectURL(objectUrl);
    }

    setBusyAction(null);
    setNotice({ type: 'success', text: `CSV 已导出：${response.data.filename}` });
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusyAction('import');
    setErrorText('');

    try {
      const csv = await file.text();
      const response = await MessageService.sendMessage<{ imported: number; warnings: string[] }>({
        type: 'IMPORT_APPLICATION_RECORDS_CSV',
        payload: { csv },
      });

      if (!response.success) {
        setErrorText(response.error || '导入 CSV 失败');
        return;
      }

      await loadRecords();
      const warnings = response.data?.warnings ?? [];
      const importedCount = response.data?.imported ?? 0;
      setNotice({
        type: warnings.length > 0 ? 'info' : 'success',
        text: warnings.length > 0
          ? `已导入 ${importedCount} 条记录；${warnings.join('；')}`
          : `已导入 ${importedCount} 条记录`,
      });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '读取 CSV 文件失败');
    } finally {
      setBusyAction(null);
      event.target.value = '';
    }
  };

  return (
    <section className="application-records-section">
      <div className="application-records-header">
        <div>
          <h2 className="section-title">投递记录</h2>
          <p className="application-records-description">
            统一查看、筛选、排序、编辑、删除，并支持 CSV 导入导出已有投递记录。
          </p>
        </div>
        <div className="application-records-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="visually-hidden"
            onChange={event => void handleImportChange(event)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busyAction !== null}
          >
            导入 CSV
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleExport()}
            disabled={busyAction !== null}
          >
            导出 CSV
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`application-records-notice application-records-notice-${notice.type}`}
          role="status"
          aria-live="polite"
        >
          {notice.text}
        </div>
      )}

      {errorText && (
        <div className="application-records-error" role="alert">
          {errorText}
        </div>
      )}

      <div className="application-records-table-shell" aria-live="polite">
        <div className="application-records-table-toolbar">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsFilterPanelOpen(current => !current)}
            disabled={busyAction !== null}
          >
            筛选
          </button>
        </div>
        {isFilterPanelOpen && (
          <div className="application-records-filter-panel">
            <div className="application-records-filter-panel-grid">
              {FILTER_FIELDS.map(field => (
                <label key={field.key} className="application-records-filter-field">
                  <span>{field.label}</span>
                  {field.type === 'status' ? (
                    <select
                      aria-label={`筛选-${field.label}`}
                      value={columnFilters[field.key] || ''}
                      onChange={event => {
                        const value = event.target.value;
                        setColumnFilters(current => ({ ...current, [field.key]: value }));
                      }}
                    >
                      <option value="">全部状态</option>
                      {APPLICATION_RECORD_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`筛选-${field.label}`}
                      value={columnFilters[field.key] || ''}
                      onChange={event => {
                        const value = event.target.value;
                        setColumnFilters(current => ({ ...current, [field.key]: value }));
                      }}
                      placeholder={`筛选${field.label}`}
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="application-records-filter-panel-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setColumnFilters({})}
              >
                清空筛选
              </button>
            </div>
          </div>
        )}
        {loading ? (
          <div className="application-records-empty">正在加载投递记录...</div>
        ) : filteredRecords.length === 0 ? (
          <div className="application-records-empty">暂无符合条件的投递记录</div>
        ) : (
          <table className="application-records-table">
            <thead>
              <tr>
                {COLUMN_DEFINITIONS.map(column => (
                  <th key={column.key} className={column.cellClassName}>
                    <button
                      type="button"
                      className={`application-records-table-head-button application-records-table-head-button-sort${getSortDirection(column.key) ? ' is-sorted' : ''}`}
                      aria-label={`列头-${column.label}`}
                      onClick={() => handleSort(column.key)}
                    >
                      <span>{column.label}</span>
                      <SortIcon direction={getSortDirection(column.key)} />
                    </button>
                  </th>
                ))}
                <th className="application-records-cell-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map(record => {
                const isEditing = editingId === record.id && draftRecord;
                if (isEditing) {
                  return (
                    <tr key={record.id} className="application-records-row application-records-row-editing" data-row-type="data">
                      <td data-column="companyName"><input value={draftRecord.companyName} onChange={event => updateDraftField('companyName', event.target.value)} /></td>
                      <td data-column="jobTitle"><input value={draftRecord.jobTitle} onChange={event => updateDraftField('jobTitle', event.target.value)} /></td>
                      <td data-column="sourceUrl" className="application-records-cell-link"><input value={draftRecord.sourceUrl} onChange={event => updateDraftField('sourceUrl', event.target.value)} /></td>
                      <td data-column="status">
                        <select value={draftRecord.status} onChange={event => updateDraftField('status', event.target.value as ApplicationRecordStatus)}>
                          {APPLICATION_RECORD_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                        </select>
                      </td>
                      <td data-column="appliedAt"><input type="date" value={draftRecord.appliedAt} onChange={event => updateDraftField('appliedAt', event.target.value)} /></td>
                      <td data-column="location"><input value={draftRecord.location} onChange={event => updateDraftField('location', event.target.value)} /></td>
                      <td data-column="notes"><input value={draftRecord.notes} onChange={event => updateDraftField('notes', event.target.value)} /></td>
                      <td className="application-records-cell-actions">
                        <div className="application-records-row-actions">
                          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={busyAction !== null}>保存</button>
                          <button type="button" className="btn btn-secondary" onClick={cancelEdit} disabled={busyAction !== null}>取消</button>
                          <button
                            type="button"
                            className="application-record-icon-button application-record-icon-button-danger"
                            aria-label="删除"
                            onClick={() => void handleDelete(record)}
                            disabled={busyAction !== null}
                          >
                            <DeleteIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={record.id} className="application-records-row" data-row-type="data">
                    <td data-column="companyName">{record.companyName || '未填写'}</td>
                    <td data-column="jobTitle">{record.jobTitle || '未填写'}</td>
                    <td data-column="sourceUrl" className="application-records-cell-link">
                      {record.sourceUrl ? (
                        <a
                          className="application-records-link-text"
                          href={record.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {record.sourceUrl}
                        </a>
                      ) : (
                        <span className="application-records-link-text">未填写</span>
                      )}
                    </td>
                    <td data-column="status">{record.status}</td>
                    <td data-column="appliedAt">{record.appliedAt || '未填写'}</td>
                    <td data-column="location">{record.location || '未填写'}</td>
                    <td data-column="notes"><span className="application-records-notes-text">{record.notes || '未填写'}</span></td>
                    <td className="application-records-cell-actions">
                      <div className="application-records-row-actions">
                        <button
                          type="button"
                          className="application-record-icon-button"
                          aria-label="编辑"
                          onClick={() => beginEdit(record)}
                          disabled={busyAction !== null}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="application-record-icon-button application-record-icon-button-danger"
                          aria-label="删除"
                          onClick={() => void handleDelete(record)}
                          disabled={busyAction !== null}
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default ApplicationRecordsSection;
