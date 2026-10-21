import fs from 'node:fs/promises';

const [url = 'http://127.0.0.1:4310/?splash=0&theme=dark', out = 'qa/shot.png', selector = ''] = process.argv.slice(2);
const width = Number(process.env.QA_WIDTH || 1440);
const height = Number(process.env.QA_HEIGHT || 1200);
const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const target = targets.find((item) => item.type === 'page' && item.url.includes('127.0.0.1:4310'));
if (!target) throw new Error('No 4310 page target. Open the site in the debug browser first.');

const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const events = new Map();
let nextId = 1;

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

const on = (method, handler) => {
  if (!events.has(method)) events.set(method, []);
  events.get(method).push(handler);
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const slot = pending.get(message.id);
    if (!slot) return;
    pending.delete(message.id);
    if (message.error) slot.reject(new Error(message.error.message));
    else slot.resolve(message.result);
    return;
  }
  for (const handler of events.get(message.method) || []) handler(message.params);
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

const exceptions = [];
const consoleErrors = [];
on('Runtime.exceptionThrown', (params) => exceptions.push(params.exceptionDetails?.text || 'exception'));
on('Runtime.consoleAPICalled', (params) => {
  if (params.type === 'error') consoleErrors.push(params.args.map((arg) => arg.value || arg.description).join(' '));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: false,
});

await send('Page.navigate', { url });
await new Promise((resolve) => {
  const timer = setTimeout(resolve, 5000);
  on('Page.loadEventFired', () => { clearTimeout(timer); resolve(); });
});
await new Promise((resolve) => setTimeout(resolve, 2200));

if (process.env.QA_LOGIN === '1') {
  const loginResult = await send('Runtime.evaluate', {
    expression: `(async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'liquid-glass-2026' }) }); return r.status; })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('login status', loginResult.result.value);
  await send('Page.reload', { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 3200));
}

if (selector) {
  const scrolled = await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return -1; const y = el.getBoundingClientRect().top + window.scrollY; window.scrollTo({ top: y, behavior: 'instant' }); return Math.round(y); })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('scroll target', scrolled.result.value);
  await new Promise((resolve) => setTimeout(resolve, 1400));
}

if (process.env.QA_ACTION) {
  const action = await send('Runtime.evaluate', {
    expression: process.env.QA_ACTION,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  console.log('action', action.result.value);
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.QA_ACTION_WAIT || 1000)));
}

const metrics = await send('Runtime.evaluate', {
  expression: `JSON.stringify({scrollY:Math.round(scrollY),innerHeight,docHeight:document.documentElement.scrollHeight,headerTop:document.querySelector('.site-header')?.getBoundingClientRect().top,title:document.title,theme:document.documentElement.dataset.theme,ready:document.documentElement.className,posts:document.querySelectorAll('.post-card').length})`,
  returnByValue: true,
});
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
await fs.writeFile(out, Buffer.from(shot.data, 'base64'));
console.log(metrics.result.value);
console.log(JSON.stringify({ out, exceptions, consoleErrors }, null, 2));
ws.close();
