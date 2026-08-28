# Application Records Inline Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将投递记录列表改成行内编辑模式，并把新建页保存成功反馈改成常驻可见而不自动关闭窗口。

**Architecture:** 这轮不碰数据层和消息协议，只改视图渲染位置与反馈方式。实现分成两块：第一块调整新建页保存成功后的可见反馈；第二块将设置页投递记录区从“右侧编辑卡片”重构成“列表行 + 行内展开编辑区”，并同步把操作按钮改为 `打开链接 + 图标按钮`。

**Tech Stack:** TypeScript、React、Chrome Extension Manifest V3、Vite、Node test runner、TSX test runner

## Global Constraints

- 将投递记录列表每一行右侧操作改为：`打开链接` + `编辑` 图标 + `删除` 图标。
- `编辑` 和 `删除` 使用轻量线性 SVG 图标，不再显示中文按钮文字。
- 点击 `编辑` 后在当前这一行下方直接展开编辑区，而不是依赖右侧编辑卡片。
- 新建投递记录页保存成功后不再自动关闭窗口，而是在保存按钮附近显示持续可见的 `已保存` 提示。
- 不新增字段，不修改 `ApplicationRecord` schema。
- 不调整投递记录的预填逻辑、重复判断和保存消息类型。
- 不新增批量操作、排序方式或统计视图。
- 不修改 CSV 导入导出行为。

---

## File Map

- `src/application-records/App.tsx`
  - 去掉保存成功后的自动关闭逻辑，把成功提示放到按钮区附近。
- `src/application-records/App.test.tsx`
  - 覆盖保存成功后不关闭窗口、并显示 `已保存`。
- `src/options/ApplicationRecordsSection.tsx`
  - 将行尾操作改成 `打开链接 + 编辑图标 + 删除图标`，并把编辑区移到当前行下方。
- `src/options/ApplicationRecordsSection.test.tsx`
  - 覆盖图标按钮渲染、行内展开编辑、取消收起与更新消息仍然发出。
- `src/options/index.css`
  - 增加图标按钮样式、行内编辑区样式，并移除右侧编辑卡片布局依赖。

### Task 1: 新建页保存后保持打开并显示常驻成功提示

**Files:**
- Modify: `src/application-records/App.tsx`
- Modify: `src/application-records/App.test.tsx`

**Interfaces:**
- Consumes:
  - `MessageService.sendMessage({ type: 'CREATE_APPLICATION_RECORD' })`
  - existing `successText` / `errorText` state
- Produces:
  - success notice text `已保存`
  - no `window.close()` call on save success

- [ ] **Step 1: Write the failing test**

```tsx
test('保存成功后不会自动关闭窗口，并在按钮附近显示已保存', async () => {
  const closeSpy = mock.fn();
  const originalWindow = globalThis.window;
  const originalSendMessage = MessageService.sendMessage;

  globalThis.window = {
    location: { search: '?draftId=record-1' },
    close: closeSpy,
  } as Window & typeof globalThis;

  let sendCount = 0;
  MessageService.sendMessage = (async () => {
    sendCount += 1;
    if (sendCount === 1) {
      return {
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
      };
    }

    return {
      success: true,
      data: { duplicate: null },
    };
  }) as typeof MessageService.sendMessage;

  const renderer = await renderCreateApp();
  await submitCreateForm(renderer);

  assert.equal(closeSpy.mock.callCount(), 0);
  assert.match(getText(renderer.root), /已保存/);

  MessageService.sendMessage = originalSendMessage;
  globalThis.window = originalWindow;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/application-records/App.test.tsx`

Expected: FAIL because current success branch still calls `window.close()`

- [ ] **Step 3: Write minimal implementation**

```tsx
setSuccessText(response.data?.duplicate ? '已存在' : '已保存');
setSaving(false);
return;
```

