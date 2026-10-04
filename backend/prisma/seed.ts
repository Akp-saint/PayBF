import { PricingModel, PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// Tarifs SANDBOX : valeurs de demonstration, calculs simules uniquement (aucune facturation reelle).
const PLANS = [
  { name: 'FREE', model: PricingModel.PERCENT, percentBps: 200, fixedFee: 0n, monthlyFee: 0n, txLimit: 100 },
  { name: 'STARTER', model: PricingModel.PERCENT, percentBps: 150, fixedFee: 0n, monthlyFee: 10_000n, txLimit: 2_000 },
  { name: 'BUSINESS', model: PricingModel.PERCENT_PLUS_FIXED, percentBps: 120, fixedFee: 25n, monthlyFee: 50_000n, txLimit: null },
  { name: 'ENTERPRISE', model: PricingModel.CUSTOM, percentBps: 100, fixedFee: 0n, monthlyFee: 0n, txLimit: null },
];

async function main(): Promise<void> {
  for (const plan of PLANS) {
    await prisma.pricingPlan.upsert({ where: { name: plan.name }, update: {}, create: plan });
  }

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD doit contenir au moins 12 caracteres');
    await prisma.user.upsert({
      where: { email: email.toLowerCase() },
      update: {},
      create: {
        email: email.toLowerCase(),
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        name: 'Administrateur PayBF',
        role: UserRole.PLATFORM_ADMIN,
      },
    });
    console.log(`Admin plateforme pret : ${email}`);
  } else {
    console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD absents : aucun admin plateforme cree.');
  }
  console.log('Plans tarifaires sandbox crees : FREE, STARTER, BUSINESS, ENTERPRISE');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
