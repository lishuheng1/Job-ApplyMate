# Task 2 Report

## status

DONE

## commit

报告文件不内嵌最终 commit hash，避免为更新 hash 而再次改写报告导致 hash 继续变化；以完成时工作树 `HEAD` 为准。

## scope

- 新增 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/content/applicationRecordMetadata.ts`
- 新增 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/content/applicationRecordMetadata.test.ts`
- 新增 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.ts`
- 新增 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.test.ts`
- 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/content/index.ts`
- 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/index.ts`
- 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/types.ts`

## implementation summary

1. 先按 brief 新建测试：
   - `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/content/applicationRecordMetadata.test.ts`
   - `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.test.ts`
2. 使用以下命令做 fail-first 验证：

   ```bash
   node --experimental-strip-types --test src/content/applicationRecordMetadata.test.ts src/background/applicationRecords.test.ts
   ```

   首次失败原因为缺少：
   - `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/content/applicationRecordMetadata.ts`
   - `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.ts`
3. 新增 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/content/applicationRecordMetadata.ts`：
   - 从 `og:site_name` 与 `document.title` 提取公司名
   - 返回 `companyName/sourceSite/sourceUrl/pageTitle`
4. 新增 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.ts`：
   - 内存态 `drafts` 管理草稿
   - `handleCreateApplicationRecordDraft` 通过 `chrome.tabs.sendMessage` 向当前页请求元数据并生成草稿
   - `handleGetApplicationRecordDraft` 返回草稿与重复项
   - `handleGetApplicationRecords` / `handleCreateApplicationRecord` / `handleUpdateApplicationRecord` / `handleDeleteApplicationRecord`
   - `handleExportApplicationRecordsCsv` / `handleImportApplicationRecordsCsv`
5. 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/types.ts`，补充投递记录相关消息类型：
   - `GET_APPLICATION_PAGE_METADATA`
   - `CREATE_APPLICATION_RECORD_DRAFT`
   - `GET_APPLICATION_RECORD_DRAFT`
   - `GET_APPLICATION_RECORDS`
   - `CREATE_APPLICATION_RECORD`
   - `UPDATE_APPLICATION_RECORD`
   - `DELETE_APPLICATION_RECORD`
   - `EXPORT_APPLICATION_RECORDS_CSV`
   - `IMPORT_APPLICATION_RECORDS_CSV`
6. 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/content/index.ts`，补充 `GET_APPLICATION_PAGE_METADATA` 消息响应，直接从当前页面返回元数据。
7. 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/index.ts`，把草稿创建、草稿读取、CRUD、CSV 导入导出接到统一消息分发入口。
8. 完成后再次运行定向测试与全量回归测试，均通过。

## test summary

### fail-first verification

命令：

```bash
node --experimental-strip-types --test src/content/applicationRecordMetadata.test.ts src/background/applicationRecords.test.ts
```

结果：FAIL

关键信息：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/background/applicationRecords.ts'
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/content/applicationRecordMetadata.ts'
```

### targeted passing verification

命令：

```bash
node --experimental-strip-types --test src/content/applicationRecordMetadata.test.ts src/background/applicationRecords.test.ts
```

结果：PASS

摘要：

```text
✔ 创建草稿时返回 duplicate 但不阻止后续创建
✔ 背景层 CRUD 与 CSV handler 可独立运行
✔ 页面元数据提取返回 sourceSite/sourceUrl，并尽量提取公司名
```

### regression verification

命令：

```bash
npm test
```

结果：PASS

摘要：

```text
ℹ tests 109
ℹ pass 109
ℹ fail 0
```

## key code notes

`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/content/applicationRecordMetadata.ts`

```ts
export function extractApplicationPageMetadata(doc: Document, url: string): ApplicationPageMetadata {
  const parsedUrl = new URL(url);
  return {
    companyName: pickCompanyName(doc),
    sourceSite: parsedUrl.host,
    sourceUrl: parsedUrl.toString(),
    pageTitle: doc.title.trim(),
  };
}
```

`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.ts`

```ts
export async function handleCreateApplicationRecordDraft(
  tabId: number,
): Promise<MessageResponse<{ draftId: string }>> {
  const tab = await chrome.tabs.get(tabId);
  const tabUrl = tab.url?.trim();
  if (!tabUrl) {
    return { success: false, error: '当前标签页缺少可用链接' };
  }

  const metadataResponse = await requestApplicationPageMetadata(tabId, tabUrl);
  if (!metadataResponse.success || !metadataResponse.data) {
    return { success: false, error: metadataResponse.error || '创建投递草稿失败' };
  }

  const draftId = createDraftId();
  drafts.set(draftId, createApplicationRecordDraft(new Date().toISOString(), metadataResponse.data));
  return { success: true, data: { draftId } };
}
```

`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/index.ts`

```ts
case 'CREATE_APPLICATION_RECORD_DRAFT':
  return await handleCreateApplicationRecordDraft(message.payload.tabId);

