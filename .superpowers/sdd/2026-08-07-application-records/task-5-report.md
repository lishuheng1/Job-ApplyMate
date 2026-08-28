# Task 5 报告

## 要求来源

- 唯一要求来源：`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/.superpowers/sdd/2026-08-07-application-records/task-5-brief.md`

## 实现摘要

本次围绕 Task 5 完成了三类收尾工作：

1. 补齐回归测试，先验证失败，再最小实现通过。
2. 打通“查看投递记录”入口到设置页 `application-records` 标签的 query 驱动切换。
3. 让新建投递记录页在命中重复时显示“已存在”提示且提交按钮文案改为“继续保存”。

## TDD 过程

### Red

先补充并运行失败测试：

- `src/application-records/App.test.tsx`
  - 新增“命中同公司同链接时新建页显示已存在提示但保留继续保存按钮”
- `src/options/ApplicationRecordsSection.test.tsx`
  - 新增“query 指定 tab=application-records 时设置页直接打开投递记录标签”
- `src/popup/applicationRecordsEntry.test.tsx`
  - 新增“查看投递记录入口打开带 query 的设置页标签”

失败现象：

- 新建页重复场景下提交按钮仍是“保存投递记录”
- 设置页不识别 `?tab=application-records`

### Green

最小实现如下：

- `src/application-records/App.tsx`
  - 当存在 `duplicateId` 时，提交按钮文案改为“继续保存”
- `src/options/App.tsx`
  - 增加 `getInitialActiveTab()` 解析 query
  - 增加 `OptionTab` 白名单，避免非法 query
  - 在无 Chrome API 的测试/静态渲染环境下跳过加载态
- `src/popup/App.tsx`
  - “查看投递记录”改为打开 `src/options/index.html?tab=application-records`
- `src/options/ApplicationRecordsSection.tsx`
  - 修正返回类型为 `React.JSX.Element`，消除构建错误
- `package.json`
  - 将投递记录相关测试拆分为 `test:application-records:core` 与 `test:application-records:ui`
  - `test:application-records` 聚合核心与 UI 回归测试

## 修改文件

- `package.json`
- `src/application-records/App.test.tsx`
- `src/application-records/App.tsx`
- `src/options/App.tsx`
- `src/options/ApplicationRecordsSection.test.tsx`
- `src/options/ApplicationRecordsSection.tsx`
- `src/popup/App.tsx`
- `src/popup/applicationRecordsEntry.test.tsx`

## 关键代码片段

### 1. 重复记录时按钮改为“继续保存”

```tsx
<button type="submit" className="record-submit-button" disabled={loading || saving}>
  {loading ? '正在加载草稿...' : saving ? '保存中...' : duplicateId ? '继续保存' : '保存投递记录'}
</button>
```

### 2. 设置页按 query 直达“投递记录”标签

```tsx
function getInitialActiveTab(search: string): OptionTab {
  const tab = new URLSearchParams(search).get('tab');
  return OPTION_TABS.includes(tab as OptionTab) ? tab as OptionTab : 'personal';
}
```

### 3. popup 查看入口跳转到 options tab

```tsx
export async function openApplicationRecordOptions(): Promise<void> {
  await chrome.tabs.create({
    url: getRuntimeUrl('src/options/index.html?tab=application-records'),
  });
}
```

## 测试记录

### 失败验证

执行：

```bash
npm exec tsx -- --test src/application-records/App.test.tsx src/options/ApplicationRecordsSection.test.tsx
```

结果：先出现 2 个失败用例，分别对应“继续保存”按钮文案和 query 驱动标签切换缺失。

### 通过验证

执行：

```bash
node --experimental-strip-types --test src/shared/applicationRecords.test.ts src/content/applicationRecordMetadata.test.ts src/background/applicationRecords.test.ts
```

结果：12/12 通过。

执行：

```bash
npm exec tsx -- --test src/popup/applicationRecordsEntry.test.tsx src/application-records/App.test.tsx src/options/ApplicationRecordsSection.test.tsx
```

结果：14/14 通过。

执行：

```bash
npm run test:application-records
```

结果：核心 12/12 通过，UI 14/14 通过。

执行：

```bash
npm run build
```

结果：构建通过。

## 提交信息

- Commit: 以最终响应返回的 HEAD 为准

## concerns

- 无阻塞项。
- `src/options/ApplicationRecordsSection.tsx` 的 `JSX.Element` 返回类型原本会导致 `tsc -b` 失败，本次一并修正为 `React.JSX.Element`，否则无法满足 brief 中的最终 build 校验。

