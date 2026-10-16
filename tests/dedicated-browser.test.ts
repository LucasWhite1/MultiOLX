import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createProfile, profileId, allowedUrl, cookieForRestore } = require('../browser/policy.cjs');
it('isola o Facebook da OLX e restringe os domínios da conexão Marketplace', () => {
  expect(createProfile('Marketplace', 'facebook').provider).toBe('facebook');
  expect(createProfile('OLX').provider).toBe('olx');
  expect(() => createProfile('Outra', 'unknown')).toThrow();
  expect(allowedUrl('https://www.facebook.com/marketplace/inbox/', 'facebook')).toBe(true);
  expect(allowedUrl('https://www.facebook.com/checkpoint/', 'facebook')).toBe(true);
  expect(allowedUrl('https://www.facebook.com/')).toBe(false);
  expect(allowedUrl('https://www.olx.com.br/', 'facebook')).toBe(false);
  expect(allowedUrl('https://facebook.com.evil.test/', 'facebook')).toBe(false);
  expect(allowedUrl('http://facebook.com/', 'facebook')).toBe(false);
});
it('isola identificadores de perfis e impede caminhos ou nomes inválidos', () => {
  const a = createProfile(' Maria '),
    b = createProfile('Maria');
  expect(a.name).toBe('Maria');
  expect(a.id).not.toBe(b.id);
  expect(profileId(a.id)).toBe(a.id);
  expect(() => profileId('../Chrome')).toThrow();
  expect(() => createProfile(' ')).toThrow();
});
it('limita navegação a OLX e login Google sem nomes de domínio parecidos ou protocolos locais', () => {
  for (const url of [
    'https://www.olx.com.br/',
    'https://chat.olx.com.br/',
    'https://accounts.google.com/',
  ])
    expect(allowedUrl(url)).toBe(true);
  for (const url of [
    'https://olx.com.br.evil.test/',
    'https://notolx.com.br/',
    'file:///private',
    'javascript:alert(1)',
    'http://olx.com.br/',
    'https://user:secret@olx.com.br/',
    'https://olx.com.br:9999/',
  ])
    expect(allowedUrl(url)).toBe(false);
});
it('restaura cookies no mesmo perfil respeitando domínio, expiração e host-only', () => {
  const restored = cookieForRestore({
    name: 'test',
    value: 'fixture',
    domain: '.olx.com.br',
    path: '/',
    secure: true,
    httpOnly: true,
    hostOnly: false,
    session: false,
    expirationDate: 2000000000,
    sameSite: 'lax',
  });
  expect(restored).toMatchObject({
    url: 'https://olx.com.br/',
    domain: '.olx.com.br',
    expirationDate: 2000000000,
  });
  expect(
    cookieForRestore({ ...restored, domain: 'chat.olx.com.br', hostOnly: true, session: true }),
  ).not.toHaveProperty('domain');
});
