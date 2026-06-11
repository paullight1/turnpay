import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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

    return this.prisma.user.update({
      where: { id },
      data: {
        ...updateUserDto,
        ...(updateUserDto.phone ? { phone: updateUserDto.phone.trim() } : {}),
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
