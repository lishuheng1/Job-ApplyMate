import assert from 'node:assert/strict';
import test from 'node:test';
import { extractApplicationPageMetadata } from './applicationRecordMetadata.ts';

test('页面元数据提取返回 sourceSite/sourceUrl，并尽量提取公司名', () => {
  const doc = {
    title: '字节跳动校园招聘',
    querySelector: (selector: string) => {
      if (selector === 'meta[property="og:site_name"]') {
        return {
          getAttribute: (attribute: string) => (attribute === 'content' ? '字节跳动招聘' : null),
        };
      }
      return null;
    },
  } as unknown as Document;

  const result = extractApplicationPageMetadata(doc, 'https://jobs.bytedance.com/campus');

  assert.equal(result.sourceSite, 'jobs.bytedance.com');
  assert.equal(result.sourceUrl, 'https://jobs.bytedance.com/campus');
  assert.match(result.companyName, /字节/);
  assert.equal(result.pageTitle, '字节跳动校园招聘');
});

test('优先从 JobPosting 结构化数据提取岗位和地点', () => {
  const script = {
    textContent: JSON.stringify({
      '@type': 'JobPosting',
      title: '高级产品经理',
      jobLocation: { address: { addressLocality: '上海', addressRegion: '上海市' } },
    }),
  };
  const doc = {
    title: '某公司招聘',
    querySelectorAll: (selector: string) => selector.includes('ld+json') ? [script] : [],
    querySelector: () => null,
  } as unknown as Document;

  const result = extractApplicationPageMetadata(doc, 'https://jobs.example.com/123');
  assert.equal(result.jobTitle, '高级产品经理');
  assert.equal(result.location, '上海 · 上海市');
});
