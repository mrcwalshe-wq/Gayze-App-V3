/** Opt-in diagnostics: RAM only; durations/counters, never IDs, text, keys or URLs.
 * In DevTools: window.__GAYZE_CHAT_TRACE_ENABLED__ = true; open a room;
 * inspect window.__GAYZE_CHAT_TRACES__. Disable to stop capture; account cleanup clears it. */
export type ChatStage = 'shell-commit' | 'first-message-commit' | 'first-decrypted-commit' |
  'subscription-requested' | 'realtime-subscribed' | 'first-page' | 'history-complete';
type Trace = { sequence: number; stagesMs: Partial<Record<ChatStage, number>>; pages: number; rows: number; renders: number };
const host = globalThis as typeof globalThis & { __GAYZE_CHAT_TRACE_ENABLED__?: boolean; __GAYZE_CHAT_TRACES__?: Trace[] };
let active: { room: string; start: number; result: Trace } | undefined;
let sequence = 0;
export function beginChatTrace(room: string, onlyIfAbsent = false) {
  if (!host.__GAYZE_CHAT_TRACE_ENABLED__) return;
  if (onlyIfAbsent && active?.room === room) return;
  const result: Trace = { sequence: ++sequence, stagesMs: {}, pages: 0, rows: 0, renders: 0 };
  active = { room, start: performance.now(), result };
  host.__GAYZE_CHAT_TRACES__ = [...(host.__GAYZE_CHAT_TRACES__ ?? []).slice(-15), result];
}
export function traceChat(room: string, stage: ChatStage) {
  if (!host.__GAYZE_CHAT_TRACE_ENABLED__ || active?.room !== room) return;
  active.result.stagesMs[stage] ??= Number((performance.now() - active.start).toFixed(2));
}
export function countChatWork(room: string, work: 'pages' | 'rows' | 'renders', count = 1) {
  if (host.__GAYZE_CHAT_TRACE_ENABLED__ && active?.room === room) active.result[work] += count;
}
export function clearChatTrace() { active = undefined; delete host.__GAYZE_CHAT_TRACES__; }
