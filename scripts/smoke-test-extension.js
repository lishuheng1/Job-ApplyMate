import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const extensionDir = join(projectRoot, 'dist');
const chromeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = chromeCandidates.find(existsSync);
if (!browserPath) throw new Error('未找到可用于冒烟测试的 Chrome 或 Edge');

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><head><title>Job ApplyMate smoke</title></head><body>
    <form><label for="name">姓名</label><input id="name" name="name" required>
    <label for="email">邮箱</label><input id="email" name="email" type="email" required>
    <label for="intro">请介绍你自己</label><textarea id="intro" name="intro"></textarea>
    <div class="form-item"><label id="custom-label">自定义必答题</label>
      <input id="custom-primary" aria-labelledby="custom-label" aria-required="true">
      <input id="custom-helper" placeholder="请输入" aria-required="true"></div>
    <div class="form-item"><input id="generic-required-helper" placeholder="请输入" aria-required="true"></div></form>
  </body></html>`);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('测试服务器启动失败');
const pageUrl = `http://127.0.0.1:${address.port}/`;
const debugPort = address.port + 1;
const profileDir = mkdtempSync(join(tmpdir(), 'job-applymate-smoke-'));
const browser = spawn(browserPath, [
  '--disable-gpu',
  '--start-minimized',
  '--window-position=-32000,-32000',
  '--window-size=800,600',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  pageUrl,
], { stdio: ['ignore', 'pipe', 'pipe'] });
let browserDiagnostics = '';
browser.stdout?.on('data', chunk => { browserDiagnostics += chunk.toString(); });
browser.stderr?.on('data', chunk => { browserDiagnostics += chunk.toString(); });

async function waitForPageTarget() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json());
      const target = targets.find(item => item.type === 'page' && item.url === pageUrl);
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('浏览器测试页未能启动');
}

async function evaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('浏览器检查超时')), 5000);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
  socket.close();
  return result;
}

try {
  const webSocketUrl = await waitForPageTarget();
  await new Promise(resolve => setTimeout(resolve, 1800));
  const initialized = await evaluate(
    webSocketUrl,
    `Array.from(document.querySelectorAll('style')).some(style => style.textContent.includes('@keyframes slideIn'))`,
  );
  if (!initialized) {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json());
    console.error('浏览器目标：', targets.map(item => `${item.type}:${item.url}`).join('\n'));
    console.error('浏览器诊断：', browserDiagnostics.slice(-4000));
    throw new Error('content.js 未在真实浏览器页面中完成初始化');
  }
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json());
  const serviceWorker = targets.find(item => item.type === 'service_worker' && /\/background\.js$/.test(item.url));
  if (!serviceWorker?.webSocketDebuggerUrl) throw new Error('未找到 Job ApplyMate 后台脚本');
  const detection = await evaluate(serviceWorker.webSocketDebuggerUrl, `new Promise(resolve => {
    chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} }, tabs => {
      if (!tabs[0]?.id) { resolve({ success: false, error: '测试页标签不存在' }); return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'DETECT_FIELDS' }, response => {
        resolve(response || { success: false, error: chrome.runtime.lastError?.message || '无响应' });
      });
    });
  })`);
  if (!detection?.success || Number(detection.data?.count || 0) < 2) {
    throw new Error(`真实浏览器字段检测失败：${JSON.stringify(detection)}`);
  }
  const quickFill = await evaluate(serviceWorker.webSocketDebuggerUrl, `(async () => {
    await chrome.storage.local.set({ userProfile: {
      personal: { name: '测试用户', gender: '', birthDate: '', phone: '', email: 'smoke@example.com' },
      education: [], experience: [], projects: [], customInformation: [], skills: [], certifications: []
    } });
    const tabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    if (!tabs[0]?.id) return { success: false, error: '测试页标签不存在' };
    const preview = await chrome.tabs.sendMessage(tabs[0].id, { type: 'PREVIEW_FILL' });
    const startedAt = performance.now();
    const fill = await chrome.tabs.sendMessage(tabs[0].id, {
      type: 'FILL_FORM',
      payload: { reusePreview: true }
    });
    return {
      success: Boolean(preview?.success && fill?.success),
      previewCount: preview?.data?.items?.length || 0,
      durationMs: Math.round(performance.now() - startedAt),
      error: preview?.error || fill?.error
    };
  })()`);
  if (!quickFill?.success || Number(quickFill.previewCount || 0) < 2) {
    throw new Error(`真实浏览器快速填充失败：${JSON.stringify(quickFill)}`);
  }
  const filledValues = await evaluate(webSocketUrl, `({
    name: document.querySelector('#name')?.value,
    email: document.querySelector('#email')?.value
  })`);
  if (filledValues?.name !== '测试用户' || filledValues?.email !== 'smoke@example.com') {
    throw new Error(`真实浏览器写入结果错误：${JSON.stringify(filledValues)}`);
  }
  const review = await evaluate(webSocketUrl, `({
    count: document.querySelectorAll('[data-failure-review-item="true"]').length,
    labels: Array.from(document.querySelectorAll('[data-failure-review-label="true"]')).map(item => item.textContent),
    title: document.querySelector('#job-applymate-failure-review strong')?.textContent || ''
  })`);
  if (review?.count !== 1 || review.labels?.[0] !== '自定义必答题' || !review.title.startsWith('1 项')) {
    throw new Error(`失败复盘过滤或去重错误：${JSON.stringify(review)}`);
  }
  console.log('✓ content.js 在真实浏览器表单页中成功初始化');
  console.log(`✓ 真实浏览器识别到 ${detection.data.count} 个可填字段`);
  console.log(`✓ 真实浏览器快速填充成功（${quickFill.durationMs}ms）`);
  console.log('✓ 失败复盘会过滤辅助输入框，并把同一逻辑字段去重为 1 项');
} finally {
  await new Promise(resolve => {
    if (browser.exitCode !== null) {
      resolve();
      return;
    }
    browser.once('exit', resolve);
    browser.kill();
    setTimeout(resolve, 1500);
  });
  server.close();
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
