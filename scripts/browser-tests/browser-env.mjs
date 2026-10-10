// Resolves a Chromium executable and library path for Playwright-core.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const tools = process.env.GAYZE_BROWSER_TOOLS || path.join(os.homedir(), '.tools', 'browser');
const require = createRequire(path.join(tools, 'package.json'));

export async function resolveBrowser() {
  const libs = path.join(tools, 'libs', 'lib');
  if (fs.existsSync(libs)) process.env.LD_LIBRARY_PATH = `${libs}:${process.env.LD_LIBRARY_PATH || ''}`;
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH, args: [] };
  const loaded = require('@sparticuz/chromium');
  const sparticuz = loaded.default ?? loaded;
  return { executablePath: await sparticuz.executablePath(), args: sparticuz.args };
}

export function playwright() {
  return require('playwright-core');
}
