// Provisions a Chromium for the browser tests OUTSIDE the repository (default ~/.tools/browser).
// Uses only the npm registry. Chromium comes from the @sparticuz/chromium npm package, which
// bundles a headless build; its shared libraries are extracted next to it.
// Set GAYZE_BROWSER_TOOLS to override the directory, or CHROME_PATH to use an installed Chrome.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const tools = process.env.GAYZE_BROWSER_TOOLS || path.join(os.homedir(), '.tools', 'browser');
fs.mkdirSync(tools, { recursive: true });
if (!fs.existsSync(path.join(tools, 'package.json'))) fs.writeFileSync(path.join(tools, 'package.json'), '{"name":"gayze-browser-tools","private":true}\n');
execFileSync('npm', ['install', '--no-audit', '--no-fund', '@sparticuz/chromium@131', 'playwright-core@1.49.1'], { cwd: tools, stdio: 'inherit' });

const bin = path.join(tools, 'node_modules', '@sparticuz', 'chromium', 'bin');
const libs = path.join(tools, 'libs');
fs.mkdirSync(libs, { recursive: true });
const archive = path.join(libs, 'al2023.tar');
fs.writeFileSync(archive, zlib.brotliDecompressSync(fs.readFileSync(path.join(bin, 'al2023.tar.br'))));
execFileSync('tar', ['-xf', archive, '-C', libs]);
console.log(`Browser tools ready in ${tools}. Libraries: ${path.join(libs, 'lib')}`);
