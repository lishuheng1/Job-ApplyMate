# Application Records UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛投递记录第一版的界面细节，让保存动作更顺手、popup 顶部按钮更易点、设置页列表更紧凑。

**Architecture:** 这轮只做 UI/交互层收口，不改投递记录数据模型和消息协议。改动分成三块：新建页保存成功后的关闭逻辑、popup 顶部投递记录按钮样式与文案、设置页投递记录列表从卡片改成单行列表，同时补对应回归测试。

**Tech Stack:** TypeScript、React、Chrome Extension Manifest V3、Vite、Node test runner、TSX test runner

## Global Constraints

- 新建投递记录保存成功后，立即提示“已保存”并关闭当前新建窗口。
- popup 顶部的 `新建投递记录` 与 `打开投递记录` 两个按钮在视觉和交互上更接近现有主按钮：点击区域更大，hover 时鼠标显示小手。
- 设置页中的投递记录列表从“卡片式堆叠”调整为“单行一条”的紧凑列表。
- 保留右侧编辑区，不把现有编辑能力改成表格内联编辑。
- 不调整投递记录字段集合。
- 不改变新建页的预填策略、重复判断和保存语义。
- 不改变设置页右侧编辑区的字段结构。
- 不新增统计视图、批量操作或更多筛选维度。
- 不修改 CSV 导入导出逻辑。

---

## File Map

- `src/application-records/App.tsx`
  - 调整保存成功后的提示与关闭窗口行为。
- `src/application-records/App.test.tsx`
  - 覆盖保存成功后的关闭逻辑与成功提示。
- `src/popup/App.tsx`
  - 统一顶部按钮文案为 `打开投递记录`。
- `src/popup/index.css`
  - 放大顶部两个按钮并补齐 hover 小手样式。
- `src/popup/applicationRecordsEntry.test.tsx`
  - 覆盖顶部按钮新文案仍可渲染。
- `src/options/ApplicationRecordsSection.tsx`
  - 将左侧列表从卡片结构改为单行列表结构，保留右侧编辑区。
- `src/options/ApplicationRecordsSection.test.tsx`
  - 覆盖单行列表渲染、点击进入编辑区。
- `src/options/index.css`
  - 重写投递记录列表区样式，使其更紧凑。

### Task 1: 新建页保存后立即关闭窗口

**Files:**
- Modify: `src/application-records/App.tsx`
- Modify: `src/application-records/App.test.tsx`

**Interfaces:**
- Consumes:
  - `MessageService.sendMessage({ type: 'CREATE_APPLICATION_RECORD' })`
  - existing success/error state in `src/application-records/App.tsx`
- Produces:
  - success notice text `已保存`
  - `window.close()` on successful save

- [ ] **Step 1: Write the failing test**

```tsx
test('保存成功后显示已保存并关闭窗口', async () => {
  const closeSpy = mock.fn();
  const originalClose = window.close;
  window.close = closeSpy as unknown as typeof window.close;

  mockSendMessage
    .mock.mockImplementationOnce(async () => ({
      success: true,
      data: {
        draft: {
          companyName: '字节跳动',
          jobTitle: '',
          sourceSite: 'jobs.bytedance.com',
          sourceUrl: 'https://jobs.bytedance.com/example',
          status: '已投递',
          notes: '',
          appliedAt: '2026-08-08',
          location: '',
          createdAt: '2026-08-08T10:00:00.000Z',
          updatedAt: '2026-08-08T10:00:00.000Z',
        },
        duplicate: null,
      },
    }))
    .mock.mockImplementationOnce(async () => ({
      success: true,
      data: { duplicate: null },
    }));

  const renderer = await renderCreateApp();
  await submitCreateForm(renderer);

  assert.match(getText(renderer.root), /已保存/);
  assert.equal(closeSpy.mock.callCount(), 1);

  window.close = originalClose;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/application-records/App.test.tsx`

Expected: FAIL because current implementation preserves the page state after save and does not call `window.close()`

- [ ] **Step 3: Write minimal implementation**

```tsx
setSuccessText('已保存');
if (typeof window !== 'undefined' && typeof window.close === 'function') {
  window.close();
}
return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/application-records/App.test.tsx`

Expected: PASS and success branch now calls `window.close()`

- [ ] **Step 5: Commit**

```bash
git add src/application-records/App.tsx src/application-records/App.test.tsx
git commit -m "feat: close application record window after save"
```

### Task 2: popup 顶部投递记录按钮微调

**Files:**
- Modify: `src/popup/App.tsx`
- Modify: `src/popup/index.css`
- Modify: `src/popup/applicationRecordsEntry.test.tsx`

