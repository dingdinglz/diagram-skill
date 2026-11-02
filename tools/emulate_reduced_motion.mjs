// Test-only CDP bridge: agent-browser's `set media` does not apply this feature
// in the installed native CLI. Keep this session attached: closing it clears
// Chrome's emulation. All interaction still runs through agent-browser.
import { createInterface } from 'node:readline';

const timeout = setTimeout(() => {
  console.error('Reduced-motion CDP session timed out');
  process.exit(1);
}, 30000);
const socket = new WebSocket(process.argv[2]);
const pending = new Map();
let nextId = 0;
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  if (message.error) callback.reject(new Error(message.error.message));
  else callback.resolve(message.result);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, sessionId }));
});
try {
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const { targetInfos } = await send('Target.getTargets');
  // The CLI can retain its initial blank tab. Bind to this case's actual URL,
  // not whichever page happens to be first in Chrome's target list.
  const pages = targetInfos.filter(target => target.type === 'page' && target.url === process.argv[3]);
  if (pages.length !== 1) throw new Error('Expected one matching workspace page in the test browser');
  const { sessionId } = await send('Target.attachToTarget', { targetId: pages[0].targetId, flatten: true });
  console.log('ready');
  for await (const preference of createInterface({ input: process.stdin })) {
    if (!['reduce', 'no-preference'].includes(preference)) throw new Error('Invalid preference');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: preference }] }, sessionId);
    console.log('ok');
  }
} finally {
  clearTimeout(timeout);
  socket.close();
}
