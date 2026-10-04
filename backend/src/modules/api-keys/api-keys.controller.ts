import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../../common/auth.decorators';
import type { AuthUser } from '../../common/auth.types';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionsGuard } from '../../common/permissions.guard';
import { getRequestContext } from '../../common/request-context';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@ApiTags('api-keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('apikeys:manage')
@Controller('dashboard/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.keys.list(user);
  }

  /** Le champ `secret` n'est renvoye qu'ici, une seule fois. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto, @Req() req: Request) {
    return this.keys.create(user, dto, getRequestContext(req));
  }

  @Post(':id/rotate')
  @HttpCode(200)
  rotate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.keys.rotate(user, id, getRequestContext(req));
  }

  @Delete(':id')
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.keys.revoke(user, id, getRequestContext(req));
  }
}
