#!/usr/bin/env node

import fs from 'node:fs';

function replaceExactlyOnce(file, before, after, label) {
  const source = fs.readFileSync(file, 'utf8');
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0) {
    throw new Error(`${label}: expected source pattern not found in ${file}. Upstream telemetry wiring may have changed; refusing to produce a build that could silently re-enable telemetry.`);
  }
  if (first !== last) {
    throw new Error(`${label}: expected exactly one source pattern in ${file}, found multiple matches.`);
  }
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

const rendererEntry = 'apps/desktop/src/renderer/main-entry.tsx';
const heartbeatService = 'apps/desktop/src/main/heartbeatService.ts';

replaceExactlyOnce(
  rendererEntry,
  "import { initTapdb } from './analytics/tapdbClient';\n",
  '',
  'TapDB import',
);

replaceExactlyOnce(
  rendererEntry,
  '  initTapdb();\n',
  '  // Telemetry-free build: TapDB analytics disabled by CI.\n',
  'TapDB initialization',
);

replaceExactlyOnce(
  heartbeatService,
  `function verifiedCloudUserId(state: AuthStateSnapshot): string | null {\n  return state.mode === 'cloud' && state.isAuthenticated && state.user ? state.user.id : null;\n}`,
  `function verifiedCloudUserId(_state: AuthStateSnapshot): string | null {\n  // Telemetry-free build: never provide an identity to the heartbeat client,\n  // so the service cannot start or transmit online-presence telemetry.\n  return null;\n}`,
  'Cloud heartbeat identity gate',
);

const rendererAfter = fs.readFileSync(rendererEntry, 'utf8');
const heartbeatAfter = fs.readFileSync(heartbeatService, 'utf8');

if (rendererAfter.includes("from './analytics/tapdbClient'")) {
  throw new Error('TapDB analytics import still exists after stripping.');
}
if (/\binitTapdb\s*\(/.test(rendererAfter)) {
  throw new Error('TapDB analytics initialization still exists after stripping.');
}
if (!heartbeatAfter.includes('Telemetry-free build: never provide an identity')) {
  throw new Error('Heartbeat telemetry guard was not installed.');
}
if (!/function verifiedCloudUserId\(_state: AuthStateSnapshot\): string \| null \{[\s\S]*?return null;\n\}/.test(heartbeatAfter)) {
  throw new Error('Heartbeat identity gate is not a guaranteed no-op.');
}

console.log('Telemetry stripping complete: TapDB initialization removed; cloud heartbeat identity disabled.');