```tsx
<div className="record-form-actions">
  <button ...>...</button>
  {successText && !duplicateId && (
    <span className="record-submit-status" role="status">
      {successText}
    </span>
  )}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/application-records/App.test.tsx`

Expected: PASS，保存成功后不再关闭窗口，`已保存` 在动作区可见

- [ ] **Step 5: Commit**

```bash
git add src/application-records/App.tsx src/application-records/App.test.tsx
git commit -m "feat: keep application record create window open after save"
```

### Task 2: 投递记录列表改为图标操作与行内展开编辑

**Files:**
- Modify: `src/options/ApplicationRecordsSection.tsx`
- Modify: `src/options/ApplicationRecordsSection.test.tsx`
- Modify: `src/options/index.css`

**Interfaces:**
- Consumes:
  - existing `filteredRecords`
  - existing `editingId`
  - existing `draftRecord`
  - existing `beginEdit(record)`, `cancelEdit()`, `handleSave()`, `handleDelete(record)`
- Produces:
  - `打开链接` action
  - icon buttons with `aria-label="编辑"` and `aria-label="删除"`
  - inline editor block rendered below active row

- [ ] **Step 1: Write the failing test**

```tsx
test('列表行渲染打开链接、编辑图标和删除图标按钮', async () => {
  const renderer = await renderRecordsSection();
  assert.ok(findButton(renderer.root, '打开链接'));
  assert.ok(findButton(renderer.root, '编辑'));
  assert.ok(findButton(renderer.root, '删除'));
});

test('点击编辑图标后在当前行下方展开编辑区', async () => {
  const renderer = await renderRecordsSection();
  await act(async () => {
    findButton(renderer.root, '编辑').props.onClick();
  });
  assert.match(getText(renderer.root), /保存修改/);
  assert.match(getText(renderer.root), /取消/);
});

test('点击取消后行内编辑区收起', async () => {
  const renderer = await renderRecordsSection();
  await act(async () => {
    findButton(renderer.root, '编辑').props.onClick();
  });
  await act(async () => {
    findButton(renderer.root, '取消').props.onClick();
  });
  assert.doesNotMatch(getText(renderer.root), /保存修改/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: FAIL because current UI still uses right-side editor card and text buttons

- [ ] **Step 3: Write minimal implementation**

```tsx
<button
  type="button"
  className="application-record-icon-button"
  aria-label="编辑"
  onClick={() => beginEdit(record)}
>
  <svg viewBox="0 0 20 20" aria-hidden="true">...</svg>
</button>
<button
  type="button"
  className="application-record-icon-button application-record-icon-button-danger"
  aria-label="删除"
  onClick={() => void handleDelete(record)}
>
  <svg viewBox="0 0 20 20" aria-hidden="true">...</svg>
</button>
```

```tsx
{editingId === record.id && draftRecord && (
  <div className="application-record-inline-editor">
    ...
    <button type="button" className="btn btn-secondary" onClick={cancelEdit}>取消</button>
    <button type="button" className="btn btn-primary" onClick={() => void handleSave()}>保存修改</button>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx`

Expected: PASS and inline editor now appears inside the list flow

- [ ] **Step 5: Commit**

```bash
git add src/options/ApplicationRecordsSection.tsx src/options/ApplicationRecordsSection.test.tsx src/options/index.css
git commit -m "feat: add inline editing for application records"
```

## Self-Review

- Spec coverage:
  - 新建页保存后保持打开：Task 1
  - 保存按钮附近常驻 `已保存`：Task 1
  - 行尾 `打开链接 + 编辑图标 + 删除图标`：Task 2
  - 点击编辑后在当前行下方展开：Task 2
  - 去掉右侧独立编辑卡片：Task 2
- Placeholder scan:
  - 每个任务都给了文件、测试、命令和最小实现片段，没有 `TODO` 或空步骤。
- Type consistency:
  - 仍沿用 `editingId`、`draftRecord`、`beginEdit`、`handleSave` 命名。
  - 没有引入新的消息类型或数据模型。
