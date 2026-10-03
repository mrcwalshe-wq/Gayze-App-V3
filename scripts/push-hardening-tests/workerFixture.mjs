import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { MessageChannel } from 'node:worker_threads';
export const noticeId = '10000000-0000-4000-8000-000000000001';
export const roomId = '20000000-0000-4000-8000-000000000001';
export const recipientId = '30000000-0000-4000-8000-000000000001';
export const payload = { type: 'message', notificationId: noticeId, conversationId: roomId, recipientId,
  messageId: '40000000-0000-4000-8000-000000000001', url: `/messages/${roomId}?notification=${noticeId}&recipient=${recipientId}` };
export function worker({ receipts = new Map(), notifications = new Map(), clients = [] } = {}) {
  const events = {}, displays = [], opens = [], writes = [];
  let failDisplay = false, failStorage = false, failClients = false;
  const self = { location: new URL('https://gayze.co.uk/service-worker.js'), navigator: {},
    addEventListener(type, fn) { events[type] = fn; },
    registration: {
      async showNotification(title, options) {
        if (failDisplay) throw new Error('display unavailable');
        displays.push({ title, options }); notifications.set(options.tag, { title, options });
      },
      async getNotifications({ tag }) { return [...notifications.values()].filter(n => n.options.tag === tag); },
    },
    clients: { async matchAll() { if (failClients) throw new Error('client unavailable'); return clients; },
      async openWindow(url) { opens.push(url); return { url }; } },
  };
  const cache = { async match(key) { return receipts.get(key); }, async put(key, value) { writes.push(key); receipts.set(key, value); },
    async keys() { return [...receipts.keys()]; }, async delete(key) { return receipts.delete(key); } };
  vm.runInNewContext(readFileSync('public/service-worker.js', 'utf8'), { self,
    caches: { async open() { if (failStorage) throw new Error('storage unavailable'); return cache; } },
    URL, URLSearchParams, Request, Response, MessageChannel, setTimeout, clearTimeout, console });
  return { displays, opens, writes, receipts, notifications, events,
    set failDisplay(value) { failDisplay = value; }, set failStorage(value) { failStorage = value; }, set failClients(value) { failClients = value; },
    async fire(type, data) { let work; events[type]({ waitUntil(value) { work = value; }, ...data }); await work; },
    async push(data = payload) { return this.fire('push', { data: { json: () => data } }); },
    async click(data = payload) { return this.fire('notificationclick', { notification: { data, close() {} } }); },
  };
}
export function appClient({ focused = true, acknowledge = true, failFocus = false, navigate = true } = {}) {
  const messages = [], navigations = []; let focuses = 0;
  const client = { url: 'https://gayze.co.uk/profile', focused, visibilityState: focused ? 'visible' : 'hidden',
    async focus() { focuses++; if (failFocus) throw new Error('window gone'); return client; },
    postMessage(message, ports) { messages.push(message); if (ports?.[0]) {
      if (acknowledge) ports[0].postMessage({ handled: true }); ports[0].close();
    } },
    navigate: navigate ? async url => { navigations.push(url); return client; } : undefined,
  };
  return { client, messages, navigations, get focuses() { return focuses; } };
}
