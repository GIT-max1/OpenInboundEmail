import fs from 'node:fs';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import path from 'node:path';
import { logger } from './logger.js';
import type { Settings } from './types.js';
import { greyDecision } from './greylist.js';
import dns from 'node:dns/promises';
import { PrismaClient } from './generated/prisma/index.js';

const prisma = new PrismaClient();

export class InboundSMTP {
  private server?: SMTPServer;

  constructor(private settings: Settings) {}

  setSettings(s: Settings) { this.settings = s; }

  listen() {
    const s = this.settings;
    const port = s.mode === 'dev' ? (parseInt(process.env.SMTP_PORT_DEV||'2525',10)) : (parseInt(process.env.SMTP_PORT_PROD||'25',10));

    const keyPath = process.env.SMTP_TLS_KEY;
    const certPath = process.env.SMTP_TLS_CERT;
  const hasTLS = !!(keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath));

  // naive in-memory connection counter to avoid bursts
  const connPerIp = new Map<string, number>();

  this.server = new SMTPServer({
      // Allow STARTTLS when certs are provided
      secure: false,
      key: hasTLS ? fs.readFileSync(keyPath!) : undefined,
      cert: hasTLS ? fs.readFileSync(certPath!) : undefined,
      banner: `Inbound SMTP for ${s.mxHostname}`,
      size: parseInt(process.env.MAX_MESSAGE_SIZE||'10485760',10),
      disabledCommands: ['AUTH', ...(hasTLS ? [] : ['STARTTLS'])],
      socketTimeout: parseInt(process.env.CONNECTION_TIMEOUT_MS||'60000',10),

      onConnect: async (session, cb) => {
        try {
          // require STARTTLS in prod if certs exist
          if (s.mode === 'prod' && hasTLS && !(session as any).encrypted) {
            return cb(new Error('530 5.7.0 STARTTLS required'));
          }

          // simple burst limit per IP
          const ip = (session.remoteAddress||'').trim();
          const active = (connPerIp.get(ip) || 0) + 1;
          connPerIp.set(ip, active);
          if (active > parseInt(process.env.SMTP_MAX_CONN_PER_IP||'10',10)) {
            connPerIp.set(ip, active - 1);
            return cb(new Error('421 4.7.0 too many connections from your host'));
          }

          if (s.rbl.enabled && s.rbl.zones.length) {
            // DNSBL check: reject if listed in any configured zone
            const ip = (session.remoteAddress||'').trim();
            const rev = ip && ip.split('.').reverse().join('.');
            if (rev) {
              for (const zone of s.rbl.zones) {
                try {
                  const q = `${rev}.${zone}`;
                  const listed = await dns.resolve4(q).then(()=>true).catch(()=>false);
                  if (listed) {
                    logger.warn({ ip, zone }, 'RBL blocked');
                    return cb(new Error('554 5.7.1 access denied (listed)'));
                  }
                } catch {}
              }
            }
          }
          cb();
        } catch (e) { logger.warn({ e }, 'onConnect'); cb(); }
      },

  onRcptTo: (address, session, cb) => {
        const rcpt = (address.address||'').toLowerCase();
        const domainOk = rcpt.endsWith(`@${s.domain}`);
        const allowed = s.recipients.length ? s.recipients.includes(rcpt) : domainOk;
        if (!domainOk) return cb(new Error('550 5.1.1 relaying denied'));
        if (!allowed) return cb(new Error('550 5.1.1 mailbox unavailable'));

  const mailFromAddr = (session.envelope.mailFrom && typeof session.envelope.mailFrom === 'object') ? (session.envelope.mailFrom as any).address as string : null;
  const g = greyDecision(s, session.remoteAddress||'', mailFromAddr, rcpt);
        if (g.action === 'tempfail') return cb(new Error(`450 4.7.1 greylisted; wait ${g.wait}s`));
        cb();
      },

  onData: (stream, session, cb) => {
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on('data', (d: Buffer) => { total += d.length; chunks.push(d); if (total > parseInt(process.env.MAX_MESSAGE_SIZE||'10485760',10)) stream.destroy(new Error('552 message too large')); });
        stream.on('end', async () => {
          try {
            const raw = Buffer.concat(chunks);
            const parsed = await simpleParser(raw);
            // Try optional DMARC/SPF/DKIM auth if library is present
            let dmarcResult: string | undefined;
            try {
              // dynamic import to keep dependency optional
    const mod = await import('mailauth').catch(() => null);
              if (mod?.authenticate) {
                const res = await mod.authenticate(raw, {
                  ip: session.remoteAddress || '',
                  helo: session.clientHostname || undefined,
                  mta: s.mxHostname,
                  sender: (session.envelope.mailFrom && typeof session.envelope.mailFrom === 'object') ? (session.envelope.mailFrom as any).address as string : '',
                  recipient: (session.envelope.rcptTo || []).map((r: any) => r?.address || '')
                });
                dmarcResult = res.dmarc?.result;
              }
            } catch {}
            if (s.policy.requireDMARC && dmarcResult !== 'pass') {
              return cb(new Error('550 5.7.1 DMARC policy failure'));
            }
            // store per-recipient
            const base = process.env.SPOOL_DIR || './spool';
            const sanitize = (s: string) => s.replace(/[^a-z0-9._-]/g, '_');
            for (const rcpt of session.envelope.rcptTo || []) {
              const [localRaw, domainRaw] = (rcpt.address||'').toLowerCase().split('@');
              const domain = sanitize(domainRaw || 'unknown');
              const local = sanitize(localRaw || 'unknown');
              const root = path.join(base, domain, local, 'Maildir');
              fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
              fs.mkdirSync(path.join(root, 'new'), { recursive: true });
              const fname = `${Date.now()}_${Math.random().toString(36).slice(2)}.eml`;
              fs.writeFileSync(path.join(root, 'new', fname), raw);

              // Also save to DB
              await prisma.email.create({
                data: {
                  from: parsed.from?.text || (typeof session.envelope.mailFrom === 'object' && session.envelope.mailFrom ? (session.envelope.mailFrom as any).address : null) || 'unknown',
                  to: JSON.stringify(session.envelope.rcptTo?.map(r => r.address) || []),
                  subject: parsed.subject,
                  text: parsed.text,
                  html: typeof parsed.html === 'string' ? parsed.html : null,
                  raw: raw.toString()
                }
              });
            }
            logger.info({ from: parsed.from?.text, subj: parsed.subject, to: session.envelope.rcptTo?.map(r=>r.address), dmarc: dmarcResult }, 'accepted');
            cb();
          } catch (e:any) { logger.error({ e }, 'onData'); cb(new Error('451 4.3.0 processing error')); }
          finally {
            const ip = (session.remoteAddress||'').trim();
            const active = (connPerIp.get(ip) || 1) - 1;
            connPerIp.set(ip, Math.max(0, active));
          }
        });
      }
    });

    this.server.on('error', (e) => logger.error({ e }, 'SMTP error'));
    this.server.listen(port, () => logger.info({ port }, 'SMTP listening'));
  }

  async close() {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}
