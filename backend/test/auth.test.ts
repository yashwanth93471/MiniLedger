import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OtpService } from '../src/auth/otp-service';
import authRoutes from '../src/routes/auth';

const phoneNumber = '+14155552671';
const tokenSecret = 'test-jwt-secret-that-is-long-enough-for-tests';

function createApp(options: { now?: () => number; codes?: string[] } = {}) {
  const loggedCodes: string[] = [];
  const issuedUsers: string[] = [];
  let codeIndex = 0;
  const codes = options.codes ?? ['123456'];
  const otpService = new OtpService({
    secret: 'test-otp-secret',
    now: options.now,
    generateCode: () => codes[codeIndex++] ?? '000000',
    logCode: (phone, code) => loggedCodes.push(`${phone}:${code}`),
  });
  const app = Fastify();

  app.register(jwt, { secret: tokenSecret });
  app.register(authRoutes, {
    prefix: '/auth',
    otpService,
    users: {
      async upsert(phone) {
        issuedUsers.push(phone);
        return { id: 'user-uuid', phoneNumber: phone };
      },
    },
  });

  return { app, loggedCodes, issuedUsers };
}

describe('OTP authentication routes', () => {
  let currentTime: number;
  let app: ReturnType<typeof Fastify>;
  let loggedCodes: string[];
  let issuedUsers: string[];

  beforeEach(async () => {
    currentTime = 1_000_000;
    ({ app, loggedCodes, issuedUsers } = createApp({ now: () => currentTime }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function requestOtp(): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phoneNumber },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { message: 'OTP sent.' });
  }

  it('validates phone number and does not return the mock OTP', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phoneNumber: '4155552671' },
    });
    assert.equal(invalid.statusCode, 400);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/otp/request',
      payload: { phoneNumber },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes('123456'), false);
    assert.deepEqual(loggedCodes, [`${phoneNumber}:123456`]);
  });

  it('verifies an OTP and returns a verifiable JWT', async () => {
    await requestOtp();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { phoneNumber, otp: '123456' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<{ token: string; tokenType: string }>();
    assert.equal(body.tokenType, 'Bearer');
    assert.equal(app.jwt.verify(body.token).sub, 'user-uuid');
    assert.deepEqual(issuedUsers, [phoneNumber]);
  });

  it('rejects an incorrect OTP', async () => {
    await requestOtp();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { phoneNumber, otp: '654321' },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(issuedUsers, []);
  });

  it('rejects an expired OTP', async () => {
    await requestOtp();
    currentTime += 5 * 60 * 1000;
    const response = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { phoneNumber, otp: '123456' },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(issuedUsers, []);
  });

  it('rejects reuse after successful verification', async () => {
    await requestOtp();
    const first = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { phoneNumber, otp: '123456' },
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { phoneNumber, otp: '123456' },
    });

    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 401);
    assert.equal(issuedUsers.length, 1);
  });

  it('invalidates an earlier OTP when the phone requests another', async () => {
    const { app: secondApp, loggedCodes: codes } = createApp({
      now: () => currentTime,
      codes: ['111111', '222222'],
    });
    await secondApp.ready();

    await secondApp.inject({ method: 'POST', url: '/auth/otp/request', payload: { phoneNumber } });
    await secondApp.inject({ method: 'POST', url: '/auth/otp/request', payload: { phoneNumber } });
    const oldOtp = await secondApp.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { phoneNumber, otp: '111111' },
    });
    const newOtp = await secondApp.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { phoneNumber, otp: '222222' },
    });

    assert.equal(codes.length, 2);
    assert.equal(oldOtp.statusCode, 401);
    assert.equal(newOtp.statusCode, 200);
    await secondApp.close();
  });

  it('validates phone number and OTP on verification', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/otp/verify',
      payload: { phoneNumber, otp: '12345' },
    });
    assert.equal(response.statusCode, 400);
  });
});
