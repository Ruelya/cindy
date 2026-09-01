#!/usr/bin/env node

import fs from 'node:fs';

function detectEol(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function assertEolPreserved(file, source, result, eol) {
  if (eol === '\r\n' && /(^|[^\r])\n/.test(result)) {
    throw new Error(`${file}: telemetry rewrite introduced bare LF into a CRLF checkout.`);
  }
  if (eol === '\n' && result.includes('\r\n')) {
    throw new Error(`${file}: telemetry rewrite introduced CRLF into an LF checkout.`);
  }

  // A rewrite is expected, but newline style must not change as a side effect.
  if (source.includes('\r\n') !== result.includes('\r\n')) {
    throw new Error(`${file}: telemetry rewrite changed the file newline convention.`);
  }
}

function replaceRegexExactlyOnce(file, regex, replacement, label) {
  const source = fs.readFileSync(file, 'utf8');
  const eol = detectEol(source);
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  const matches = [...source.matchAll(matcher)];

  if (matches.length === 0) {
    throw new Error(`${label}: expected source pattern not found in ${file}. Upstream telemetry wiring may have changed; refusing to produce a build that could silently re-enable telemetry.`);
  }
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one source pattern in ${file}, found ${matches.length} matches.`);
  }

  const singleMatchRegex = new RegExp(regex.source, regex.flags.replace('g', ''));
  const eolSafeReplacement = replacement.replace(/\r?\n/g, eol);
  const result = source.replace(singleMatchRegex, eolSafeReplacement);
  assertEolPreserved(file, source, result, eol);
  fs.writeFileSync(file, result, 'utf8');
}

const rendererEntry = 'apps/desktop/src/renderer/main-entry.tsx';
const heartbeatService = 'apps/desktop/src/main/heartbeatService.ts';

// GitHub Windows runners normally checkout CRLF. These matches are structural
// and replacements are converted back to each file's original newline style.
replaceRegexExactlyOnce(
  rendererEntry,
  /^import\s+\{\s*initTapdb\s*\}\s+from\s+['"]\.\/analytics\/tapdbClient['"];?[ \t]*$/m,
  '',
  'TapDB import',
);

replaceRegexExactlyOnce(
  rendererEntry,
  /^[ \t]*initTapdb\(\);[ \t]*$/m,
  '  // Telemetry-free build: TapDB analytics disabled by CI.',
  'TapDB initialization',
);

replaceRegexExactlyOnce(
  heartbeatService,
  /function\s+verifiedCloudUserId\(state:\s*AuthStateSnapshot\):\s*string\s*\|\s*null\s*\{\r?\n\s*return\s+state\.mode\s*===\s*['"]cloud['"]\s*&&\s*state\.isAuthenticated\s*&&\s*state\.user\s*\?\s*state\.user\.id\s*:\s*null;\r?\n\}/m,
  `function verifiedCloudUserId(_state: AuthStateSnapshot): string | null {
  // Telemetry-free build: never provide an identity to the heartbeat client,
  // so the service cannot start or transmit online-presence telemetry.
  return null;
}`,
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

console.log('Telemetry stripping complete: TapDB initialization removed; cloud heartbeat identity disabled; source EOL preserved.');
