import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const OTP_TTL_MS = 5 * 60 * 1000;

interface OtpEntry {
  digest: Buffer;
  expiresAt: number;
}

interface OtpServiceOptions {
  secret: string;
  now?: () => number;
  generateCode?: () => string;
  logCode: (phoneNumber: string, code: string) => void;
}

export class OtpService {
  private readonly entries = new Map<string, OtpEntry>();
  private readonly now: () => number;
  private readonly generateCode: () => string;

  constructor(private readonly options: OtpServiceOptions) {
    this.now = options.now ?? Date.now;
    this.generateCode = options.generateCode ?? (() => randomInt(0, 1_000_000).toString().padStart(6, '0'));
  }

  request(phoneNumber: string): void {
    const code = this.generateCode();
    this.entries.set(phoneNumber, {
      digest: this.digest(phoneNumber, code),
      expiresAt: this.now() + OTP_TTL_MS,
    });
    this.options.logCode(phoneNumber, code);
  }

  verify(phoneNumber: string, code: string): boolean {
    const entry = this.entries.get(phoneNumber);

    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(phoneNumber);
      return false;
    }

    const candidate = this.digest(phoneNumber, code);
    if (candidate.length !== entry.digest.length || !timingSafeEqual(candidate, entry.digest)) {
      return false;
    }

    this.entries.delete(phoneNumber);
    return true;
  }

  private digest(phoneNumber: string, code: string): Buffer {
    return createHmac('sha256', this.options.secret).update(`${phoneNumber}:${code}`).digest();
  }
}
