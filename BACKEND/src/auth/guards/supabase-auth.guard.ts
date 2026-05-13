import { Injectable } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

@Injectable()
export class SupabaseAuthGuard extends JwtAuthGuard {}
