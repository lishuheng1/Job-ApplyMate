import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer, { act } from 'react-test-renderer';
import { ApplicationRecordsSection } from './ApplicationRecordsSection.tsx';
import { MessageService } from '../shared/message.ts';
import type { ApplicationRecord, Message, MessageResponse } from '../shared/types.ts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const [firstArg] = args;
  if (
    typeof firstArg === 'string'
    && (
      firstArg.includes('react-test-renderer is deprecated')
      || firstArg.includes('The current testing environment is not configured to support act')
    )
  ) {
    return;
  }

  originalConsoleError(...args);
};

const records: ApplicationRecord[] = [
  {
    id: 'r1',
    companyName: '字节跳动',
    jobTitle: '前端开发',
    sourceSite: 'jobs.bytedance.com',
    sourceUrl: 'https://jobs.bytedance.com/example-1',
    status: '已投递',
    notes: '一志愿',
    appliedAt: '2026-08-07',
    location: '北京',
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
  },
  {
    id: 'r2',
    companyName: '腾讯',
    jobTitle: '产品经理',
    sourceSite: 'join.qq.com',
    sourceUrl: 'https://join.qq.com/example-2',
    status: '面试中',
    notes: '',
    appliedAt: '2026-08-06',
    location: '深圳',
    createdAt: '2026-08-06T10:00:00.000Z',
    updatedAt: '2026-08-06T10:00:00.000Z',
  },
];

function getText(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child => typeof child === 'string' ? child : getText(child))
    .join('');
}

function getAlertTexts(root: TestRenderer.ReactTestInstance): string[] {
  return root.findAll(node => node.props.role === 'alert').map(getText);
}

function getBodyRows(root: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance[] {
  return root.findAll(node => node.type === 'tr' && node.props['data-row-type'] === 'data');
}

function getRowCompanies(root: TestRenderer.ReactTestInstance): string[] {
  return getBodyRows(root).map(row => {
    const companyCell = row.find(node => node.type === 'td' && node.props['data-column'] === 'companyName');
    return getText(companyCell);
  });
}

function getRowAppliedDates(root: TestRenderer.ReactTestInstance): string[] {
  return getBodyRows(root).map(row => {
    const appliedAtCell = row.find(node => node.type === 'td' && node.props['data-column'] === 'appliedAt');
    return getText(appliedAtCell);
  });
}

function findButton(root: TestRenderer.ReactTestInstance, label: string): TestRenderer.ReactTestInstance {
  return root.findAllByType('button').find(
    node => getText(node) === label || node.props['aria-label'] === label,
  ) ?? (() => {
    throw new Error(`未找到按钮：${label}`);
  })();
}

function findInputByAriaLabel(root: TestRenderer.ReactTestInstance, label: string): TestRenderer.ReactTestInstance {
  const match = root.findAll(
    node => (node.type === 'input' || node.type === 'select') && node.props['aria-label'] === label,
  )[0];
  if (!match) {
    throw new Error(`未找到输入：${label}`);
  }
  return match;
}

function withMockedSendMessage(
  implementation: (message: Message) => Promise<MessageResponse<any>>,
  run: () => Promise<void>,
): Promise<void> {
  const original = MessageService.sendMessage;
  MessageService.sendMessage = implementation as typeof MessageService.sendMessage;
  return run().finally(() => {
    MessageService.sendMessage = original;
  });
}

test('表格列头渲染公司、岗位、链接等明确列名', () => {
  const html = renderToStaticMarkup(<ApplicationRecordsSection initialRecords={records} />);
  assert.match(html, /公司/);
  assert.match(html, /岗位/);
  assert.match(html, /链接/);
  assert.match(html, /状态/);
  assert.doesNotMatch(html, /来源站点/);
});

test('投递记录说明文案已移除“在设置页”字样', () => {
  const html = renderToStaticMarkup(<ApplicationRecordsSection initialRecords={records} />);
  assert.match(html, /统一查看、筛选、排序、编辑、删除，并支持 CSV 导入导出已有投递记录。/);
  assert.doesNotMatch(html, /在设置页统一查看/);
});

test('设置页桌面容器宽度已放宽到 1240px', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.options-header-inner\s*\{[\s\S]*?max-width:\s*1240px;/,
  );
  assert.match(
    css,
    /\.options-content\s*\{[\s\S]*?max-width:\s*1240px;/,
  );
});

test('列标题排序图标已放大到 15px', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.application-records-sort-icon\s*\{[^}]*font-size:\s*15px;/,
  );
});

