import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import type { AccessTokenPayload } from '../../common/auth.types';
import { parseDurationMs } from '../../common/duration';
import type { RequestContext } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  merchantId: string | null;
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'marchand';

@Injectable()
export class AuthService {
  /** Hash factice pour garder un temps de reponse comparable quand l'email n'existe pas. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto, ctx: RequestContext): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    let user: User;
    let merchantId: string;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const merchant = await tx.merchant.create({
          data: { name: dto.merchantName, slug: `${slugify(dto.merchantName)}-${randomBytes(3).toString('hex')}` },
        });
        const owner = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            name: dto.name,
            role: UserRole.OWNER,
            merchantId: merchant.id,
          },
        });
        await tx.application.create({
          data: { merchantId: merchant.id, name: 'Application par defaut', environment: 'TEST' },
        });
        return { owner, merchantId: merchant.id };
      });
      user = created.owner;
      merchantId = created.merchantId;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Un compte existe deja avec cet email');
      }
      throw error;
    }

    await this.audit.log({
      action: 'auth.register',
      actorType: 'user',
      actorId: user.id,
      merchantId,
      resource: `merchant:${merchantId}`,
      context: ctx,
    });
    return { user: this.toPublic(user), tokens: await this.issueTokens(user) };
  }

  async login(dto: LoginDto, ctx: RequestContext): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = user
      ? await argon2.verify(user.passwordHash, dto.password)
      : (await argon2.verify(await this.getDummyHash(), dto.password), false);

    if (!user || !valid) {
      await this.audit.log({
        action: 'auth.login_failed',
        actorType: 'user',
        actorId: user?.id,
        merchantId: user?.merchantId,
        context: ctx,
      });
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    await this.audit.log({
      action: 'auth.login',
      actorType: 'user',
      actorId: user.id,
      merchantId: user.merchantId,
      context: ctx,
    });
    return { user: this.toPublic(user), tokens: await this.issueTokens(user) };
  }

  /** Rotation : chaque refresh token n'est utilisable qu'une fois. Un rejeu revoque toutes les sessions. */
  async refresh(refreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!record) throw new UnauthorizedException('Jeton de rafraichissement invalide');

    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log({
        action: 'auth.refresh_reuse_detected',
        actorType: 'user',
        actorId: record.userId,
        merchantId: record.user.merchantId,
        context: ctx,
      });
      throw new UnauthorizedException('Jeton de rafraichissement invalide');
    }
    if (record.expiresAt <= new Date()) {
      throw new UnauthorizedException('Jeton de rafraichissement expire');
    }

    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(record.user);
  }

  async logout(refreshToken: string, ctx: RequestContext): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    if (!record || record.revokedAt) return;
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    await this.audit.log({ action: 'auth.logout', actorType: 'user', actorId: record.userId, context: ctx });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    return this.toPublic(user);
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '30d';
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, merchantId: user.merchantId };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: Math.floor(parseDurationMs(accessTtl) / 1000),
    });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDurationMs(refreshTtl)),
      },
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Math.floor(parseDurationMs(accessTtl) / 1000),
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash('paybf-dummy-password', { type: argon2.argon2id });
    return this.dummyHash;
  }

  private toPublic(user: User): PublicUser {
    return { id: user.id, email: user.email, name: user.name, role: user.role, merchantId: user.merchantId };
  }
}
