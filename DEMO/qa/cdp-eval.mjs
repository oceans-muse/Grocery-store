const [expression = '1+1', out = ''] = process.argv.slice(2);
const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const target = targets.find((item) => item.type === 'page' && item.url.includes('127.0.0.1:4310'));
if (!target) throw new Error('No page target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const slot = pending.get(message.id);
  if (!slot) return;
  pending.delete(message.id);
  if (message.error) slot.reject(new Error(message.error.message));
  else slot.resolve(message.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
await send('Runtime.enable');
const result = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
});
console.log(JSON.stringify(result.result?.value ?? result.result, null, 2));
if (out) {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await (await import('node:fs/promises')).writeFile(out, Buffer.from(shot.data, 'base64'));
  console.log('screenshot', out);
}
ws.close();
