import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const user = await this.prisma.user.create({
      data: {
        id: createUserDto.id,
        email: createUserDto.email,
        phone: createUserDto.phone || '',
        fullName: createUserDto.fullName,
        password: createUserDto.password || '',
      },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        yearOfBirth: true,
        country: true,
        profileDetailsUpdatedAt: true,
        role: true,
        kycStatus: true,
        kycTier: true,
        createdAt: true,
      },
    });

    return user;
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        yearOfBirth: true,
        country: true,
        profileDetailsUpdatedAt: true,
        role: true,
        kycStatus: true,
        kycTier: true,
        createdAt: true,
        wallets: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const existing = await this.findOne(id);
    const identityFields: Array<keyof UpdateUserDto> = [
      'fullName',
      'phone',
      'yearOfBirth',
      'country',
    ];
    const updatesIdentity = identityFields.some(
      (field) => updateUserDto[field] !== undefined,
    );

    if (updatesIdentity && existing.kycStatus === 'VERIFIED') {
      throw new ConflictException(
        'Verified identity details require a support-assisted re-verification',
      );
    }

    if (updatesIdentity && existing.profileDetailsUpdatedAt) {
      throw new ConflictException(
        'Profile identity details can only be updated once',
      );
    }

    const nextCountry = (updateUserDto.country ?? existing.country ?? '')
      .trim()
      .toUpperCase();
    const nextPhone = (updateUserDto.phone ?? existing.phone ?? '').trim();
    if (
      updateUserDto.phone !== undefined ||
      updateUserDto.country !== undefined
    ) {
      this.assertPhoneMatchesCountry(nextCountry, nextPhone);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id },
          data: {
            ...updateUserDto,
            ...(updateUserDto.phone
              ? { phone: updateUserDto.phone.trim() }
              : {}),
            ...(updateUserDto.country
              ? { country: updateUserDto.country.trim().toUpperCase() }
              : {}),
            ...(updatesIdentity ? { profileDetailsUpdatedAt: new Date() } : {}),
          },
          select: {
            id: true,
            email: true,
            phone: true,
            fullName: true,
            yearOfBirth: true,
            country: true,
            profileDetailsUpdatedAt: true,
            role: true,
            kycStatus: true,
            kycTier: true,
            updatedAt: true,
          },
        });

        if (updatesIdentity) {
          await tx.auditLog.create({
            data: {
              action: 'user_identity_profile_updated',
              targetType: 'USER',
              targetId: id,
              before: {
                fullName: existing.fullName,
                phone: existing.phone,
                yearOfBirth: existing.yearOfBirth,
                country: existing.country,
              },
              after: {
                fullName: updated.fullName,
                phone: updated.phone,
                yearOfBirth: updated.yearOfBirth,
                country: updated.country,
              },
              metadata: { actorUserId: id },
            },
          });
        }

        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target;
        if (
          (Array.isArray(target) && target.includes('phone')) ||
          target === 'users_phone_key'
        ) {
          throw new ConflictException({
            code: 'PROFILE_PHONE_IN_USE',
            message:
              'This phone number is already linked to another account. Use your own registered number or contact support.',
          });
        }
      }
      throw error;
    }
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          phone: true,
          fullName: true,
          yearOfBirth: true,
          country: true,
          profileDetailsUpdatedAt: true,
          role: true,
          kycStatus: true,
          kycTier: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);

    return { users, total, page, limit };
  }

  private assertPhoneMatchesCountry(country: string, phone: string) {
    const rules: Record<string, { pattern: RegExp; example: string }> = {
      NG: {
        pattern: /^\+234\d{10}$/,
        example: '+2348012345678',
      },
      GH: {
        pattern: /^\+233\d{9}$/,
        example: '+233241234567',
      },
    };

    const rule = rules[country];
    if (!rule) {
      throw new BadRequestException('Select Nigeria or Ghana before saving');
    }

    if (!rule.pattern.test(phone)) {
      throw new BadRequestException(
        `Phone number must match ${country}. Example: ${rule.example}`,
      );
    }
  }
}