test('未排序列的排序提示默认隐藏，仅在 hover 时显示', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.application-records-sort-icon-hint\s*\{[^}]*opacity:\s*0;/,
  );
  assert.match(
    css,
    /\.application-records-table-head-button-sort:hover\s+\.application-records-sort-icon-hint[\s\S]*opacity:\s*1;/,
  );
});

test('未排序时列标题显示上下双箭头，排序后切换为单个方向箭头', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
  });

  const initialHeader = findButton(renderer.root, '列头-公司');
  assert.equal(getText(initialHeader), '公司↑↓');

  await act(async () => {
    initialHeader.props.onClick();
  });

  const ascHeader = findButton(renderer.root, '列头-公司');
  assert.equal(getText(ascHeader), '公司↑');

  await act(async () => {
    ascHeader.props.onClick();
  });

  const descHeader = findButton(renderer.root, '列头-公司');
  assert.equal(getText(descHeader), '公司↓');
});

test('支持按点击顺序进行多列排序', async () => {
  const sortRecords: ApplicationRecord[] = [
    {
      id: 's1',
      companyName: '腾讯',
      jobTitle: '前端开发',
      sourceSite: 'join.qq.com',
      sourceUrl: 'https://join.qq.com/a',
      status: '已投递',
      notes: '',
      appliedAt: '2026-08-07',
      location: '深圳',
      createdAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
    },
    {
      id: 's2',
      companyName: '腾讯',
      jobTitle: '前端开发',
      sourceSite: 'join.qq.com',
      sourceUrl: 'https://join.qq.com/b',
      status: '已投递',
      notes: '',
      appliedAt: '2026-08-06',
      location: '深圳',
      createdAt: '2026-08-06T10:00:00.000Z',
      updatedAt: '2026-08-06T10:00:00.000Z',
    },
    {
      id: 's3',
      companyName: '字节跳动',
      jobTitle: '前端开发',
      sourceSite: 'jobs.bytedance.com',
      sourceUrl: 'https://jobs.bytedance.com/c',
      status: '已投递',
      notes: '',
      appliedAt: '2026-08-09',
      location: '北京',
      createdAt: '2026-08-09T10:00:00.000Z',
      updatedAt: '2026-08-09T10:00:00.000Z',
    },
  ];

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={sortRecords} />);
  });

  await act(async () => {
    findButton(renderer.root, '列头-公司').props.onClick();
  });
  await act(async () => {
    findButton(renderer.root, '列头-投递日期').props.onClick();
  });
  await act(async () => {
    findButton(renderer.root, '列头-投递日期').props.onClick();
  });

  assert.deepEqual(getRowCompanies(renderer.root), ['腾讯', '腾讯', '字节跳动']);
  assert.deepEqual(getRowAppliedDates(renderer.root), ['2026-08-07', '2026-08-06', '2026-08-09']);
});

test('顶部独立筛选框已移除', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
  });

  assert.throws(() => findInputByAriaLabel(renderer.root, '公司名'));
  assert.throws(() => findInputByAriaLabel(renderer.root, '岗位名'));
  assert.throws(() => findInputByAriaLabel(renderer.root, '状态'));
});

test('点击公司列标题即可排序，不依赖单独图标按钮', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
  });

  await act(async () => {
    findButton(renderer.root, '列头-公司').props.onClick();
  });

  assert.deepEqual(getRowCompanies(renderer.root), ['腾讯', '字节跳动']);
});

test('点击筛选按钮后出现统一筛选面板并可筛选结果', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
  });

  await act(async () => {
    findButton(renderer.root, '筛选').props.onClick();
  });

  const filterInput = findInputByAriaLabel(renderer.root, '筛选-公司');
  await act(async () => {
    filterInput.props.onChange({ target: { value: '腾讯' } });
  });

  assert.deepEqual(getRowCompanies(renderer.root), ['腾讯']);
});

test('浏览态下链接列渲染为可点击链接文本', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
  });

  const anchors = renderer.root.findAll(node => node.type === 'a');
  assert.ok(anchors.some(node => node.props.href === 'https://jobs.bytedance.com/example-1'));
});

test('点击编辑后当前行直接进入编辑态', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
  });

  await act(async () => {
    findButton(renderer.root, '编辑').props.onClick();
  });

  assert.ok(findButton(renderer.root, '保存'));
  assert.ok(findButton(renderer.root, '取消'));
});

