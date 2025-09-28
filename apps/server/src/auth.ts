import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');

type Stored = {
  username: string;
  salt: string;
  hash: string;
  tokenSalt: string;
  tokenHash: string;
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function pbkdf(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
}

export function accountExists() {
  return fs.existsSync(ADMIN_FILE);
}

export function readAccount(): Stored | null {
  if (!accountExists()) return null;
  try {
    const raw = fs.readFileSync(ADMIN_FILE, 'utf8');
    return JSON.parse(raw) as Stored;
  } catch (e) { return null; }
}

export function createAccount(username: string, password: string) {
  ensureDir();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = pbkdf(password, salt);
  const token = crypto.randomBytes(24).toString('hex');
  const tokenSalt = crypto.randomBytes(12).toString('hex');
  const tokenHash = pbkdf(token, tokenSalt);
  const store: Stored = { username, salt, hash, tokenSalt, tokenHash };
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  return { token };
}

export function verifyAccount(username: string, password: string) {
  const s = readAccount();
  if (!s) return false;
  if (s.username !== username) return false;
  const candidate = pbkdf(password, s.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate,'hex'), Buffer.from(s.hash,'hex'));
}

export function verifyToken(token: string) {
  const s = readAccount();
  if (!s) return false;
  const candidate = pbkdf(token, s.tokenSalt);
  return crypto.timingSafeEqual(Buffer.from(candidate,'hex'), Buffer.from(s.tokenHash,'hex'));
}

export function regenToken(): { token: string } | null {
  const s = readAccount();
  if (!s) return null;
  const token = crypto.randomBytes(24).toString('hex');
  const tokenSalt = crypto.randomBytes(12).toString('hex');
  const tokenHash = pbkdf(token, tokenSalt);
  const newStore = { ...s, tokenSalt, tokenHash };
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(newStore, null, 2), { mode: 0o600 });
  return { token };
}
