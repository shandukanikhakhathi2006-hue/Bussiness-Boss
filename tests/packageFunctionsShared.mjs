import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A normal npm distribution archive, generated from the ONLY canonical sources.
// Never edit vendor contents; regenerate and refresh the Functions lock/install.
const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = fileURLToPath(new URL('../functions/vendor/', import.meta.url));
mkdirSync(vendor, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm?.endsWith('npm-cli.js')) throw new Error('Run npm run build:functions-shared.');
const result = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', vendor], { cwd: root, encoding: 'utf8' }));
const allowed = new Set(['package.json', ...JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).files.filter(p => !p.endsWith('/')),
    'server/invoiceDraftBoundary.js', 'server/invoiceDraftRepository.js', 'server/invoiceDraftUpdateRepository.js', 'server/invoiceDraftReadRepository.js', 'server/emulatorSafety.js']);
if (result[0].files.some(file => !allowed.has(file.path))) throw new Error('Unexpected shared package contents; do not use this archive.');
console.log('Packaged canonical domain/server modules; no maintained source copies.');
execFileSync(process.execPath, [npm, 'install', 'businessboss@file:vendor/businessboss-0.0.0.tgz',
    '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: fileURLToPath(new URL('../functions/', import.meta.url)), stdio: 'inherit' });

