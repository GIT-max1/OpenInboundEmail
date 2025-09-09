import { z } from 'zod';

export const ModeSchema = z.union([z.literal('dev'), z.literal('prod')]);

export const SettingsSchema = z.object({
  mode: ModeSchema,
  domain: z.string().min(1),
  mxHostname: z.string().min(1),
  publicIPv4: z.string().optional().nullable(),
  publicIPv6: z.string().optional().nullable(),
  // Empty array means accept any user @ domain
  recipients: z.array(z.string().email()).min(0),
  rbl: z.object({ enabled: z.boolean(), zones: z.array(z.string()) }),
  greylist: z.object({ enabled: z.boolean(), minDelaySec: z.number().int().positive(), ttlSec: z.number().int().positive() }),
  policy: z.object({ requireDMARC: z.boolean() }),
  dns: z.object({
    provider: z.union([z.literal('manual'), z.literal('cloudflare')]),
    autoMaintain: z.boolean(),
    cloudflare: z.object({ apiToken: z.string().optional(), accountId: z.string().optional() })
  }),
  tlsrptEmail: z.string().email(),
  mtaStsMode: z.union([z.literal('enforce'), z.literal('testing'), z.literal('none')])
});

export type Settings = z.infer<typeof SettingsSchema>;

export type DNSRecordSpec = {
  type: 'A' | 'AAAA' | 'MX' | 'TXT' | 'CNAME';
  name: string;          // e.g., "@" or "_mta-sts"
  content: string;       // value
  ttl?: number;          // seconds
  priority?: number;     // for MX
  proxied?: boolean;     // cloudflare-specific
};

export type DNSStatus = {
  record: DNSRecordSpec;
  present: boolean;
  observed?: string[];
};
