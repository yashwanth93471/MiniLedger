import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '../generated/prisma/client';
import type { LoanStatus } from '../generated/prisma/enums';

const friendNameMaxLength = 100;
const amountPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

interface LoanRecord {
  id: string;
  userId: string;
  friendName: string;
  amount: { toString(): string };
  dueDate: Date;
  status: LoanStatus;
  createdAt: Date;
  repaidAt: Date | null;
}

interface LoanRouteOptions {
  createLoan(data: {
    userId: string;
    friendName: string;
    amount: string;
    dueDate: Date;
  }): Promise<LoanRecord>;
  listLoans(userId: string): Promise<LoanRecord[]>;
  repayLoan(id: string, userId: string): Promise<LoanRecord | null>;
  summarizeLoans(userId: string, today: Date): Promise<{
    totalLent: string;
    totalRepaid: string;
    overdueAmount: string;
  }>;
  getToday?: () => Date;
}

function isValidDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const loanRoutes: FastifyPluginAsync<LoanRouteOptions> = async (app, options) => {
  app.get('/loans/summary', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const userId = request.user.sub;
    if (typeof userId !== 'string' || !userId) {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const now = options.getToday?.() ?? new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const summary = await options.summarizeLoans(userId, today);
    return {
      totalLent: new Prisma.Decimal(summary.totalLent).toFixed(2),
      totalRepaid: new Prisma.Decimal(summary.totalRepaid).toFixed(2),
      overdueAmount: new Prisma.Decimal(summary.overdueAmount).toFixed(2),
    };
  });

  app.patch<{ Params: { id: string } }>('/loans/:id/repay', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const { id } = request.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return reply.code(400).send({ error: 'id must be a valid UUID.' });
    }

    const userId = request.user.sub;
    if (typeof userId !== 'string' || !userId) {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const loan = await options.repayLoan(id, userId);
    if (!loan) {
      return reply.code(404).send({ error: 'Loan not found.' });
    }

    return reply.send({
      id: loan.id,
      friendName: loan.friendName,
      amount: loan.amount.toString(),
      dueDate: loan.dueDate.toISOString().slice(0, 10),
      status: loan.status,
      createdAt: loan.createdAt,
      repaidAt: loan.repaidAt,
    });
  });

  app.get('/loans', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const userId = request.user.sub;
    if (typeof userId !== 'string' || !userId) {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const loans = await options.listLoans(userId);
    return loans.map((loan) => ({
      id: loan.id,
      friendName: loan.friendName,
      amount: loan.amount.toString(),
      dueDate: loan.dueDate.toISOString().slice(0, 10),
      status: loan.status,
      createdAt: loan.createdAt,
      repaidAt: loan.repaidAt,
    }));
  });

  app.post<{ Body: { friendName?: unknown; amount?: unknown; dueDate?: unknown } }>('/loans', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const body = request.body ?? {};
    const friendName = typeof body?.friendName === 'string' ? body.friendName.trim() : '';
    if (friendName.length === 0 || friendName.length > friendNameMaxLength) {
      return reply.code(400).send({ error: 'friendName must contain 1 to 100 characters.' });
    }

    const amount = typeof body.amount === 'string' ? body.amount : '';
    if (!amountPattern.test(amount) || Number(amount) <= 0) {
      return reply.code(400).send({ error: 'amount must be a positive decimal string with up to 2 decimal places.' });
    }

    if (typeof body.dueDate !== 'string' || !isValidDate(body.dueDate)) {
      return reply.code(400).send({ error: 'dueDate must be a valid ISO date in YYYY-MM-DD format.' });
    }

    const userId = request.user.sub;
    if (typeof userId !== 'string' || !userId) {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const loan = await options.createLoan({
      userId,
      friendName,
      amount,
      dueDate: new Date(`${body.dueDate}T00:00:00.000Z`),
    });

    return reply.code(201).send({
      id: loan.id,
      userId: loan.userId,
      friendName: loan.friendName,
      amount: loan.amount.toString(),
      dueDate: loan.dueDate.toISOString().slice(0, 10),
      status: loan.status,
      createdAt: loan.createdAt,
      repaidAt: loan.repaidAt,
    });
  });
};

export default loanRoutes;
