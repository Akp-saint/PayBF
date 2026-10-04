import { hasPermissions, ROLE_PERMISSIONS } from './permissions';

describe('permissions (RBAC)', () => {
  it('un lecteur peut lire mais ni creer d\'application ni gerer les cles', () => {
    expect(hasPermissions('VIEWER', ['applications:read'])).toBe(true);
    expect(hasPermissions('VIEWER', ['applications:write'])).toBe(false);
    expect(hasPermissions('VIEWER', ['apikeys:manage'])).toBe(false);
  });

  it('un developpeur gere les cles API mais pas l\'equipe', () => {
    expect(hasPermissions('DEVELOPER', ['apikeys:manage'])).toBe(true);
    expect(hasPermissions('DEVELOPER', ['team:manage'])).toBe(false);
  });

  it('le proprietaire et l\'admin gerent l\'equipe', () => {
    expect(hasPermissions('OWNER', ['team:manage', 'merchant:write'])).toBe(true);
    expect(hasPermissions('ADMIN', ['team:manage'])).toBe(true);
  });

  it('l\'admin plateforme n\'a pas les droits marchand', () => {
    expect(ROLE_PERMISSIONS.PLATFORM_ADMIN).toEqual(['platform:admin']);
    expect(hasPermissions('PLATFORM_ADMIN', ['payments:read'])).toBe(false);
  });

  it('aucun role marchand n\'a le droit platform:admin', () => {
    for (const role of ['VIEWER', 'DEVELOPER', 'ADMIN', 'OWNER'] as const) {
      expect(hasPermissions(role, ['platform:admin'])).toBe(false);
    }
  });
});
