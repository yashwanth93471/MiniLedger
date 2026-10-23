import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../src/generated/prisma/client';
import loanRoutes from '../src/routes/loans';

const tokenSecret = 'loan-test-jwt-secret-at-least-32-characters-long';
const ownerId = '4d82ed17-181d-455c-9035-32a0405c2112';
const otherId = '18be6b01-c467-4d59-8138-1de4ae609a5f';

interface TestLoan {
  id: string;
  userId: string;
  friendName: string;
  amount: { toString(): string };
  dueDate: Date;
  status: 'PENDING' | 'REPAID';
  createdAt: Date;
  repaidAt: Date | null;
}

function createApp(initialLoans: TestLoan[] = [], today = new Date('2026-10-22T00:00:00.000Z')) {
  const created: Array<Record<string, unknown>> = [];
  const ownerQueries: string[] = [];
  const repayQueries: Array<{ id: string; userId: string }> = [];
  const summaryQueries: Array<{ userId: string; today: Date }> = [];
  const loans = initialLoans;
  const app = Fastify();

  app.register(jwt, { secret: tokenSecret });
  app.register(loanRoutes, {
    async createLoan(data) {
      created.push(data);
      return {
        id: 'f3a509a7-f84d-4080-9a68-9dc5a0cccb41',
        ...data,
        amount: { toString: () => data.amount },
        dueDate: data.dueDate,
        status: 'PENDING' as const,
        createdAt: new Date('2026-10-22T12:00:00.000Z'),
        repaidAt: null,
      };
    },
    async listLoans(userId) {
      ownerQueries.push(userId);
      return loans
        .filter((loan) => loan.userId === userId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    },
    async repayLoan(id, userId) {
      repayQueries.push({ id, userId });
      const loan = loans.find((entry) => entry.id === id && entry.userId === userId);
      if (!loan) return null;
      if (loan.status === 'PENDING') {
        loan.status = 'REPAID';
        loan.repaidAt = new Date('2026-10-23T12:00:00.000Z');
      }
      return loan;
    },
    async summarizeLoans(userId, queryDate) {
      summaryQueries.push({ userId, today: queryDate });
      const sum = (matches: TestLoan[]) => matches
        .reduce((total, loan) => total.plus(loan.amount.toString()), new Prisma.Decimal(0))
        .toFixed(2);
      return {
        totalLent: sum(loans.filter((loan) => loan.userId === userId)),
        totalRepaid: sum(loans.filter((loan) => loan.userId === userId && loan.status === 'REPAID')),
        overdueAmount: sum(loans.filter((loan) => loan.userId === userId && loan.status === 'PENDING' && loan.dueDate < queryDate)),
      };
    },
    getToday: () => today,
  });

  return { app, created, ownerQueries, repayQueries };
}

describe('GET /loans/summary', () => {
  it('calculates exact user totals and excludes loans due today from overdue', async () => {
    const today = new Date('2026-10-22T00:00:00.000Z');
    const makeLoan = (
      id: string,
      userId: string,
      amount: string,
      status: 'PENDING' | 'REPAID',
      dueDate: string,
    ): TestLoan => ({
      id,
      userId,
      friendName: id,
      amount: { toString: () => amount },
      dueDate: new Date(`${dueDate}T00:00:00.000Z`),
      status,
      createdAt: today,
      repaidAt: status === 'REPAID' ? today : null,
    });
    const { app: summaryApp } = createApp([
      makeLoan('old-pending', ownerId, '0.10', 'PENDING', '2026-10-21'),
      makeLoan('due-today', ownerId, '0.20', 'PENDING', '2026-10-22'),
      makeLoan('future-pending', ownerId, '0.30', 'PENDING', '2026-10-23'),
      makeLoan('repaid', ownerId, '0.40', 'REPAID', '2026-10-20'),
      makeLoan('other-user', otherId, '900.00', 'PENDING', '2026-10-01'),
    ], today);
    await summaryApp.ready();
    const summaryToken = summaryApp.jwt.sign({ sub: ownerId });

    const response = await summaryApp.inject({
      method: 'GET',
      url: `/loans/summary?userId=${otherId}`,
      headers: { authorization: `Bearer ${summaryToken}` },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      totalLent: '1.00',
      totalRepaid: '0.40',
      overdueAmount: '0.10',
    });
    await summaryApp.close();
  });

  it('returns formatted zero totals for empty history', async () => {
    const { app: summaryApp } = createApp([]);
    await summaryApp.ready();
    const summaryToken = summaryApp.jwt.sign({ sub: ownerId });

    const response = await summaryApp.inject({
      method: 'GET',
      url: '/loans/summary',
      headers: { authorization: `Bearer ${summaryToken}` },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      totalLent: '0.00',
      totalRepaid: '0.00',
      overdueAmount: '0.00',
    });
    await summaryApp.close();
  });

  it('rejects missing and invalid JWTs', async () => {
    const { app: summaryApp } = createApp();
    await summaryApp.ready();

    const missing = await summaryApp.inject({ method: 'GET', url: '/loans/summary' });
    const invalid = await summaryApp.inject({
      method: 'GET',
      url: '/loans/summary',
      headers: { authorization: 'Bearer invalid-token' },
    });

    assert.equal(missing.statusCode, 401);
    assert.equal(invalid.statusCode, 401);
    await summaryApp.close();
  });
});

describe('POST /loans and GET /loans', () => {
  let app: ReturnType<typeof Fastify>;
  let created: Array<Record<string, unknown>>;
  let ownerQueries: string[];
  let repayQueries: Array<{ id: string; userId: string }>;
  let token: string;

  beforeEach(async () => {
    ({ app, created, ownerQueries, repayQueries } = createApp());
    await app.ready();
    token = app.jwt.sign({ sub: ownerId, phoneNumber: '+14155552671' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists only authenticated user loans with selected fields newest first', async () => {
    const oldLoan: TestLoan = {
      id: '11111111-1111-4111-8111-111111111111',
      userId: ownerId,
      friendName: 'Older loan',
      amount: { toString: () => '10.00' },
      dueDate: new Date('2026-11-01T00:00:00.000Z'),
      status: 'REPAID',
      createdAt: new Date('2026-10-20T00:00:00.000Z'),
      repaidAt: new Date('2026-10-21T00:00:00.000Z'),
    };
    const newLoan: TestLoan = {
      id: '22222222-2222-4222-8222-222222222222',
      userId: ownerId,
      friendName: 'Newer loan',
      amount: { toString: () => '1234.50' },
      dueDate: new Date('2026-12-01T00:00:00.000Z'),
      status: 'PENDING',
      createdAt: new Date('2026-10-22T00:00:00.000Z'),
      repaidAt: null,
    };
    const otherUserLoan: TestLoan = {
      ...newLoan,
      id: '33333333-3333-4333-8333-333333333333',
      userId: otherId,
      friendName: 'Private loan',
    };
    const { app: listingApp, ownerQueries: listingQueries } = createApp([oldLoan, otherUserLoan, newLoan]);
    await listingApp.ready();
    const ownerToken = listingApp.jwt.sign({ sub: ownerId });

    const response = await listingApp.inject({
      method: 'GET',
      url: `/loans?userId=${otherId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { userId: otherId },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(listingQueries, [ownerId]);
    assert.deepEqual(response.json(), [
      {
        id: newLoan.id,
        friendName: 'Newer loan',
        amount: '1234.50',
        dueDate: '2026-12-01',
        status: 'PENDING',
        createdAt: '2026-10-22T00:00:00.000Z',
        repaidAt: null,
      },
      {
        id: oldLoan.id,
        friendName: 'Older loan',
        amount: '10.00',
        dueDate: '2026-11-01',
        status: 'REPAID',
        createdAt: '2026-10-20T00:00:00.000Z',
        repaidAt: '2026-10-21T00:00:00.000Z',
      },
    ]);
    assert.equal(JSON.stringify(response.json()).includes('Private loan'), false);
    await listingApp.close();
  });

  it('returns an empty array when the authenticated user has no loans', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/loans',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), []);
    assert.deepEqual(ownerQueries, [ownerId]);
  });

  it('rejects missing or invalid tokens when listing loans', async () => {
    const missing = await app.inject({ method: 'GET', url: '/loans' });
    const invalid = await app.inject({
      method: 'GET',
      url: '/loans',
      headers: { authorization: 'Bearer invalid-token' },
    });

    assert.equal(missing.statusCode, 401);
    assert.equal(invalid.statusCode, 401);
    assert.deepEqual(ownerQueries, []);
  });

  it('marks an owned pending loan as repaid and scopes the update to id and owner', async () => {
    const loan: TestLoan = {
      id: '44444444-4444-4444-8444-444444444444',
      userId: ownerId,
      friendName: 'Repayment test',
      amount: { toString: () => '55.25' },
      dueDate: new Date('2026-11-01T00:00:00.000Z'),
      status: 'PENDING',
      createdAt: new Date('2026-10-22T00:00:00.000Z'),
      repaidAt: null,
    };
    const { app: repaymentApp, repayQueries: queries } = createApp([loan]);
    await repaymentApp.ready();
    const repaymentToken = repaymentApp.jwt.sign({ sub: ownerId });

    const response = await repaymentApp.inject({
      method: 'PATCH',
      url: `/loans/${loan.id}/repay`,
      headers: { authorization: `Bearer ${repaymentToken}` },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      id: loan.id,
      friendName: 'Repayment test',
      amount: '55.25',
      dueDate: '2026-11-01',
      status: 'REPAID',
      createdAt: '2026-10-22T00:00:00.000Z',
      repaidAt: '2026-10-23T12:00:00.000Z',
    });
    assert.deepEqual(queries, [{ id: loan.id, userId: ownerId }]);
    await repaymentApp.close();
  });

  it('rejects missing or invalid authentication on repayment', async () => {
    const missing = await app.inject({
      method: 'PATCH',
      url: '/loans/44444444-4444-4444-8444-444444444444/repay',
    });
    const invalid = await app.inject({
      method: 'PATCH',
      url: '/loans/44444444-4444-4444-8444-444444444444/repay',
      headers: { authorization: 'Bearer invalid-token' },
    });

    assert.equal(missing.statusCode, 401);
    assert.equal(invalid.statusCode, 401);
    assert.deepEqual(repayQueries, []);
  });

  it('returns 404 for a missing loan or another user loan', async () => {
    const otherUsersLoan: TestLoan = {
      id: '55555555-5555-4555-8555-555555555555',
      userId: otherId,
      friendName: 'Private loan',
      amount: { toString: () => '40.00' },
      dueDate: new Date('2026-12-01T00:00:00.000Z'),
      status: 'PENDING',
      createdAt: new Date('2026-10-22T00:00:00.000Z'),
      repaidAt: null,
    };
    const { app: repaymentApp } = createApp([otherUsersLoan]);
    await repaymentApp.ready();
    const repaymentToken = repaymentApp.jwt.sign({ sub: ownerId });

    for (const id of ['66666666-6666-4666-8666-666666666666', otherUsersLoan.id]) {
      const response = await repaymentApp.inject({
        method: 'PATCH',
        url: `/loans/${id}/repay`,
        headers: { authorization: `Bearer ${repaymentToken}` },
      });
      assert.equal(response.statusCode, 404);
      assert.deepEqual(response.json(), { error: 'Loan not found.' });
    }
    assert.equal(otherUsersLoan.status, 'PENDING');
    assert.equal(otherUsersLoan.repaidAt, null);
    await repaymentApp.close();
  });

  it('rejects malformed loan IDs', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/loans/not-a-uuid/repay',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'id must be a valid UUID.' });
    assert.deepEqual(repayQueries, []);
  });

  it('keeps the original repayment timestamp when repayment is repeated', async () => {
    const originalRepaidAt = new Date('2026-10-20T10:00:00.000Z');
    const loan: TestLoan = {
      id: '77777777-7777-4777-8777-777777777777',
      userId: ownerId,
      friendName: 'Already repaid',
      amount: { toString: () => '25.00' },
      dueDate: new Date('2026-10-01T00:00:00.000Z'),
      status: 'REPAID',
      createdAt: new Date('2026-09-22T00:00:00.000Z'),
      repaidAt: originalRepaidAt,
    };
    const { app: repaymentApp } = createApp([loan]);
    await repaymentApp.ready();
    const repaymentToken = repaymentApp.jwt.sign({ sub: ownerId });

    const response = await repaymentApp.inject({
      method: 'PATCH',
      url: `/loans/${loan.id}/repay`,
      headers: { authorization: `Bearer ${repaymentToken}` },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'REPAID');
    assert.equal(response.json().repaidAt, originalRepaidAt.toISOString());
    assert.equal(loan.repaidAt, originalRepaidAt);
    await repaymentApp.close();
  });

  it('creates a loan for the authenticated owner with exact amount', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/loans',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        friendName: '  Sam  ',
        amount: '1234.50',
        dueDate: '2026-11-30',
        userId: otherId,
      },
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), {
      id: 'f3a509a7-f84d-4080-9a68-9dc5a0cccb41',
      userId: ownerId,
      friendName: 'Sam',
      amount: '1234.50',
      dueDate: '2026-11-30',
      status: 'PENDING',
      createdAt: '2026-10-22T12:00:00.000Z',
      repaidAt: null,
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].userId, ownerId);
    assert.equal(created[0].amount, '1234.50');
  });

  it('rejects missing and invalid authentication tokens', async () => {
    const missing = await app.inject({ method: 'POST', url: '/loans', payload: {} });
    const invalid = await app.inject({
      method: 'POST',
      url: '/loans',
      headers: { authorization: 'Bearer invalid-token' },
      payload: {},
    });

    assert.equal(missing.statusCode, 401);
    assert.deepEqual(missing.json(), { error: 'Unauthorized.' });
    assert.equal(invalid.statusCode, 401);
    assert.deepEqual(invalid.json(), { error: 'Unauthorized.' });
    assert.equal(created.length, 0);
  });

  it('rejects missing or invalid fields with a consistent error', async () => {
    const missing = await app.inject({
      method: 'POST', url: '/loans', headers: { authorization: `Bearer ${token}` }, payload: {},
    });
    const emptyName = await app.inject({
      method: 'POST', url: '/loans', headers: { authorization: `Bearer ${token}` },
      payload: { friendName: '  ', amount: '10.00', dueDate: '2026-11-30' },
    });
    const tooLongName = await app.inject({
      method: 'POST', url: '/loans', headers: { authorization: `Bearer ${token}` },
      payload: { friendName: 'x'.repeat(101), amount: '10.00', dueDate: '2026-11-30' },
    });

    for (const response of [missing, emptyName, tooLongName]) {
      assert.equal(response.statusCode, 400);
      assert.equal(typeof response.json().error, 'string');
    }
    assert.equal(created.length, 0);
  });

  it('rejects zero, negative, over-precision, and over-range amounts', async () => {
    for (const amount of ['0', '-2.00', '1.001', '10000000000.00']) {
      const response = await app.inject({
        method: 'POST', url: '/loans', headers: { authorization: `Bearer ${token}` },
        payload: { friendName: 'Sam', amount, dueDate: '2026-11-30' },
      });
      assert.equal(response.statusCode, 400, `expected ${amount} to be rejected`);
      assert.equal(typeof response.json().error, 'string');
    }
    assert.equal(created.length, 0);
  });

  it('rejects invalid or non-ISO due dates', async () => {
    for (const dueDate of ['not-a-date', '2026-02-30', '2026-11-30T00:00:00Z', '11/30/2026']) {
      const response = await app.inject({
        method: 'POST', url: '/loans', headers: { authorization: `Bearer ${token}` },
        payload: { friendName: 'Sam', amount: '10.00', dueDate },
      });
      assert.equal(response.statusCode, 400, `expected ${dueDate} to be rejected`);
      assert.equal(typeof response.json().error, 'string');
    }
    assert.equal(created.length, 0);
  });

  it('rejects a non-string monetary amount to avoid floating-point ambiguity', async () => {
    const response = await app.inject({
      method: 'POST', url: '/loans', headers: { authorization: `Bearer ${token}` },
      payload: { friendName: 'Sam', amount: 0.1 + 0.2, dueDate: '2026-11-30' },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(created.length, 0);
  });
});