test('编辑态下链接列为普通文本输入框', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
  });

  await act(async () => {
    findButton(renderer.root, '编辑').props.onClick();
  });

  const urlInput = renderer.root.findAll(node => node.type === 'input' && node.props.value === 'https://jobs.bytedance.com/example-1')[0];
  assert.ok(urlInput);
});

test('UPDATE_APPLICATION_RECORD 发送失败时展示失败提示', async () => {
  const sentMessages: Message[] = [];

  await withMockedSendMessage(async message => {
    sentMessages.push(message);
    if (message.type === 'UPDATE_APPLICATION_RECORD') {
      return { success: false, error: '更新失败' };
    }
    return { success: true, data: null };
  }, async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
    });

    await act(async () => {
      findButton(renderer.root, '编辑').props.onClick();
    });

    await act(async () => {
      findButton(renderer.root, '保存').props.onClick();
    });

    assert.equal(sentMessages.at(-1)?.type, 'UPDATE_APPLICATION_RECORD');
    assert.match(getAlertTexts(renderer.root).join('\n'), /更新失败/);
  });
});

test('编辑态下修改工作地点并保存会带上更新值', async () => {
  const sentMessages: Message[] = [];

  await withMockedSendMessage(async message => {
    sentMessages.push(message);
    return { success: true, data: null };
  }, async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
    });

    await act(async () => {
      findButton(renderer.root, '编辑').props.onClick();
    });

    const locationInput = renderer.root.findAll(
      node => node.type === 'input' && node.props.value === '北京',
    )[0];

    await act(async () => {
      locationInput.props.onChange({ target: { value: '上海' } });
    });

    await act(async () => {
      findButton(renderer.root, '保存').props.onClick();
    });

    assert.equal(sentMessages.at(-1)?.type, 'UPDATE_APPLICATION_RECORD');
    assert.equal(
      (sentMessages.at(-1) as Extract<Message, { type: 'UPDATE_APPLICATION_RECORD' }>).payload.location,
      '上海',
    );
  });
});

test('DELETE_APPLICATION_RECORD 发送失败时展示失败提示', async () => {
  const sentMessages: Message[] = [];

  await withMockedSendMessage(async message => {
    sentMessages.push(message);
    if (message.type === 'DELETE_APPLICATION_RECORD') {
      return { success: false, error: '删除失败' };
    }
    return { success: true, data: null };
  }, async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
    });

    await act(async () => {
      findButton(renderer.root, '删除').props.onClick();
    });

    assert.equal(sentMessages.at(-1)?.type, 'DELETE_APPLICATION_RECORD');
    assert.match(getAlertTexts(renderer.root).join('\n'), /删除失败/);
  });
});

test('EXPORT_APPLICATION_RECORDS_CSV 发送失败时展示失败提示', async () => {
  const sentMessages: Message[] = [];

  await withMockedSendMessage(async message => {
    sentMessages.push(message);
    if (message.type === 'EXPORT_APPLICATION_RECORDS_CSV') {
      return { success: false, error: '导出失败' };
    }
    return { success: true, data: null };
  }, async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
    });

    await act(async () => {
      findButton(renderer.root, '导出 CSV').props.onClick();
    });

    assert.equal(sentMessages.at(-1)?.type, 'EXPORT_APPLICATION_RECORDS_CSV');
    assert.match(getAlertTexts(renderer.root).join('\n'), /导出失败/);
  });
});

test('IMPORT_APPLICATION_RECORDS_CSV 发送失败时展示失败提示', async () => {
  const sentMessages: Message[] = [];
  const file = {
    async text() {
      return 'companyName\n字节跳动';
    },
  };

  await withMockedSendMessage(async message => {
    sentMessages.push(message);
    if (message.type === 'IMPORT_APPLICATION_RECORDS_CSV') {
      return { success: false, error: '导入失败' };
    }
    return { success: true, data: null };
  }, async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ApplicationRecordsSection initialRecords={records} />);
    });

    const fileInput = renderer.root.findAll(node => node.type === 'input' && node.props.type === 'file')[0];
    const target = { files: [file], value: 'records.csv' };

    await act(async () => {
      await fileInput.props.onChange({ target });
    });

    assert.equal(sentMessages.at(-1)?.type, 'IMPORT_APPLICATION_RECORDS_CSV');
    assert.equal((sentMessages.at(-1) as Extract<Message, { type: 'IMPORT_APPLICATION_RECORDS_CSV' }>).payload.csv, 'companyName\n字节跳动');
    assert.equal(target.value, '');
    assert.match(getAlertTexts(renderer.root).join('\n'), /导入失败/);
  });
});
