import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentApiKey, RequireScopes } from '../../common/api-key.decorators';
import { ApiKeyGuard } from '../../common/api-key.guard';
import type { ApiKeyContext } from '../../common/api-key.types';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @RequireScopes('customers:write')
  create(@CurrentApiKey() apiKey: ApiKeyContext, @Body() dto: CreateCustomerDto) {
    return this.customers.create(apiKey, dto);
  }

  @Get(':id')
  @RequireScopes('customers:read')
  get(@CurrentApiKey() apiKey: ApiKeyContext, @Param('id') id: string) {
    return this.customers.get(apiKey, id);
  }
}
