import { appendFileSync, mkdirSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { attachLedger } from './network';

/** `test` with a network guard: the test fails if the app attempted any request that was not mocked or served locally. */
export const test = base.extend<{ networkGuard: void }>({
  networkGuard: [async ({ page }, use, info) => {
    const ledger = attachLedger(page);
    await use();
    mkdirSync('e2e', { recursive: true });
    for (const [key, entry] of ledger.entries) {
      appendFileSync('e2e/network-report.jsonl', JSON.stringify({ project: info.project.name, test: info.title, host: key.split('|')[0], ...entry }) + '\n');
    }
    expect(ledger.blocked, 'The app tried to reach hosts that are neither mocked nor served locally').toEqual([]);
  }, { auto: true }],
});
export { expect };
