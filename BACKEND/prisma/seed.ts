import {
  PrismaClient,
  UserRole,
  KYCStatus,
  WalletCurrency,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  // Guard: never run destructive/seed tooling against production data unless
  // explicitly overridden.
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.SEED_ALLOW !== 'true'
  ) {
    console.error(
      '⛔ Refusing to seed in production. Set SEED_ALLOW=true to override.',
    );
    process.exit(1);
  }

  console.log('🌱 Seeding database...');

  // Admin password comes from the environment; if unset we generate a strong
  // random one and print it once instead of shipping a hardcoded credential.
  const adminPasswordGenerated = !process.env.SEED_ADMIN_PASSWORD;
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD || randomBytes(18).toString('base64url');
  if (adminPasswordGenerated) {
    console.log(
      '⚠️  SEED_ADMIN_PASSWORD not set — generated a random admin password for this run.',
    );
    console.log(
      `   One-time admin password (save it now, set SEED_ADMIN_PASSWORD to control it): ${adminPassword}`,
    );
  }

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@trustpay.com' },
  });

  const hashedPassword = await bcrypt.hash(adminPassword, 12);
  const hashedUserPassword = await bcrypt.hash('UserPass123', 12);

  if (existingAdmin) {
    await prisma.user.update({
      where: { email: 'admin@trustpay.com' },
      data: {
        phone: '+2348000000000',
        password: hashedPassword,
        role: UserRole.ADMIN,
        kycStatus: KYCStatus.VERIFIED,
      },
    });

    console.log('✅ Admin user already existed, updated seed data.');
    return;
  }

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      email: 'admin@trustpay.com',
      phone: '+2348000000000',
      password: hashedPassword,
      role: UserRole.ADMIN,
      kycStatus: KYCStatus.VERIFIED,
    },
  });

  console.log(`✅ Admin created: ${admin.email}`);

  // Create test users
  const testUsers = [
    {
      email: 'user@trustpay.com',
      phone: '+2348011111111',
      password: hashedUserPassword,
      role: UserRole.USER,
      kycStatus: KYCStatus.PENDING,
    },
    {
      email: 'verified@trustpay.com',
      phone: '+2348022222222',
      password: hashedUserPassword,
      role: UserRole.USER,
      kycStatus: KYCStatus.VERIFIED,
    },
  ];

  const users: any[] = [];
  for (const userData of testUsers) {
    const user = await prisma.user.create({ data: userData });
    users.push(user);
    console.log(`✅ User created: ${user.email}`);

    // Create wallets for each user
    await prisma.wallet.create({
      data: {
        userId: user.id,
        currency: WalletCurrency.NGN,
        balance: 100000,
      },
    });

    await prisma.wallet.create({
      data: {
        userId: user.id,
        currency: WalletCurrency.GHS,
        balance: 5000,
      },
    });

    console.log(`   💰 Wallets created for ${user.email}`);
  }

  // Create admin wallets
  await prisma.wallet.create({
    data: {
      userId: admin.id,
      currency: WalletCurrency.NGN,
      balance: 1000000,
    },
  });

  await prisma.wallet.create({
    data: {
      userId: admin.id,
      currency: WalletCurrency.GHS,
      balance: 50000,
    },
  });

  // Create sample rates
  await prisma.rate.createMany({
    data: [
      {
        from: 'GHS',
        to: 'NGN',
        rate: '3.1746',
        markup: '2.5',
        source: 'system',
      },
      {
        from: 'NGN',
        to: 'GHS',
        rate: '0.3150',
        markup: '2.5',
        source: 'system',
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ FX rates seeded');

  // Create sample services
  await prisma.service.createMany({
    data: [
      { name: 'MTN', type: 'airtime', provider: 'mtn', isActive: true },
      { name: 'Airtel', type: 'airtime', provider: 'airtel', isActive: true },
      { name: 'Glo', type: 'airtime', provider: 'glo', isActive: true },
      { name: 'DStv', type: 'cable', provider: 'dstv', isActive: true },
      { name: 'GOtv', type: 'cable', provider: 'gotv', isActive: true },
      {
        name: 'StarTimes',
        type: 'cable',
        provider: 'startimes',
        isActive: true,
      },
      {
        name: 'Ikeja Electric',
        type: 'electricity',
        provider: 'ikedc',
        isActive: true,
      },
      {
        name: 'Eko Electric',
        type: 'electricity',
        provider: 'ekedc',
        isActive: true,
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ VTU services seeded');

  console.log('\n🎉 Seed completed!');
  console.log('\n📋 Test Accounts:');
  console.log(
    adminPasswordGenerated
      ? `   Admin: admin@trustpay.com / ${adminPassword} (generated — save it now)`
      : '   Admin: admin@trustpay.com / (value of SEED_ADMIN_PASSWORD)',
  );
  console.log('   User:  user@trustpay.com / UserPass123');
  console.log('   User:  verified@trustpay.com / UserPass123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
