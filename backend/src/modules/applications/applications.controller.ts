import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions } from '../../common/auth.decorators';
import type { AuthUser } from '../../common/auth.types';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionsGuard } from '../../common/permissions.guard';
import { getRequestContext } from '../../common/request-context';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/application.dto';

@ApiTags('applications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard/applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @RequirePermissions('applications:read')
  list(@CurrentUser() user: AuthUser) {
    return this.applications.list(user);
  }

  @Get(':id')
  @RequirePermissions('applications:read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.applications.get(user, id);
  }

  @Post()
  @RequirePermissions('applications:write')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApplicationDto, @Req() req: Request) {
    return this.applications.create(user, dto, getRequestContext(req));
  }
}
