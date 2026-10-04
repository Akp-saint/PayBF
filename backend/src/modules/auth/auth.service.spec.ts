import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService, hashToken } from './auth.service';

const CONFIG: Record<string, string> = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
};

function build() {
  const tx = {
    merchant: { create: jest.fn().mockResolvedValue({ id: 'mer_1' }) },
    user: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'usr_1', ...data }),
      ),
    },
    application: { create: jest.fn().mockResolvedValue({ id: 'app_1' }) },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    user: { findUnique: jest.fn() },
    refreshToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
  const config = { get: (k: string) => CONFIG[k], getOrThrow: (k: string) => CONFIG[k] };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AuthService(prisma as never, jwt as never, config as never, audit as never);
  return { service, prisma, tx, jwt, audit };
}

describe('AuthService', () => {
  describe('register', () => {
    it('cree marchand + proprietaire + application et stocke un hash Argon2id (jamais le mot de passe)', async () => {
      const { service, tx } = build();
      const { user, tokens } = await service.register(
        { email: 'dev@example.com', password: 'motdepasse-solide', name: 'Dev', merchantName: 'Ma Boutique' },
        {},
      );
      const stored = tx.user.create.mock.calls[0][0].data;
      expect(stored.passwordHash).not.toContain('motdepasse-solide');
      expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(stored.role).toBe('OWNER');
      expect(tx.application.create).toHaveBeenCalled();
      expect(user).not.toHaveProperty('passwordHash');
      expect(tokens.accessToken).toBe('signed.jwt.token');
      expect(tokens.refreshToken.length).toBeGreaterThan(40);
    });

    it('refuse un email deja utilise (409)', async () => {
      const { service, prisma } = build();
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(
        service.register({ email: 'a@b.co', password: 'motdepasse-solide', name: 'A', merchantName: 'M' }, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('accepte les bons identifiants', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr_1',
        email: 'a@b.co',
        name: 'A',
        role: 'OWNER',
        merchantId: 'mer_1',
        passwordHash: await argon2.hash('bon-mot-de-passe', { type: argon2.argon2id }),
      });
      const { tokens } = await service.login({ email: 'a@b.co', password: 'bon-mot-de-passe' }, {});
      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.expiresIn).toBe(900);
    });

    it('refuse un mauvais mot de passe (401) et journalise l\'echec', async () => {
      const { service, prisma, audit } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr_1',
        merchantId: 'mer_1',
        passwordHash: await argon2.hash('bon-mot-de-passe', { type: argon2.argon2id }),
      });
      await expect(service.login({ email: 'a@b.co', password: 'mauvais' }, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login_failed' }));
    });

    it('renvoie le meme message pour un email inconnu (pas d\'enumeration de comptes)', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'nobody@x.co', password: 'peu-importe' }, {})).rejects.toThrow(
        'Email ou mot de passe incorrect',
      );
    });
  });

  describe('refresh', () => {
    const activeRecord = (over: object = {}) => ({
      id: 'rt_1',
      userId: 'usr_1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'usr_1', role: 'OWNER', merchantId: 'mer_1' },
      ...over,
    });

    it('revoque l\'ancien jeton et en emet un nouveau (rotation)', async () => {
      const { service, prisma } = build();
      prisma.refreshToken.findUnique.mockResolvedValue(activeRecord());
      const tokens = await service.refresh('old-token-value-xxxxxxxxxxxxxxxx', {});
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hashToken('old-token-value-xxxxxxxxxxxxxxxx') } }),
      );
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rt_1' } }),
      );
      expect(tokens.refreshToken).not.toBe('old-token-value-xxxxxxxxxxxxxxxx');
    });

    it('detecte le rejeu d\'un jeton revoque et revoque toutes les sessions', async () => {
      const { service, prisma, audit } = build();
      prisma.refreshToken.findUnique.mockResolvedValue(activeRecord({ revokedAt: new Date() }));
      await expect(service.refresh('reused-token-xxxxxxxxxxxxxxxxxxx', {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'usr_1', revokedAt: null } }),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.refresh_reuse_detected' }));
    });

    it('refuse un jeton expire ou inconnu', async () => {
      const { service, prisma } = build();
      prisma.refreshToken.findUnique.mockResolvedValue(activeRecord({ expiresAt: new Date(Date.now() - 1) }));
      await expect(service.refresh('expired-token-xxxxxxxxxxxxxxxxxx', {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('unknown-token-xxxxxxxxxxxxxxxxxx', {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
