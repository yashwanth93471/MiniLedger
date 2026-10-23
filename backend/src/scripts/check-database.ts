import 'dotenv/config';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('Database connection failed: DATABASE_URL is not configured.');
    process.exitCode = 1;
    return;
  }

  const { prisma } = await import('../db/prisma.js');

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('Database connection successful.');
  } catch {
    console.error('Database connection failed. Check PostgreSQL availability and local credentials.');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
