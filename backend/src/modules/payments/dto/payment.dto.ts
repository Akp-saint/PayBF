import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const URL_OPTIONS = { require_protocol: true, protocols: ['http', 'https'], require_tld: false };

export class PaymentCustomerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?[0-9 ]{8,15}$/, { message: 'phone doit etre un numero valide (8 a 15 chiffres)' })
  phone?: string;
}

export class CreatePaymentDto {
  /** Montant en FCFA (entier, pas de decimales). */
  @IsInt()
  @Min(100)
  @Max(50_000_000)
  amount: number;

  @IsIn(['XOF'])
  currency: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentCustomerDto)
  customer?: PaymentCustomerDto;

  @IsOptional()
  @IsIn(['mobile_money', 'card'])
  payment_method?: 'mobile_money' | 'card';

  @IsOptional()
  @IsString()
  @Matches(/^[a-z_]{2,30}$/)
  provider?: string;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(500)
  success_url?: string;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(500)
  cancel_url?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ListPaymentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  starting_after?: string;
}
