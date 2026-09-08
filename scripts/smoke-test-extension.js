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

const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (request.url === '/frame') {
    response.end('<!doctype html><html><body><label for="city">现居地</label><input id="city" name="currentAddress"></body></html>');
    return;
  }
  response.end(`<!doctype html><html><head><title>Job ApplyMate smoke</title><style>button,input,select,strong,span{font-size:42px!important;line-height:3!important}</style></head><body>
    <form><label for="name">姓名</label><input id="name" name="name" required>
    <label for="email">邮箱</label><input id="email" name="email" type="email" required>
    <label id="degree-label" for="degree">学历</label>
    <div class="ant-select ant-select-show-search"><input id="degree" name="degree" role="combobox" aria-labelledby="degree-label" aria-controls="degree-list" aria-expanded="false" aria-autocomplete="list" required></div>
    <div id="degree-list" role="listbox" style="display:none;position:absolute;background:white"></div>
    <label for="resume">上传简历</label><input id="resume" name="resume" type="file" accept=".pdf">
    <label for="intro">请介绍你自己</label><textarea id="intro" name="intro"></textarea>
    <div class="form-item"><label id="custom-label">自定义必答题</label>
      <input id="custom-primary" aria-labelledby="custom-label" aria-required="true">
      <input id="custom-helper" placeholder="请输入" aria-required="true"></div>
    <iframe id="application-frame" src="/frame"></iframe>
    <div class="form-item"><input id="generic-required-helper" placeholder="请输入" aria-required="true"></div></form>
    <script>
      const degreeInput = document.querySelector('#degree');
      const degreeList = document.querySelector('#degree-list');
      degreeInput.addEventListener('click', () => {
        degreeInput.setAttribute('aria-expanded', 'true');
        degreeList.style.display = 'block';
        setTimeout(() => {
          degreeList.innerHTML = ['非全日制', '专科', '大学本科', '硕士'].map(value =>
            '<div role="option" style="height:24px;width:120px" data-value="' + value + '">' + value + '</div>'
          ).join('');
          degreeList.querySelectorAll('[role="option"]').forEach(option => option.addEventListener('click', () => {
            degreeInput.value = option.dataset.value;
            option.setAttribute('aria-selected', 'true');
            degreeInput.setAttribute('aria-expanded', 'false');
            degreeList.style.display = 'none';
          }));
        }, 120);
      });
    </script>
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
  return sendCdpCommand(webSocketUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
}

async function sendCdpCommand(webSocketUrl, method, params) {
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
      method,
      params,
    }));
  });
  socket.close();
  return method === 'Runtime.evaluate' ? result : true;
}

async function captureRuntimeDiagnostics(webSocketUrl) {
  const messages = [];
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.consoleAPICalled') {
      messages.push(message.params.args.map(arg => arg.value || arg.description || '').join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      messages.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'exception');
    }
    if (message.method === 'Page.javascriptDialogOpening') {
      messages.push(`dialog: ${message.params.message}`);
      socket.send(JSON.stringify({ id: 93, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
  });
  socket.send(JSON.stringify({ id: 91, method: 'Runtime.enable', params: {} }));
  socket.send(JSON.stringify({ id: 92, method: 'Page.enable', params: {} }));
  return { messages, close: () => socket.close() };
}

try {
  const webSocketUrl = await waitForPageTarget();
  const runtimeDiagnostics = await captureRuntimeDiagnostics(webSocketUrl);
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
  const detection = await evaluate(serviceWorker.webSocketDebuggerUrl, `(async () => {
    const tabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    if (!tabs[0]?.id) return { success: false, error: '测试页标签不存在' };
    let response;
    for (const delay of [0, 150, 300, 500]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      response = await chrome.tabs.sendMessage(tabs[0].id, { type: 'DETECT_FIELDS' }, { frameId: 0 });
      if (Number(response?.data?.count || 0) >= 2) break;
    }
    return response || { success: false, error: '无响应' };
  })()`);
  if (!detection?.success || Number(detection.data?.count || 0) < 2) {
    throw new Error(`真实浏览器字段检测失败：${JSON.stringify(detection)}`);
  }
  const quickFill = await evaluate(serviceWorker.webSocketDebuggerUrl, `(async () => {
    await chrome.storage.local.set({ userProfile: {
      personal: { name: '测试用户', gender: '', birthDate: '', phone: '', email: 'smoke@example.com', currentAddress: '上海市' },
      education: [{ school: '', college: '', major: '', degree: '本科', educationType: '', startDate: '', endDate: '', gpa: '' }], experience: [], projects: [], customInformation: [], skills: [], certifications: [],
      resume: { fileName: '产品经理原名.pdf', fileData: 'data:application/pdf;base64,JVBERi0xLjQ=', fileType: 'pdf', uploadDate: '2026-09-07T00:00:00.000Z' },
      resumes: [
        { id: 'resume-product', category: '产品岗', fileName: '产品经理原名.pdf', fileData: 'data:application/pdf;base64,JVBERi0xLjQ=', fileType: 'pdf', uploadDate: '2026-09-07T00:00:00.000Z', parsedProfile: {
          personal: { name: '产品版用户', email: 'product@example.com', currentAddress: '北京市' },
          education: [{ id: 'product-edu', school: '', college: '', major: '', degree: '本科', educationType: '', startDate: '', endDate: '', gpa: '' }], experience: [], projects: [], skills: []
        } },
        { id: 'resume-operations', category: '运营岗', fileName: '运营岗位定制版.pdf', fileData: 'data:application/pdf;base64,JVBERi0xLjQ=', fileType: 'pdf', uploadDate: '2026-09-07T00:00:00.000Z', parsedProfile: {
          personal: { name: '运营版用户', email: 'operations@example.com', currentAddress: '深圳市' },
          education: [{ id: 'operations-edu', school: '', college: '', major: '', degree: '本科', educationType: '', startDate: '', endDate: '', gpa: '' }], experience: [], projects: [], skills: []
        } }
      ]
    } });
    const tabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    if (!tabs[0]?.id) return { success: false, error: '测试页标签不存在' };
    const preview = await chrome.tabs.sendMessage(tabs[0].id, { type: 'PREVIEW_FILL', payload: { resumeId: 'resume-operations' } }, { frameId: 0 });
    const startedAt = performance.now();
    const fill = await chrome.tabs.sendMessage(tabs[0].id, {
      type: 'FILL_FORM',
      payload: { reusePreview: true, resumeId: 'resume-operations' }
    }, { frameId: 0 });
    return {
      success: Boolean(preview?.success && fill?.success),
      previewCount: preview?.data?.items?.length || 0,
      previewItems: preview?.data?.items || [],
      durationMs: Math.round(performance.now() - startedAt),
      error: preview?.error || fill?.error
    };
  })()`);
  if (!quickFill?.success || Number(quickFill.previewCount || 0) < 2) {
    throw new Error(`真实浏览器快速填充失败：${JSON.stringify(quickFill)}`);
  }
  const filledValues = await evaluate(webSocketUrl, `({
    name: document.querySelector('#name')?.value,
    email: document.querySelector('#email')?.value,
    degree: document.querySelector('#degree')?.value,
    degreeExpanded: document.querySelector('#degree')?.getAttribute('aria-expanded'),
    degreeOptions: Array.from(document.querySelectorAll('#degree-list [role="option"]')).map(option => ({ text: option.textContent, selected: option.getAttribute('aria-selected') })),
    degreeListDisplay: getComputedStyle(document.querySelector('#degree-list')).display,
    resumeName: document.querySelector('#resume')?.files?.[0]?.name || '',
    failureLabels: Array.from(document.querySelectorAll('[data-failure-review-label="true"]')).map(item => item.textContent)
  })`);
  if (filledValues?.name !== '运营版用户' || filledValues?.email !== 'operations@example.com' || filledValues?.degree !== '大学本科' || filledValues?.resumeName !== '运营岗位定制版.pdf') {
    runtimeDiagnostics.close();
    throw new Error(`真实浏览器写入结果错误：${JSON.stringify({ quickFill, filledValues, runtimeMessages: runtimeDiagnostics.messages })}`);
  }
  await evaluate(webSocketUrl, `(() => {
    document.querySelector('#name').value = '';
    document.querySelector('#email').value = '';
    document.querySelector('#resume').value = '';
  })()`);
  const skipResumeFill = await evaluate(serviceWorker.webSocketDebuggerUrl, `(async () => {
    const tabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    return chrome.tabs.sendMessage(tabs[0].id, { type: 'FILL_FORM', payload: { resumeId: null } }, { frameId: 0 });
  })()`);
  const skippedResumeName = await evaluate(webSocketUrl, `document.querySelector('#resume')?.files?.[0]?.name || ''`);
  if (!skipResumeFill?.success || skippedResumeName) {
    throw new Error(`选择不上传简历时仍写入了文件：${JSON.stringify({ skipResumeFill, skippedResumeName })}`);
  }
  await evaluate(webSocketUrl, `(() => {
    document.querySelector('#name').value = '';
    document.querySelector('#email').value = '';
    document.querySelector('#degree').value = '';
    document.querySelector('#degree').setAttribute('aria-expanded', 'false');
    document.querySelector('#degree-list').innerHTML = '';
    document.querySelector('#degree-list').style.display = 'none';
  })()`);
  const progressiveAI = await evaluate(serviceWorker.webSocketDebuggerUrl, `(async () => {
    const tabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    return chrome.tabs.sendMessage(tabs[0].id, {
      type: 'START_AI_PAGE_FILL',
      payload: { resumeId: null }
    }, { frameId: 0 });
  })()`);
  const valuesKeptAfterAIStopped = await evaluate(webSocketUrl, `(async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const values = {
        name: document.querySelector('#name')?.value,
        email: document.querySelector('#email')?.value,
        degree: document.querySelector('#degree')?.value
      };
      if (values.name && values.email && values.degree) return values;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return {
      name: document.querySelector('#name')?.value,
      email: document.querySelector('#email')?.value,
      degree: document.querySelector('#degree')?.value
    };
  })()`);
  if (!progressiveAI?.success
    || valuesKeptAfterAIStopped?.name !== '测试用户'
    || valuesKeptAfterAIStopped?.email !== 'smoke@example.com'
    || valuesKeptAfterAIStopped?.degree !== '大学本科') {
    throw new Error(`AI 中止时未保留已完成结果：${JSON.stringify({ progressiveAI, valuesKeptAfterAIStopped })}`);
  }
  const overlayOpen = await evaluate(serviceWorker.webSocketDebuggerUrl, `(async () => {
    const tabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    if (!tabs[0]?.id) return { success: false, error: '测试页标签不存在' };
    return chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_INFO_OVERLAY', payload: { resumeId: 'resume-product' } });
  })()`);
  if (!overlayOpen?.success) {
    throw new Error(`网页内信息浮窗打开失败：${JSON.stringify(overlayOpen)}`);
  }
  const overlayState = await evaluate(webSocketUrl, `(() => {
    const host = document.querySelector('#job-applymate-info-overlay-host');
    const button = host?.shadowRoot?.querySelector('[data-profile-key="personal-name"]');
    const name = document.querySelector('#name');
    name.value = '';
    name.focus();
    button?.click();
    return {
      exists: Boolean(host && button),
      position: host ? getComputedStyle(host).position : '',
      zIndex: host ? getComputedStyle(host).zIndex : ''
    };
  })()`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const overlayFilledName = await evaluate(webSocketUrl, `document.querySelector('#name')?.value`);
  const overlayFeedback = await evaluate(webSocketUrl, `(() => {
    const host = document.querySelector('#job-applymate-info-overlay-host');
    return {
      status: host?.shadowRoot?.querySelector('[data-overlay-status]')?.textContent || '',
      activeElement: document.activeElement?.id || document.activeElement?.tagName || ''
    };
  })()`);
  if (!overlayState?.exists || overlayState.position !== 'fixed' || overlayState.zIndex !== '2147483647' || overlayFilledName !== '产品版用户') {
    throw new Error(`网页内信息浮窗置顶或点击写入失败：${JSON.stringify({ overlayState, overlayFilledName, overlayFeedback })}`);
  }
  await evaluate(webSocketUrl, `(() => {
    const frameInput = document.querySelector('#application-frame')?.contentDocument?.querySelector('#city');
    const button = document.querySelector('#job-applymate-info-overlay-host')?.shadowRoot?.querySelector('[data-profile-key="personal-currentAddress"]');
    frameInput?.focus();
    button?.click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const iframeFilledCity = await evaluate(webSocketUrl, `document.querySelector('#application-frame')?.contentDocument?.querySelector('#city')?.value`);
  if (iframeFilledCity !== '北京市') {
    throw new Error(`信息浮窗未能写入子框架字段：${JSON.stringify(iframeFilledCity)}`);
  }
  const switchedOverlay = await evaluate(serviceWorker.webSocketDebuggerUrl, `(async () => {
    const tabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    return chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_INFO_OVERLAY_RESUME', payload: { resumeId: 'resume-operations' } });
  })()`);
  const switchedOverlayState = await evaluate(webSocketUrl, `(() => {
    const shadow = document.querySelector('#job-applymate-info-overlay-host')?.shadowRoot;
    return {
      label: shadow?.querySelector('[data-resume-label]')?.textContent || '',
      name: shadow?.querySelector('[data-profile-key="personal-name"] .field-value')?.textContent || ''
    };
  })()`);
  if (!switchedOverlay?.success || switchedOverlayState?.name !== '运营版用户' || !switchedOverlayState?.label.includes('运营岗')) {
    throw new Error(`信息浮窗未随简历选择切换：${JSON.stringify({ switchedOverlay, switchedOverlayState })}`);
  }
  const overlayRestored = await evaluate(webSocketUrl, `(async () => {
    const host = document.querySelector('#job-applymate-info-overlay-host');
    host?.remove();
    await new Promise(resolve => setTimeout(resolve, 0));
    return Boolean(host?.isConnected);
  })()`);
  if (!overlayRestored) throw new Error('信息浮窗被页面移除后未自动恢复');
  const duplicateInjection = await evaluate(serviceWorker.webSocketDebuggerUrl, `(async () => {
    const tabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
    if (!tabs[0]?.id) return { success: false, error: '测试页标签不存在' };
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id, frameIds: [0] }, files: ['content.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id, frameIds: [0] }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_INFO_OVERLAY' });
  })()`);
  if (!duplicateInjection?.success) throw new Error(`重复注入场景打开浮窗失败：${JSON.stringify(duplicateInjection)}`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const singleCloseState = await evaluate(webSocketUrl, `(async () => {
    const hosts = Array.from(document.querySelectorAll('[data-job-applymate-overlay="true"]'));
    hosts[0]?.shadowRoot?.querySelector('[data-close]')?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    return {
      hostCount: hosts.length,
      visibleCount: Array.from(document.querySelectorAll('[data-job-applymate-overlay="true"]'))
        .filter(host => getComputedStyle(host).display !== 'none').length
    };
  })()`);
  if (singleCloseState?.hostCount !== 1 || singleCloseState.visibleCount !== 0) {
    throw new Error(`悬浮窗重复实例未被正确清理：${JSON.stringify(singleCloseState)}`);
  }
  const review = await evaluate(webSocketUrl, `(() => {
    const shadow = document.querySelector('#job-applymate-failure-review')?.shadowRoot;
    const input = shadow?.querySelector('input,select');
    return {
      count: shadow?.querySelectorAll('[data-failure-review-item="true"]').length || 0,
      labels: Array.from(shadow?.querySelectorAll('[data-failure-review-label="true"]') || []).map(item => item.textContent),
      title: shadow?.querySelector('strong')?.textContent || '',
      inputFontSize: input ? getComputedStyle(input).fontSize : ''
    };
  })()`);
  if (review?.count !== 1 || review.labels?.[0] !== '自定义必答题' || !review.title.startsWith('1 项') || review.inputFontSize !== '13px') {
    throw new Error(`失败复盘过滤或去重错误：${JSON.stringify(review)}`);
  }
  console.log('✓ content.js 在真实浏览器表单页中成功初始化');
  console.log(`✓ 真实浏览器识别到 ${detection.data.count} 个可填字段`);
  console.log(`✓ 真实浏览器快速填充成功（${quickFill.durationMs}ms）`);
  console.log('✓ 动态下拉框会等待选项加载，并把“本科”安全匹配为“大学本科”');
  console.log('✓ AI 服务不可用时仍会保留停止前已经完成的本地填写结果');
  console.log('✓ 可按分类选择指定简历上传，也可明确选择本次不上传');
  console.log('✓ 网页内信息浮窗固定在最高层级，可写入主页面和子框架字段，被移除后会自动恢复');
  console.log('✓ content.js 即使重复注入，悬浮窗也只有一个实例且关闭一次即可隐藏');
  console.log('✓ 切换简历会同步切换悬浮窗和自动填写资料');
  console.log('✓ 失败复盘窗口不会继承招聘网站的大字号样式');
  console.log('✓ 失败复盘会过滤辅助输入框，并把同一逻辑字段去重为 1 项');
  runtimeDiagnostics.close();
} finally {
  if (process.platform === 'win32' && browser.pid) {
    await new Promise(resolve => {
      const cleanup = spawn('taskkill', ['/pid', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
      cleanup.once('exit', resolve);
      cleanup.once('error', resolve);
    });
  } else {
    browser.kill();
  }
  await new Promise(resolve => setTimeout(resolve, 2500));
  server.close();
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.warn(`测试浏览器临时目录稍后由系统清理：${error instanceof Error ? error.message : String(error)}`);
  }
}
