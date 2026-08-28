# Task 1 Report

## status

DONE

## commit

报告文件不内嵌最终 commit hash，避免为更新 hash 而再次改写报告导致 hash 继续变化；以完成时工作树 `HEAD` 为准。

## scope

- 新增 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.ts`
- 新增 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.test.ts`
- 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/types.ts`
- 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/storage.ts`

## implementation summary

1. 先按 brief 新建 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.test.ts`，覆盖以下行为：
   - `createApplicationRecordDraft` 默认状态为 `已投递`，且 `jobTitle` 为空
   - `findApplicationRecordDuplicate` 采用“同公司 + 同链接”命中规则
   - CSV 固定表头、非法状态 warning、导入导出 roundtrip
   - `StorageService` 的投递记录读写、新增、更新、删除
2. 使用以下命令做 fail-first 验证：

   ```bash
   node --experimental-strip-types --test src/shared/applicationRecords.test.ts
   ```

   首次失败原因为缺少 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.ts`。
3. 在 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/types.ts` 新增投递记录相关类型：
   - `ApplicationRecordStatus`
   - `ApplicationPageMetadata`
   - `ApplicationRecord`
   - `ApplicationRecordDraft`
4. 新增 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.ts`：
   - 固定状态枚举与 CSV 表头常量
   - `createApplicationRecordDraft`
   - `findApplicationRecordDuplicate`
   - `serializeApplicationRecordsCsv`
   - `parseApplicationRecordsCsv`
   - 内置基础 CSV 转义与逐字符解析，支持引号、逗号和换行场景
5. 修改 `/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/storage.ts`：
   - 为 `STORAGE_KEYS` 新增 `APPLICATION_RECORDS`
   - 为 `StorageService` 新增 `get/save/create/update/deleteApplicationRecord(s)` 五个投递记录方法
6. 完成后再次运行定向测试与全量回归测试，均通过。
7. 提交 commit：`feat: add application record data model and csv helpers`

## test summary

### fail-first verification

命令：

```bash
node --experimental-strip-types --test src/shared/applicationRecords.test.ts
```

结果：FAIL

关键信息：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/shared/applicationRecords.ts'
```

### targeted passing verification

命令：

```bash
node --experimental-strip-types --test src/shared/applicationRecords.test.ts
```

结果：PASS

摘要：

```text
✔ createApplicationRecordDraft 默认状态为已投递且岗位名留空
✔ findApplicationRecordDuplicate 按同公司加同链接命中
✔ CSV 导出列头固定并包含全部字段
✔ CSV 导入对非法状态给出 warning
✔ CSV 导入导出后保留 companyName/sourceUrl/status
✔ StorageService 可保存并读取投递记录列表
✔ StorageService 可新增、更新、删除单条投递记录
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

`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.ts`

```ts
export function createApplicationRecordDraft(
  nowIso: string,
  metadata: ApplicationPageMetadata,
): ApplicationRecordDraft {
  return {
    companyName: metadata.companyName,
    jobTitle: '',
    sourceSite: metadata.sourceSite,
    sourceUrl: metadata.sourceUrl,
    status: '已投递',
    notes: '',
    appliedAt: nowIso.slice(0, 10),
    location: '',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
```

`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/applicationRecords.ts`

```ts
export function parseApplicationRecordsCsv(csv: string): {
  records: ApplicationRecord[];
  warnings: string[];
} {
  const rows = parseCsvRows(csv);
  const warnings: string[] = [];

  if (rows.length === 0) {
    return { records: [], warnings: ['CSV 内容为空'] };
  }

  const [headerRow, ...dataRows] = rows;
  const normalizedHeaderRow = headerRow.map(header => header.trim());

  if (
    normalizedHeaderRow.length !== APPLICATION_RECORD_CSV_HEADERS.length
    || APPLICATION_RECORD_CSV_HEADERS.some((header, index) => normalizedHeaderRow[index] !== header)
  ) {
    return {
      records: [],
      warnings: ['CSV 表头不合法，必须与固定列头完全一致'],
    };
  }
```

`/Users/bytedance/Downloads/网申/Job-Application-Helper/.worktrees/application-records/src/shared/storage.ts`

```ts
static async createApplicationRecord(record: ApplicationRecord): Promise<void> {
  const records = await this.getApplicationRecords();
  await this.saveApplicationRecords([...records, record]);
}

static async updateApplicationRecord(record: ApplicationRecord): Promise<void> {
  const records = await this.getApplicationRecords();
  await this.saveApplicationRecords(records.map(existingRecord => (
    existingRecord.id === record.id ? record : existingRecord
  )));
}

static async deleteApplicationRecord(id: string): Promise<void> {
  const records = await this.getApplicationRecords();
  await this.saveApplicationRecords(records.filter(record => record.id !== id));
}
```

## concerns

- 当前 CSV 导入对表头采用“固定顺序完全一致”校验，满足 Task 1 约束，但如果后续需要兼容列顺序调整、BOM 或别名列头，仍需扩展解析策略。
- `StorageService.updateApplicationRecord` 与 `deleteApplicationRecord` 当前在 `id` 不存在时采用静默 no-op；这与现有最小实现一致，但若后续 UI 需要错误提示，建议在消息层补充显式结果返回。
