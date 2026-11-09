import type { Page } from '@playwright/test';

/**
 * Every network attempt the app makes is classified here. Nothing is ever forwarded to a real host:
 * localhost is the app under test, everything else is served from local files, answered by the fake
 * server in harness.ts, or BLOCKED (aborted). The test fails if anything was BLOCKED.
 */
export type Handling = 'localhost (app under test)' | 'served locally' | 'fake server (answered in harness.ts)' | 'BLOCKED (aborted)';

export interface NetEntry { handling: Handling; count: number; samples: string[] }

export class Ledger {
  readonly entries = new Map<string, NetEntry>();
  note(host: string, handling: Handling, sample: string) {
    const key = `${host}|${handling}`;
    const entry = this.entries.get(key) ?? { handling, count: 0, samples: [] };
    entry.count += 1;
    if (entry.samples.length < 3 && !entry.samples.includes(sample)) entry.samples.push(sample);
    this.entries.set(key, entry);
  }
  get blocked(): string[] {
    return [...this.entries].filter(([, e]) => e.handling.startsWith('BLOCKED')).map(([key, e]) => `${key.split('|')[0]} ${e.samples.join(', ')}`);
  }
}

const ledgers = new WeakMap<Page, Ledger>();
export const attachLedger = (page: Page): Ledger => { const ledger = new Ledger(); ledgers.set(page, ledger); return ledger; };
export const ledgerFor = (page: Page): Ledger => ledgers.get(page) ?? attachLedger(page);
