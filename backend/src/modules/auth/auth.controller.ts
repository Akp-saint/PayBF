import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/auth.decorators';
import type { AuthUser } from '../../common/auth.types';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { getRequestContext } from '../../common/request-context';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('dashboard/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowSeconds: 60, by: 'ip', name: 'auth-register' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, getRequestContext(req));
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, by: 'ip', name: 'auth-login' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, getRequestContext(req));
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'ip', name: 'auth-refresh' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, getRequestContext(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @Req() req: Request): Promise<void> {
    await this.auth.logout(dto.refreshToken, getRequestContext(req));
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
