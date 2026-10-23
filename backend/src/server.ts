import 'dotenv/config';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { prisma } from './db/prisma';
import { OtpService } from './auth/otp-service';
import authRoutes from './routes/auth';
import loanRoutes from './routes/loans';

async function start(): Promise<void> {
  const jwtSecret = process.env.JWT_SECRET;
  const otpSecret = process.env.OTP_SECRET;

  if (!jwtSecret || !otpSecret) {
    throw new Error('JWT_SECRET and OTP_SECRET must be configured');
  }

  const app = Fastify({ logger: true });
  const otpService = new OtpService({
    secret: otpSecret,
    logCode: (phoneNumber, code) => app.log.info({ phoneNumber, otp: code }, 'Mock OTP issued'),
  });

  await app.register(jwt, { secret: jwtSecret });
  await app.register(authRoutes, {
    prefix: '/auth',
    otpService,
    users: {
      async upsert(phoneNumber) {
        return prisma.user.upsert({
          where: { phoneNumber },
          create: { phoneNumber },
          update: {},
          select: { id: true, phoneNumber: true },
        });
      },
    },
  });
  await app.register(loanRoutes, {
    createLoan: async (data) => prisma.loan.create({ data }),
    listLoans: async (userId) => prisma.loan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        friendName: true,
        amount: true,
        dueDate: true,
        status: true,
        createdAt: true,
        repaidAt: true,
      },
    }),
    summarizeLoans: async (userId, today) => {
      const [allLoans, repaidLoans, overdueLoans] = await Promise.all([
        prisma.loan.aggregate({ where: { userId }, _sum: { amount: true } }),
        prisma.loan.aggregate({ where: { userId, status: 'REPAID' }, _sum: { amount: true } }),
        prisma.loan.aggregate({
          where: { userId, status: 'PENDING', dueDate: { lt: today } },
          _sum: { amount: true },
        }),
      ]);

      return {
        totalLent: allLoans._sum.amount?.toString() ?? '0.00',
        totalRepaid: repaidLoans._sum.amount?.toString() ?? '0.00',
        overdueAmount: overdueLoans._sum.amount?.toString() ?? '0.00',
      };
    },
    getToday: () => new Date(),
    repayLoan: async (id, userId) => prisma.$transaction(async (tx) => {
      const updated = await tx.loan.updateMany({
        where: { id, userId, status: 'PENDING' },
        data: { status: 'REPAID', repaidAt: new Date() },
      });

      return tx.loan.findFirst({
        where: updated.count > 0
          ? { id, userId }
          : { id, userId, status: 'REPAID' },
      });
    }),
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'miniledger-api',
  }));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port });
}

start().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