**Interfaces:**
- Consumes:
  - existing popup header action area
- Produces:
  - button label `打开投递记录`
  - larger `.header-action-button`
  - pointer cursor on hover-ready buttons

- [ ] **Step 1: Write the failing test**

```tsx
test('popup 右上角渲染新建投递记录和打开投递记录按钮', async () => {
  const popupModule = await import('./App.tsx');
  const html = renderToStaticMarkup(React.createElement(popupModule.default));
  assert.match(html, /新建投递记录/);
  assert.match(html, /打开投递记录/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/popup/applicationRecordsEntry.test.tsx`

Expected: FAIL because current button label is still `查看投递记录`

- [ ] **Step 3: Write minimal implementation**

```tsx
<button
  type="button"
  className="header-action-button header-action-button-secondary"
  onClick={() => void handleOpenApplicationRecords()}
  disabled={openingApplicationRecords}
>
  {openingApplicationRecords ? '打开中...' : '打开投递记录'}
</button>
```

```css
.header-action-button {
  min-height: 34px;
  padding: 7px 14px;
  font-size: 12px;
  cursor: pointer;
}

.header-action-button:hover:not(:disabled) {
  border-color: rgba(79, 70, 229, 0.28);
  background: rgba(79, 70, 229, 0.12);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/popup/applicationRecordsEntry.test.tsx`

Expected: PASS and popup still renders both top-right buttons

- [ ] **Step 5: Commit**

```bash
git add src/popup/App.tsx src/popup/index.css src/popup/applicationRecordsEntry.test.tsx
git commit -m "feat: polish popup application record buttons"
```

### Task 3: 设置页投递记录列表改为单行布局

**Files:**
- Modify: `src/options/ApplicationRecordsSection.tsx`
- Modify: `src/options/ApplicationRecordsSection.test.tsx`
- Modify: `src/options/index.css`

**Interfaces:**
- Consumes:
  - existing `filteredRecords`
  - existing `beginEdit(record)`
  - existing right-side editor panel
- Produces:
  - list row structure with company/job/status/sourceSite/appliedAt/actions
  - selected row state using `editingId`

- [ ] **Step 1: Write the failing test**

```tsx
test('投递记录列表以单行结构渲染核心字段', async () => {
  const renderer = await renderRecordsSection();
  const text = getText(renderer.root);
  assert.match(text, /字节跳动/);
  assert.match(text, /前端开发/);
  assert.match(text, /已投递/);
  assert.match(text, /jobs\.bytedance\.com/);
  assert.match(text, /2026-08-07/);
});

test('点击列表行后进入右侧编辑区', async () => {
  const renderer = await renderRecordsSection();
  const editButton = findButton(renderer.root, '编辑');
  await act(async () => {
    editButton.props.onClick();
  });
  assert.match(getText(renderer.root), /编辑投递记录/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: FAIL because current assertions and layout still assume card-style rendering

- [ ] **Step 3: Write minimal implementation**

```tsx
<div className={`application-record-row${editingId === record.id ? ' is-active' : ''}`} key={record.id}>
  <button type="button" className="application-record-row-main" onClick={() => beginEdit(record)}>
    <span className="application-record-row-company">{record.companyName || '未填写公司名'}</span>
    <span className="application-record-row-job">{record.jobTitle || '未填写岗位名'}</span>
    <span className="application-record-row-status">{record.status}</span>
    <span className="application-record-row-site">{record.sourceSite || '未填写'}</span>
    <span className="application-record-row-date">{record.appliedAt || '未填写'}</span>
  </button>
  <div className="application-record-row-actions">
    ...
  </div>
</div>
```

```css
.application-record-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: #fff;
}

.application-record-row-main {
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) minmax(140px, 1fr) 88px 140px 110px;
  gap: 12px;
  align-items: center;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: PASS and existing editor behavior still works after list layout rewrite

- [ ] **Step 5: Commit**

```bash
git add src/options/ApplicationRecordsSection.tsx src/options/ApplicationRecordsSection.test.tsx src/options/index.css
git commit -m "feat: compact application records list layout"
```

## Self-Review

- Spec coverage:
  - 保存成功后立即关闭：Task 1
  - popup 顶部按钮放大、hover 小手、按钮文案：Task 2
  - 列表从卡片改为单行：Task 3
  - 保留右侧编辑区：Task 3
- Placeholder scan:
  - 所有任务都提供了文件、测试、命令和代码片段，没有 `TODO` 或空泛步骤。
- Type consistency:
  - 没有引入新的消息协议或数据类型。
  - `editingId`、`beginEdit(record)` 与 `filteredRecords` 仍沿用现有 `ApplicationRecordsSection` 命名。
