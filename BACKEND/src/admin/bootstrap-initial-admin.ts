import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { userInfo } from 'node:os';
import {
  IsBoolean,
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  validate,
} from 'class-validator';

class BootstrapAdminDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @IsBoolean()
  apply: boolean;
}

type AuthIdentity = {
  id: string;
  email?: string;
  confirmed: boolean;
  banned: boolean;
};
type BootstrapResult = {
  userId: string;
  status: 'DRY_RUN' | 'PROVISIONED' | 'ALREADY_ADMIN';
};

/** Server-operator CLI only; never expose as a customer/admin HTTP endpoint. */
export async function bootstrapInitialAdmin(
  prisma: PrismaClient,
  verifyIdentity: (userId: string) => Promise<AuthIdentity>,
  input: { email: string; reason: string; apply: boolean },
): Promise<BootstrapResult> {
  const dto = Object.assign(new BootstrapAdminDto(), {
    ...input,
    email:
      typeof input.email === 'string'
        ? input.email.trim().toLowerCase()
        : input.email,
    reason:
      typeof input.reason === 'string' ? input.reason.trim() : input.reason,
  });
  if (
    (await validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
      .length
  ) {
    throw new BadRequestException(
      'Invalid admin email, reason or apply option',
    );
  }
  const account = await prisma.user.findUnique({
    where: { email: dto.email },
    select: { id: true, email: true, role: true, isSuspended: true },
  });
  if (!account)
    throw new BadRequestException('Select an existing TRUSTPAY account');
  if (account.isSuspended)
    throw new BadRequestException(
      'A suspended account cannot become an administrator',
    );
  const identity = await verifyIdentity(account.id);
  if (
    identity.id !== account.id ||
    identity.email?.trim().toLowerCase() !== dto.email
  ) {
    throw new BadRequestException(
      'The authentication identity must match the selected account',
    );
  }
  if (!identity.confirmed || identity.banned) {
    throw new BadRequestException(
      'An active, confirmed authentication identity is required',
    );
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx): Promise<BootstrapResult> => {
          const current = await tx.user.findUnique({
            where: { id: account.id },
            select: { email: true, role: true, isSuspended: true },
          });
          if (
            !current ||
            current.email.toLowerCase() !== dto.email ||
            current.isSuspended
          ) {
            throw new ConflictException(
              'The selected account changed; review setup again',
            );
          }
          if (current.role === 'ADMIN')
            return { userId: account.id, status: 'ALREADY_ADMIN' };
          if (await tx.user.count({ where: { role: 'ADMIN' } })) {
            throw new ConflictException(
              'An administrator already exists; use the established access process',
            );
          }
          if (!dto.apply) return { userId: account.id, status: 'DRY_RUN' };
          const updated = await tx.user.updateMany({
            where: { id: account.id, role: 'USER', isSuspended: false },
            data: { role: 'ADMIN' },
          });
          if (updated.count !== 1)
            throw new ConflictException(
              'The selected account changed; review setup again',
            );
          await tx.auditLog.create({
            data: {
              action: 'INITIAL_ADMIN_PROVISIONED',
              targetType: 'User',
              targetId: account.id,
              reference: `initial-admin:${account.id}`,
              reason: dto.reason,
              before: { role: 'USER' },
              after: { role: 'ADMIN' },
              metadata: {
                source: 'server-operator-cli',
                operatorProcessUser: userInfo().username,
                confirmedAuthIdentity: true,
              },
            },
          });
          return { userId: account.id, status: 'PROVISIONED' };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 5000,
        },
      );
    } catch (error: unknown) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        continue;
      throw error;
    }
  }
}