case 'GET_APPLICATION_RECORD_DRAFT':
  return await handleGetApplicationRecordDraft(message.payload.draftId);

case 'GET_APPLICATION_RECORDS':
  return await handleGetApplicationRecords();

case 'CREATE_APPLICATION_RECORD':
  return await handleCreateApplicationRecord(message.payload);
```

## concerns

- `drafts` 当前为 background 进程内存态缓存；在 extension service worker 被回收后，未完成的草稿会丢失。这满足当前 Task 2 的最小实现，但如果后续 UI 存在跨会话草稿恢复需求，需要落盘到 `chrome.storage`。
- `handleImportApplicationRecordsCsv` 当前在导入时会用“同公司 + 同链接”的已有记录复用 `id`，以便重复导入同一 CSV 时维持记录稳定；若后续需要更复杂的合并策略，仍需明确冲突优先级与字段覆盖规则。

---

## fix round 1

### status

DONE

### scope

- 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.ts`
- 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.test.ts`

### findings fixed

1. CSV 导入改为“追加导入”，不会再用导入结果整体覆盖原有投递记录；未参与本次导入的本地记录会被保留。
2. 当导入行与已有记录命中“同公司 + 同链接”重复时，保留导入行新生成的 `id`，不再复用已有记录 `id`。
3. 对命中已有重复的导入行追加 warning，便于 UI 在导入结果摘要中提示“可能存在重复”。
4. 补充了两条背景层回归测试，分别覆盖“保留未参与导入的现有记录”和“重复导入保留新 id 且返回 warning”。

### fail-first verification

命令：

```bash
node --experimental-strip-types --test src/background/applicationRecords.test.ts
```

结果：FAIL

关键信息：

```text
✖ CSV 导入会追加记录且保留未参与导入的现有记录
  AssertionError [ERR_ASSERTION]: 1 !== 2

✖ CSV 导入命中已有重复时保留新 id 并返回 warning
  AssertionError [ERR_ASSERTION]: 0 !== 1
```

### passing verification

命令：

```bash
node --experimental-strip-types --test src/content/applicationRecordMetadata.test.ts src/background/applicationRecords.test.ts
node --experimental-strip-types --test src/background/applicationRecords.test.ts src/shared/applicationRecords.test.ts
npm test
```

结果：PASS

摘要：

```text
定向测试：
✔ 创建草稿时返回 duplicate 但不阻止后续创建
✔ 背景层 CRUD 与 CSV handler 可独立运行
✔ CSV 导入会追加记录且保留未参与导入的现有记录
✔ CSV 导入命中已有重复时保留新 id 并返回 warning
✔ 页面元数据提取返回 sourceSite/sourceUrl，并尽量提取公司名

投递记录相关测试：
ℹ tests 11
ℹ pass 11
ℹ fail 0

全量回归：
ℹ tests 100
ℹ pass 100
ℹ fail 0

sidepanel：
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

### key code notes

`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/background/applicationRecords.ts`

```ts
const importedRecords = records.map((record, index) => {
  const duplicate = findApplicationRecordDuplicate(existingRecords, record);
  if (duplicate) {
    warnings.push(
      `第 ${index + 2} 行与已有记录重复：${record.companyName || '未命名公司'} ${record.sourceUrl || '(缺少链接)'}`,
    );
  }
  return record;
});
await StorageService.saveApplicationRecords([...existingRecords, ...importedRecords]);
```

### concerns

- 当前重复 warning 仅针对“导入数据与导入前本地已有记录”命中的情况；如果后续还需要提示“同一份 CSV 内部彼此重复”，需要再补一层导入批次内去重检查。
- 导入策略现在明确偏向“保留历史 + 允许重复 + 给出提示”；若未来产品需要按字段合并、覆盖旧记录或幂等导入，需要先定义更细的冲突解决规则。
