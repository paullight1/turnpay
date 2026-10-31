import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { PinoLogger } from 'nestjs-pino';
import { HttpException } from '@nestjs/common';
import { bootstrapInitialAdmin } from '../src/admin/bootstrap-initial-admin';

const logger = new PinoLogger({ pinoHttp: { level: 'info' } });
const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      'Development: npm run admin:bootstrap -- --email STAFF_EMAIL --reason "Owner authorization" [--apply]\nProduction image: npm run admin:bootstrap:prod -- --email STAFF_EMAIL --reason "Owner authorization" [--apply]\nDry run is the default. The existing confirmed account receives the full ADMIN role.\n',
    );
    return;
  }
  const options: Record<string, string> = {};
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') {
      apply = true;
      continue;
    }
    if (
      !['--email', '--reason'].includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--') ||
      options[args[i]]
    ) {
      throw new Error('Invalid arguments. Use --help.');
    }
    options[args[i]] = args[++i];
  }
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret)
    throw new Error(
      'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server first',
    );
  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await bootstrapInitialAdmin(
    prisma,
    async (userId) => {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !data.user)
        throw new Error(
          'Unable to verify the existing authentication identity',
        );
      const user = data.user;
      const bannedUntil = (user as typeof user & { banned_until?: string })
        .banned_until;
      return {
        id: user.id,
        email: user.email,
        confirmed: Boolean(user.email_confirmed_at),
        banned: Boolean(bannedUntil && Date.parse(bannedUntil) > Date.now()),
      };
    },
    { email: options['--email'], reason: options['--reason'], apply },
  );
  logger.info(result, 'Initial administrator setup result');
}

void main()
  .catch((error: unknown) => {
    const message =
      error instanceof HttpException
        ? error.message
        : error instanceof Error && !error.name.startsWith('Prisma')
          ? error.message
          : 'Administrator setup failed; check server configuration';
    logger.error({ message }, 'Initial administrator setup failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
