// Local stand-in for Supabase Realtime broadcast (test only). Mirrors the behaviour the
// client relies on: per-topic fan-out excluding the sender, subscription acknowledgement,
// and an acknowledgement for each broadcast. It is NOT Supabase and does not enforce RLS.
import { WebSocketServer } from 'ws';

export function startRelay({ port = 0, host = '127.0.0.1' } = {}) {
  const topics = new Map(); // topic -> Set<ws>
  const wss = new WebSocketServer({ port, host });
  wss.on('connection', (ws) => {
    ws.topics = new Set();
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.t === 'sub') {
        if (!topics.has(msg.topic)) topics.set(msg.topic, new Set());
        topics.get(msg.topic).add(ws); ws.topics.add(msg.topic);
        ws.send(JSON.stringify({ t: 'subscribed', topic: msg.topic }));
      } else if (msg.t === 'unsub') {
        topics.get(msg.topic)?.delete(ws); ws.topics.delete(msg.topic);
      } else if (msg.t === 'bc') {
        for (const peer of topics.get(msg.topic) ?? []) {
          if (peer !== ws && peer.readyState === peer.OPEN) {
            peer.send(JSON.stringify({ t: 'bc', topic: msg.topic, event: msg.event, payload: msg.payload }));
          }
        }
        ws.send(JSON.stringify({ t: 'ack', id: msg.id }));
      }
    });
    ws.on('close', () => { for (const topic of ws.topics) topics.get(topic)?.delete(ws); });
  });
  return {
    get port() { return wss.address().port; },
    subscribers(topic) { return topics.get(topic)?.size ?? 0; },
    close: () => new Promise((resolve) => wss.close(resolve)),
  };
}
