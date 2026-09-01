import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: { userId: string }) {
    return this.usersService.findOne(user.userId);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: { userId: string },
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(user.userId, updateUserDto);
  }

  @Get()
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async findAll() {
    return this.usersService.findAll();
  }
}
