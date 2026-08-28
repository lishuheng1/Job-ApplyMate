# Application Records Table View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将投递记录管理页改成带列头排序/筛选、整行编辑态和固定链接列的表格视图。

**Architecture:** 这轮只改设置页投递记录视图，不动数据层。实现分三块：先补表格列头、排序和列头筛选浮层，再把行渲染改成 `<table>` 语义结构，最后把编辑方式从“展开表单”切成“当前行直接进入编辑态”，并补全对应测试。

**Tech Stack:** TypeScript、React、Vite、TSX test runner

## Global Constraints

- 投递记录展示区改成真正的表格视图。
- 每一列显示明确列名，如 `公司`、`岗位`、`链接`。
- 去掉顶部独立筛选框，把排序与筛选入口都收进列头。
- 点击某一行的 `编辑` 后，该行直接切换成可编辑态，在单元格中直接修改内容。
- `链接` 列在浏览态显示为普通文本，不再显示超链接，也不再保留单独的 `打开链接` 按钮。
- 不修改投递记录 schema。
- 不新增批量编辑、批量删除、固定列、拖拽列宽等复杂表格能力。
- 不引入第三方 data-grid 组件库。
- 不修改 CSV 导入导出逻辑。

---

## File Map

- `src/options/ApplicationRecordsSection.tsx`
  - 改成表格结构，新增列头排序/筛选状态与整行编辑态。
- `src/options/ApplicationRecordsSection.test.tsx`
  - 覆盖列头、排序、筛选浮层、整行编辑态和链接列编辑。
- `src/options/index.css`
  - 新增表格、列头按钮、筛选浮层、固定链接列和行编辑态样式。

### Task 1: 表头列名、排序和列头筛选浮层

**Files:**
- Modify: `src/options/ApplicationRecordsSection.tsx`
- Modify: `src/options/ApplicationRecordsSection.test.tsx`
- Modify: `src/options/index.css`

**Interfaces:**
- Consumes:
  - existing `records` state
- Produces:
  - `sortState: { key: SortableColumn; direction: 'asc' | 'desc' } | null`
  - `columnFilters: Partial<Record<FilterableColumn, string>>`
  - `activeFilterKey: FilterableColumn | null`

- [ ] **Step 1: Write the failing test**

```tsx
test('表格列头渲染公司、岗位、链接等明确列名', async () => {
  const renderer = await renderRecordsSection();
  const text = getText(renderer.root);
  assert.match(text, /公司/);
  assert.match(text, /岗位/);
  assert.match(text, /链接/);
  assert.match(text, /状态/);
});

test('点击公司列排序后顺序发生变化', async () => {
  const renderer = await renderRecordsSection();
  await act(async () => {
    findButton(renderer.root, '排序-公司').props.onClick();
  });
  assert.deepEqual(getRowCompanies(renderer.root), ['腾讯', '字节跳动']);
});

test('点击公司列筛选后出现输入浮层', async () => {
  const renderer = await renderRecordsSection();
  await act(async () => {
    findButton(renderer.root, '筛选-公司').props.onClick();
  });
  assert.ok(findInputByAriaLabel(renderer.root, '筛选-公司'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: FAIL because current UI still uses顶部筛选框和非表头结构

- [ ] **Step 3: Write minimal implementation**

```tsx
type SortableColumn = 'companyName' | 'jobTitle' | 'sourceUrl' | 'status' | 'sourceSite' | 'appliedAt' | 'location' | 'notes';
type FilterableColumn = SortableColumn;

const [sortState, setSortState] = useState<{ key: SortableColumn; direction: 'asc' | 'desc' } | null>(null);
const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterableColumn, string>>>({});
const [activeFilterKey, setActiveFilterKey] = useState<FilterableColumn | null>(null);
```

```tsx
<th>
  <div className="application-records-table-head">
    <span>公司</span>
    <div className="application-records-table-head-actions">
      <button type="button" aria-label="排序-公司" ...>...</button>
      <button type="button" aria-label="筛选-公司" ...>...</button>
    </div>
  </div>
  {activeFilterKey === 'companyName' && (
    <div className="application-record-filter-popover">
      <input aria-label="筛选-公司" ... />
    </div>
  )}
</th>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: PASS for列头、排序和筛选浮层相关用例

- [ ] **Step 5: Commit**

```bash
git add src/options/ApplicationRecordsSection.tsx src/options/ApplicationRecordsSection.test.tsx src/options/index.css
git commit -m "feat: add table headers for application records"
```

### Task 2: 表格化列表与固定宽度链接列

**Files:**
- Modify: `src/options/ApplicationRecordsSection.tsx`
- Modify: `src/options/ApplicationRecordsSection.test.tsx`
- Modify: `src/options/index.css`

