# Application Records Filter Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简投递记录表格的列头交互，把筛选收进统一面板，并恢复链接列的点击打开能力。

**Architecture:** 这轮不动数据层，只调整设置页投递记录表格的视图和交互。实现分两块：先去掉 `来源站点` 列、收缩 `链接` 列、改列头排序行为并新增统一筛选面板；再恢复浏览态链接点击打开，同时保持编辑态下链接仍是普通文本输入框。

**Tech Stack:** TypeScript、React、Vite、TSX test runner

## Global Constraints

- 去掉 `来源站点` 列。
- 将 `链接` 列宽缩小到当前的大约一半，并保持固定宽度。
- 列头只保留更小的排序图标，且整块列标题都可点击排序。
- 去掉列头中的筛选图标。
- 在表格右上角新增统一的 `筛选` 按钮，点击后弹出筛选面板。
- 浏览态下，链接列文本可直接点击打开；编辑态下仍是普通文本输入框。
- 不调整投递记录 schema。
- 不恢复顶部独立筛选框。
- 不修改 CSV 导入导出逻辑。

---

## File Map

- `src/options/ApplicationRecordsSection.tsx`
  - 调整列定义、列头点击排序、统一筛选面板与链接列交互。
- `src/options/ApplicationRecordsSection.test.tsx`
  - 覆盖去列、列头点击排序、统一筛选面板与链接点击渲染。
- `src/options/index.css`
  - 调整列宽、表头按钮尺寸、筛选面板样式与链接列表现。

### Task 1: 收表头交互并新增统一筛选面板

**Files:**
- Modify: `src/options/ApplicationRecordsSection.tsx`
- Modify: `src/options/ApplicationRecordsSection.test.tsx`
- Modify: `src/options/index.css`

**Interfaces:**
- Consumes:
  - existing `sortState`
  - existing `columnFilters`
- Produces:
  - no `sourceSite` column
  - `isFilterPanelOpen: boolean`
  - clickable column header sort

- [ ] **Step 1: Write the failing test**

```tsx
test('表格中不再渲染来源站点列', () => {
  const html = renderToStaticMarkup(<ApplicationRecordsSection initialRecords={records} />);
  assert.doesNotMatch(html, /来源站点/);
});

test('点击公司列标题即可排序，不依赖单独图标按钮', async () => {
  const renderer = await renderRecordsSection();
  await act(async () => {
    findButton(renderer.root, '列头-公司').props.onClick();
  });
  assert.deepEqual(getRowCompanies(renderer.root), ['腾讯', '字节跳动']);
});

test('点击筛选按钮后出现统一筛选面板', async () => {
  const renderer = await renderRecordsSection();
  await act(async () => {
    findButton(renderer.root, '筛选').props.onClick();
  });
  assert.ok(findInputByAriaLabel(renderer.root, '筛选-公司'));
  assert.ok(findInputByAriaLabel(renderer.root, '筛选-岗位'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: FAIL because current implementation still renders `来源站点` 列，列头排序依赖按钮，且没有统一筛选面板

- [ ] **Step 3: Write minimal implementation**

```tsx
const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  { key: 'companyName', label: '公司', sortable: true },
  { key: 'jobTitle', label: '岗位', sortable: true },
  { key: 'sourceUrl', label: '链接', sortable: true, cellClassName: 'application-records-cell-link' },
  { key: 'status', label: '状态', sortable: true },
  { key: 'appliedAt', label: '投递日期', sortable: true },
  { key: 'location', label: '工作地点', sortable: true },
  { key: 'notes', label: '备注', sortable: true },
];
```

```tsx
<button
  type="button"
  className="application-records-table-head-button application-records-table-head-button-sort"
  aria-label={`列头-${column.label}`}
  onClick={() => handleSort(column.key)}
>
  <span>{column.label}</span>
  <SortIcon ... />
</button>
```

```tsx
<button type="button" className="btn btn-secondary" onClick={() => setIsFilterPanelOpen(v => !v)}>
  筛选
</button>
{isFilterPanelOpen && (
  <div className="application-records-filter-panel">
    ...
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: PASS for去列、列头点击排序与统一筛选面板

- [ ] **Step 5: Commit**

```bash
git add src/options/ApplicationRecordsSection.tsx src/options/ApplicationRecordsSection.test.tsx src/options/index.css
git commit -m "feat: simplify application records table header"
```

### Task 2: 缩窄链接列并恢复浏览态点击打开

**Files:**
- Modify: `src/options/ApplicationRecordsSection.tsx`
- Modify: `src/options/ApplicationRecordsSection.test.tsx`
- Modify: `src/options/index.css`

**Interfaces:**
- Consumes:
  - existing row edit mode
- Produces:
  - clickable link cell in browse mode
  - plain text input in edit mode
  - narrower fixed `sourceUrl` column

- [ ] **Step 1: Write the failing test**

```tsx
test('浏览态下链接列渲染为可点击链接文本', async () => {
  const renderer = await renderRecordsSection();
  const links = renderer.root.findAll(node => node.type === 'a');
  assert.ok(links.some(node => node.props.href === 'https://jobs.bytedance.com/example-1'));
});

test('编辑态下链接列仍然是普通输入框', async () => {
  const renderer = await renderRecordsSection();
  await act(async () => {
    findButton(renderer.root, '编辑').props.onClick();
  });
  const urlInput = renderer.root.findAll(node => node.type === 'input' && node.props.value === 'https://jobs.bytedance.com/example-1')[0];
  assert.ok(urlInput);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: FAIL because current browse row still renders plain text link cell

- [ ] **Step 3: Write minimal implementation**

```tsx
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
```

```css
.application-records-cell-link {
  width: 120px;
  max-width: 120px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: PASS and edit row still keeps text input for `sourceUrl`

- [ ] **Step 5: Commit**

```bash
git add src/options/ApplicationRecordsSection.tsx src/options/ApplicationRecordsSection.test.tsx src/options/index.css
git commit -m "feat: restore clickable links in application records table"
```

## Self-Review

- Spec coverage:
  - 去掉 `来源站点` 列：Task 1
  - 缩窄链接列：Task 2
  - 列头只保留排序图标、整块可点：Task 1
  - 统一 `筛选` 按钮与筛选面板：Task 1
  - 浏览态链接可点开：Task 2
  - 编辑态链接仍可修改：Task 2
- Placeholder scan:
  - 每个任务都带了测试、命令和最小实现，无空步骤。
- Type consistency:
  - 继续沿用 `sortState`、`columnFilters`、`editingId`、`draftRecord`。
  - 不新增消息协议和数据结构。
