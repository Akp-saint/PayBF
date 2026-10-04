import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class CheckoutPayDto {
  @IsString()
  @Matches(/^[a-z_]{2,30}$/)
  provider: string;

  /** Numero Mobile Money ou jeton de carte de test (tok_success, tok_declined...). Jamais de PIN. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[A-Za-z0-9+ _-]{4,40}$/, { message: 'payer invalide' })
  payer: string;
}
