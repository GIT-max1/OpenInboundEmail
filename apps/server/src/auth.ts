import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ADMIN_FILE_JSON = path.join(DATA_DIR, 'admin.json');
const ADMIN_FILE_ENC = path.join(DATA_DIR, 'admin.enc');

type Stored = {
  username: string;
  salt: string;
  hash: string;
  tokenSalt: string;
  tokenHash: string;
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function pbkdf(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
}

function getStoreKey(): Buffer | null {
  const k = process.env.ADMIN_STORE_KEY || '';
  if (!k) return null;
  return crypto.createHash('sha256').update(k).digest();
}

function encryptString(plain: string, key: Buffer) {
  // AES-256-GCM (AEAD): store as iv(12) || tag(16) || cipher
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptString(b64: string, key: Buffer) {
  try {
    const raw = Buffer.from(b64, 'base64');
    const iv = raw.slice(0, 12);
    const tag = raw.slice(12, 28);
    const enc = raw.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    // bubble up so callers can treat this as a corruption/decrypt failure
    throw new Error('ADMIN_STORE_DECRYPTION_FAILED');
  }
}

export function accountExists() {
  const key = getStoreKey();
  if (key) return fs.existsSync(ADMIN_FILE_ENC);
  return fs.existsSync(ADMIN_FILE_JSON);
}

export function readAccount(): Stored | null {
  ensureDir();
  const key = getStoreKey();
  try {
    if (key && fs.existsSync(ADMIN_FILE_ENC)) {
      const raw = fs.readFileSync(ADMIN_FILE_ENC, 'utf8');
      const dec = decryptString(raw, key); // may throw on auth failure
      return JSON.parse(dec) as Stored;
    }
    if (fs.existsSync(ADMIN_FILE_JSON)) {
      const raw = fs.readFileSync(ADMIN_FILE_JSON, 'utf8');
      return JSON.parse(raw) as Stored;
    }
    return null;
  } catch (e:any) {
    // If decryption or parse fails, surface a specific error so callers
    // can avoid accidentally reinitializing the store.
    if (e?.message === 'ADMIN_STORE_DECRYPTION_FAILED') throw e;
    throw new Error('ADMIN_STORE_READ_FAILED');
  }
}

export function createAccount(username: string, password: string) {
  ensureDir();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = pbkdf(password, salt);
  const token = crypto.randomBytes(24).toString('hex');
  const tokenSalt = crypto.randomBytes(12).toString('hex');
  const tokenHash = pbkdf(token, tokenSalt);
  const store: Stored = { username, salt, hash, tokenSalt, tokenHash };
  const key = getStoreKey();
  if (key) {
    const enc = encryptString(JSON.stringify(store), key);
    const tmp = ADMIN_FILE_ENC + '.tmp';
    fs.writeFileSync(tmp, enc, { mode: 0o600 });
    fs.renameSync(tmp, ADMIN_FILE_ENC);
    return { token };
  }
  const tmp = ADMIN_FILE_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, ADMIN_FILE_JSON);
  return { token };
}

export function verifyAccount(username: string, password: string) {
  let s: Stored | null = null;
  try { s = readAccount(); } catch { return false; }
  if (!s) return false;
  if (s.username !== username) return false;
  const candidate = pbkdf(password, s.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate,'hex'), Buffer.from(s.hash,'hex'));
}

export function verifyToken(token: string) {
  let s: Stored | null = null;
  try { s = readAccount(); } catch { return false; }
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
  const key = getStoreKey();
  if (key) {
    const enc = encryptString(JSON.stringify(newStore), key);
    const tmp = ADMIN_FILE_ENC + '.tmp';
    fs.writeFileSync(tmp, enc, { mode: 0o600 });
    fs.renameSync(tmp, ADMIN_FILE_ENC);
    return { token };
  }
  const tmp = ADMIN_FILE_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(newStore, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, ADMIN_FILE_JSON);
  return { token };
}