---

## 2026-08-08 最终审查修复追加

### 审查结论与根因

本轮按最终审查结果补修 3 个问题，并先做根因定位再落代码：

1. 新建页连续保存会产生重复 id 记录
   - 根因：`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/application-records/App.tsx` 首次保存后会复用同一个 `form.id`，但 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.ts` 的 `handleCreateApplicationRecord()` 一直执行 append，导致同 id 被重复落库。
2. 设置页编辑缺少 `sourceSite`
   - 根因：`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/options/ApplicationRecordsSection.tsx` 的编辑表单少了“来源站点”输入，只在列表摘要里展示，和“可编辑字段”口径不一致。
3. 非法 CSV 表头返回了 `success + imported=0`
   - 根因：`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.ts` 只把非法表头当 warning 返回；背景层 `handleImportApplicationRecordsCsv()` 未区分致命解析错误，继续回 success。

### TDD 记录

#### Red

先补失败测试并确认确实失败：

- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.test.ts`
  - `连续保存同一条新建记录时不会生成重复 id 记录`
  - `非法 CSV 表头导入返回失败而不是 success + 0`
- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/options/ApplicationRecordsSection.test.tsx`
  - `设置页编辑时可修改来源站点并随保存请求发出`

失败结果：

- 背景层重复创建同 id 时列表长度为 `2`，证明确实发生重复落库。
- 非法 CSV 表头导入时 `success === true`，证明消息层错误地把致命校验当成普通 warning。
- 设置页编辑态找不到 `sourceSite` 输入框，证明“可编辑字段”不完整。

#### Green

最小实现如下：

- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.ts`
  - `CREATE_APPLICATION_RECORD` 改为“同 id upsert、不同 id append”
  - duplicate 检测时排除相同 id，避免把当前记录自己判成重复
  - CSV 导入解析拿到 `error` 时直接返回 `success: false`
- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.ts`
  - 非法表头除了保留 warning，也额外返回结构化 `error`
- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/options/ApplicationRecordsSection.tsx`
  - 编辑表单新增“来源站点”输入框
  - 编辑说明文案补齐 `sourceSite`

### 关键代码

#### 1. 同 id 连续保存改为 upsert

```ts
const duplicate = findApplicationRecordDuplicate(
  records.filter(existingRecord => existingRecord.id !== record.id),
  record,
);
const hasSameId = records.some(existingRecord => existingRecord.id === record.id);
await StorageService.saveApplicationRecords(
  hasSameId
    ? records.map(existingRecord => (existingRecord.id === record.id ? record : existingRecord))
    : [...records, record],
);
```

#### 2. 非法 CSV 表头升级为失败

```ts
const { records, warnings, error } = parseApplicationRecordsCsv(csv);
if (error) {
  return {
    success: false,
    error,
  };
}
```

```ts
return {
  records: [],
  warnings: ['CSV 表头不合法，必须与固定列头完全一致'],
  error: 'CSV 表头不合法，必须与固定列头完全一致',
};
```

#### 3. 设置页编辑补齐 `sourceSite`

```tsx
<label>
  <span>来源站点</span>
  <input
    type="text"
    value={draftRecord.sourceSite}
    onChange={event => updateDraftField('sourceSite', event.target.value)}
    disabled={busyAction !== null}
  />
</label>
```

### 修改文件

- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.ts`
- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.ts`
- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/options/ApplicationRecordsSection.tsx`
- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.test.ts`
- `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/options/ApplicationRecordsSection.test.tsx`

### 测试摘要

失败验证：

```bash
node --experimental-strip-types --test src/background/applicationRecords.test.ts
npm exec tsx -- --test src/options/ApplicationRecordsSection.test.tsx
```

其中新增 3 个用例先失败，分别命中“重复 id 连续保存”“非法表头 success+0”“编辑缺少 sourceSite”。

通过验证：

```bash
npm run test:application-records
npm run build
```

结果：

- `test:application-records`：29/29 通过
  - core 14/14 通过
  - ui 15/15 通过
- `build`：通过

### concerns

- 当前“新建页连续保存”采用 background 层 upsert 兜底，能稳定避免重复 id 记录；如果后续想把“第二次点击保存”明确建模成编辑而不是重提交流程，可再单独梳理 create page 的交互语义。
- 非法 CSV 表头现已直接失败；空文件仍沿用 warning 语义返回 `CSV 内容为空`，因为本次最终审查只要求修正“非法表头”场景。
