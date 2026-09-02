#!/usr/bin/env node

import fs from 'node:fs';

const forgeConfig = 'apps/desktop/forge.config.ts';
const source = fs.readFileSync(forgeConfig, 'utf8');
const eol = source.includes('\r\n') ? '\r\n' : '\n';

// electron-builder 24.x implicitly switches to onTagOrDraft publishing on CI.
// For this fork's unsigned artifact-only workflow, publishing must be explicitly
// disabled at the NSIS target level. electron-builder treats target.publish === null
// as an immediate "do not publish / do not resolve repository" sentinel.
const nsisOpen = /^(\s*)nsis:\s*\{\r?$/gm;
const matches = [...source.matchAll(nsisOpen)];
if (matches.length !== 1) {
  throw new Error(
    `Expected exactly one NSIS config block in ${forgeConfig}, found ${matches.length}. ` +
      'Upstream packaging structure may have changed; refusing to guess where to disable publishing.',
  );
}

if (/^\s*publish:\s*null,?\s*$/m.test(source)) {
  throw new Error(
    `${forgeConfig} already contains publish: null. Remove this CI patch step or review the upstream change.`,
  );
}

const match = matches[0];
const indent = match[1];
const replacement =
  `${match[0]}${eol}` +
  `${indent}  // CI artifact build: never invoke electron-builder publishers.${eol}` +
  `${indent}  publish: null,`;

const patched = source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
fs.writeFileSync(forgeConfig, patched, 'utf8');

const after = fs.readFileSync(forgeConfig, 'utf8');
const publishNullMatches = after.match(/^\s*publish:\s*null,?\s*$/gm) ?? [];
if (publishNullMatches.length !== 1) {
  throw new Error(`Failed to install exactly one NSIS publish:null guard in ${forgeConfig}.`);
}

console.log('Electron-builder publishing disabled for the CI NSIS target (publish: null).');
