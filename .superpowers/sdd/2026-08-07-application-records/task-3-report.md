# Task 3 报告

## 完成状态

已完成。

## 需求理解

根据 `task-3-brief.md`，本任务要求：

- 为 `application-records` 新增独立 Vite 页面入口；
- 在 popup 右上角新增“新建投递记录”和“查看投递记录”两个按钮；
- 新建记录页需要从 `draftId` 查询串读取草稿；
- 新建记录页默认展示 `已投递` 状态，并保留空的“岗位名”输入；
- 当命中重复记录时，需要展示 `已存在` 提示；
- 先补充失败测试，再实现并通过测试与构建。

## 实际改动

### 1. 新增轻量新建记录页

新增目录 `src/application-records/`，包括：

- `index.html`
- `index.tsx`
- `App.tsx`
- `index.css`
- `App.test.tsx`

页面实现了：

- 从 `window.location.search` 读取 `draftId`；
- 通过 `GET_APPLICATION_RECORD_DRAFT` 拉取草稿与重复项；
- 表单默认状态为 `已投递`；
- “岗位名”字段默认保留空输入框；
- 通过 `CREATE_APPLICATION_RECORD` 保存记录；
- 命中重复记录时显示 `已存在` 提示。

### 2. popup 增加投递记录入口

修改 `src/popup/App.tsx` 与 `src/popup/index.css`：

- 导出 `openApplicationRecordCreateWindow()`；
- 导出 `openApplicationRecordOptions()`；
- 在 popup 头部右上角新增两个按钮：
  - `新建投递记录`
  - `查看投递记录`
- “新建投递记录”会先创建草稿，再打开 `src/application-records/index.html?draftId=...`；
- “查看投递记录”会打开 `src/application-records/index.html`。

### 3. 更新构建与测试配置

- `vite.config.ts` 增加 `applicationRecords` 入口；
- `package.json` 新增 `test:application-records`，并接入总 `test` 脚本；
- `tsconfig.app.json` 排除 `*.test.tsx`，避免测试文件进入构建类型检查而导致 `npm run build` 失败。

## TDD 记录

### 先写测试

新增测试：

- `src/application-records/App.test.tsx`
- `src/popup/applicationRecordsEntry.test.tsx`

### 先失败

运行：

```bash
npx tsx --test src/application-records/App.test.tsx src/popup/applicationRecordsEntry.test.tsx
```

初次失败原因：

- `src/application-records/App.tsx` 不存在；
- popup SSR 渲染阶段没有出现两个新按钮；
- popup 组件在测试环境下触发了 `React is not defined`。

### 再实现并验证通过

通过补齐页面、入口、按钮与 SSR 兼容处理后，测试通过。

## 验证结果

### 定向测试

```bash
npm run test:application-records
```

结果：2/2 通过。

### 全量测试

```bash
npm test
```

结果：111/111 通过。

### 构建验证

```bash
npm run build
```

结果：通过，产物包含：

- `dist/src/application-records/index.html`

## 额外说明 / concerns

- `查看投递记录` 目前打开的是同一个 `application-records` 页面基础入口，满足本任务“新增 popup 入口与轻量新建记录页”的要求，但尚未实现完整的记录列表/管理视图；
- 为保证 SSR 测试可渲染 popup 按钮，`src/popup/App.tsx` 对无 `window` 场景做了轻量兼容处理；
- `tsconfig.app.json` 需要额外排除 `*.test.tsx`，否则新增测试文件会阻塞 `npm run build`。
