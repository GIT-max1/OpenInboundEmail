declare module 'mailauth' {
  export type MailAuthResult = {
    spf?: { result?: string };
    dkim?: { result?: string };
    dmarc?: { result?: string };
  };

  export function authenticate(
    raw: Buffer | Uint8Array,
    opts?: {
      ip?: string;
      helo?: string;
      mta?: string;
      sender?: string;
      recipient?: string | string[];
    }
  ): Promise<MailAuthResult>;
}
