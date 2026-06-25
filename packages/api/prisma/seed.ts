import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/hash.js';

// Seed the first ADMIN from env (plan §10). Idempotent: upsert by email.
loadDotenv();

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the admin.');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  }

  const passwordHash = await hashPassword(password);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', status: 'ACTIVE' },
    create: { email, passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });

  console.log(`Seeded admin: ${admin.email} (id=${admin.id})`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
