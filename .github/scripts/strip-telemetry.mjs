#!/usr/bin/env node

import fs from 'node:fs';

function replaceRegexExactlyOnce(file, regex, after, label) {
  const source = fs.readFileSync(file, 'utf8');
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  const matches = [...source.matchAll(matcher)];
  if (matches.length === 0) {
    throw new Error(`${label}: expected source pattern not found in ${file}. Upstream telemetry wiring may have changed; refusing to produce a build that could silently re-enable telemetry.`);
  }
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one source pattern in ${file}, found ${matches.length} matches.`);
  }
  fs.writeFileSync(file, source.replace(new RegExp(regex.source, regex.flags.replace('g', '')), after), 'utf8');
}

const rendererEntry = 'apps/desktop/src/renderer/main-entry.tsx';
const heartbeatService = 'apps/desktop/src/main/heartbeatService.ts';

// Match source structure while tolerating Windows CRLF checkouts.
replaceRegexExactlyOnce(
  rendererEntry,
  /^import\s+\{\s*initTapdb\s*\}\s+from\s+['"]\.\/analytics\/tapdbClient['"];?\r?$/m,
  '',
  'TapDB import',
);

replaceRegexExactlyOnce(
  rendererEntry,
  /^\s*initTapdb\(\);\r?$/m,
  '  // Telemetry-free build: TapDB analytics disabled by CI.',
  'TapDB initialization',
);

replaceRegexExactlyOnce(
  heartbeatService,
  /function\s+verifiedCloudUserId\(state:\s*AuthStateSnapshot\):\s*string\s*\|\s*null\s*\{\r?\n\s*return\s+state\.mode\s*===\s*['"]cloud['"]\s*&&\s*state\.isAuthenticated\s*&&\s*state\.user\s*\?\s*state\.user\.id\s*:\s*null;\r?\n\}/m,
  `function verifiedCloudUserId(_state: AuthStateSnapshot): string | null {\n  // Telemetry-free build: never provide an identity to the heartbeat client,\n  // so the service cannot start or transmit online-presence telemetry.\n  return null;\n}`,
  'Cloud heartbeat identity gate',
);

const rendererAfter = fs.readFileSync(rendererEntry, 'utf8');
const heartbeatAfter = fs.readFileSync(heartbeatService, 'utf8');

if (/from\s+['"]\.\/analytics\/tapdbClient['"]/.test(rendererAfter)) {
  throw new Error('TapDB analytics import still exists after stripping.');
}
if (/\binitTapdb\s*\(/.test(rendererAfter)) {
  throw new Error('TapDB analytics initialization still exists after stripping.');
}
if (!heartbeatAfter.includes('Telemetry-free build: never provide an identity')) {
  throw new Error('Heartbeat telemetry guard was not installed.');
}
if (!/function\s+verifiedCloudUserId\(_state:\s*AuthStateSnapshot\):\s*string\s*\|\s*null\s*\{[\s\S]*?return\s+null;\r?\n\}/.test(heartbeatAfter)) {
  throw new Error('Heartbeat identity gate is not a guaranteed no-op.');
}

console.log('Telemetry stripping complete: TapDB initialization removed; cloud heartbeat identity disabled.');
