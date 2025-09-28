#!/usr/bin/env tsx
import 'dotenv/config';
import { regenToken } from '../apps/server/src/auth';

async function main() {
  const res = regenToken();
  if (!res) {
    console.error('No account present or regen failed');
    process.exit(2);
  }
  // Print token to stdout; caller should copy it into their secure vault
  console.log(res.token);
}

main().catch((err) => { console.error(err); process.exit(1); });
