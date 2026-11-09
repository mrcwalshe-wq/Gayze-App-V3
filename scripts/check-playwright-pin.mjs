#!/usr/bin/env node
// Fails unless the Playwright version is pinned exactly and matches, everywhere:
//   package.json devDependency (no ^ or ~)  ==  installed @playwright/test  ==  image tag in scripts/e2e-docker.sh
// Screenshots are only comparable when the browser build is identical.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const declared = pkg.devDependencies?.['@playwright/test'];
const installed = JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8')).version;
const script = readFileSync('scripts/e2e-docker.sh', 'utf8');
const tag = script.match(/mcr\.microsoft\.com\/playwright:v([0-9.]+)-noble/)?.[1];

const problems = [];
if (!/^\d+\.\d+\.\d+$/.test(declared ?? '')) problems.push(`package.json must pin @playwright/test exactly, found "${declared}"`);
if (declared !== installed) problems.push(`installed @playwright/test is ${installed}, package.json says ${declared}`);
if (tag !== installed) problems.push(`scripts/e2e-docker.sh uses image tag v${tag}, installed Playwright is ${installed}`);
if (problems.length) { console.error('Playwright pin check FAILED:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log(`Playwright pin OK: ${installed} (package.json, node_modules and image tag agree)`);
