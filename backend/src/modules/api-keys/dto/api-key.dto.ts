import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALL_API_SCOPES } from '../../../common/api-scopes';

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(64)
  applicationId: string;

  @IsIn(['SECRET', 'PUBLISHABLE'])
  type: 'SECRET' | 'PUBLISHABLE';

  /** Permissions d'une cle secrete. Par defaut : toutes. Ignore pour une cle publique. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn([...ALL_API_SCOPES], { each: true })
  permissions?: string[];
}
