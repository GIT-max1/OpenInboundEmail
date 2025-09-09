import type { Settings } from './types.js';

export function buildMtaStsPolicy(s: Settings) {
  const maxAge = 86400; // 1 day
  const mode = s.mtaStsMode; // enforce | testing | none
  const mx = s.mxHostname;
  return [
    `version: STSv1`,
    `mode: ${mode}`,
    `mx: ${mx}`,
    `max_age: ${maxAge}`
  ].join('\n') + '\n';
}