**Interfaces:**
- Consumes:
  - `filteredRecords`
  - `sortState`
  - `columnFilters`
- Produces:
  - `<table className="application-records-table">`
  - plain text link cell with fixed width class

- [ ] **Step 1: Write the failing test**

```tsx
test('顶部独立筛选框已移除', async () => {
  const renderer = await renderRecordsSection();
  assert.throws(() => findInputByAriaLabel(renderer.root, '公司名'));
  assert.throws(() => findInputByAriaLabel(renderer.root, '岗位名'));
  assert.throws(() => findInputByAriaLabel(renderer.root, '状态'));
});

test('链接列以普通文本渲染而不是超链接', async () => {
  const renderer = await renderRecordsSection();
  const links = renderer.root.findAll(node => node.type === 'a');
  assert.equal(links.length, 0);
  assert.match(getText(renderer.root), /https:\/\/jobs\.bytedance\.com\/example-1/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: FAIL because current implementation still has顶部筛选框 and link/action layout

- [ ] **Step 3: Write minimal implementation**

```tsx
<div className="application-records-table-shell">
  <table className="application-records-table">
    <thead>...</thead>
    <tbody>...</tbody>
  </table>
</div>
```

```tsx
<td className="application-records-cell application-records-cell-link">
  <span className="application-records-link-text">{record.sourceUrl || '未填写'}</span>
</td>
```

```css
.application-records-cell-link {
  width: 220px;
  max-width: 220px;
}

.application-records-link-text {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: PASS for表格结构、去掉顶部筛选框和链接列文本渲染

- [ ] **Step 5: Commit**

```bash
git add src/options/ApplicationRecordsSection.tsx src/options/ApplicationRecordsSection.test.tsx src/options/index.css
git commit -m "feat: render application records as table"
```

### Task 3: 当前行直接进入编辑态

**Files:**
- Modify: `src/options/ApplicationRecordsSection.tsx`
- Modify: `src/options/ApplicationRecordsSection.test.tsx`
- Modify: `src/options/index.css`

**Interfaces:**
- Consumes:
  - `editingId`
  - `draftRecord`
  - `beginEdit(record)`, `cancelEdit()`, `handleSave()`, `handleDelete(record)`
- Produces:
  - browse row vs edit row rendering in same `<tr>`
  - plain text input for `sourceUrl`

- [ ] **Step 1: Write the failing test**

```tsx
test('点击编辑后当前行直接进入编辑态', async () => {
  const renderer = await renderRecordsSection();
  await act(async () => {
    findButton(renderer.root, '编辑').props.onClick();
  });
  assert.ok(findButton(renderer.root, '保存'));
  assert.ok(findButton(renderer.root, '取消'));
});

test('编辑态下链接列为普通文本输入框', async () => {
  const renderer = await renderRecordsSection();
  await act(async () => {
    findButton(renderer.root, '编辑').props.onClick();
  });
  const inputs = renderer.root.findAllByType('input');
  assert.ok(inputs.some(node => node.props.value === 'https://jobs.bytedance.com/example-1'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: FAIL because current implementation still uses展开编辑块/旧操作区

- [ ] **Step 3: Write minimal implementation**

```tsx
{editingId === record.id && draftRecord ? (
  <tr className="application-records-row application-records-row-editing">
    <td><input value={draftRecord.companyName} ... /></td>
    <td><input value={draftRecord.jobTitle} ... /></td>
    <td><input value={draftRecord.sourceUrl} ... /></td>
    <td><select value={draftRecord.status} ... /></td>
    ...
    <td className="application-records-cell-actions">
      <button type="button" className="btn btn-primary" onClick={() => void handleSave()}>保存</button>
      <button type="button" className="btn btn-secondary" onClick={cancelEdit}>取消</button>
      <button type="button" className="application-record-icon-button" aria-label="删除" ...>...</button>
    </td>
  </tr>
) : (
  <tr className="application-records-row">...</tr>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: PASS and editing now happens in-place inside the row

- [ ] **Step 5: Commit**

```bash
git add src/options/ApplicationRecordsSection.tsx src/options/ApplicationRecordsSection.test.tsx src/options/index.css
git commit -m "feat: edit application records inline in table rows"
```

## Self-Review

- Spec coverage:
  - 表格列头与列名：Task 1 / Task 2
  - 去掉顶部独立筛选框：Task 2
  - 列头排序与筛选浮层：Task 1
  - 固定宽度链接列：Task 2
  - 浏览态链接不是超链接：Task 2
  - 点击编辑后整行进入编辑态：Task 3
- Placeholder scan:
  - 所有任务都包含测试、命令和最小实现片段，无 `TODO`。
- Type consistency:
  - `editingId` 与 `draftRecord` 继续作为唯一编辑态来源。
  - 不新增消息协议与后端接口。
