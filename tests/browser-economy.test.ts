import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { shouldDeferResource } = createRequire(import.meta.url)('../browser/economy.cjs');
const request = {
  resourceType: 'image',
  url: 'https://images.olx.com.br/photo.jpg',
  referrer: 'https://chat.olx.com.br/',
};
const background = { enabled: true, background: true, chatDocument: true };
it('adia imagens e mídia só em chats de fundo, preservando comunicação, login e verificações', () => {
  expect(shouldDeferResource(request, background)).toBe(true);
  for (const resourceType of [
    'mainFrame',
    'subFrame',
    'script',
    'xhr',
    'webSocket',
    'stylesheet',
    'font',
    'ping',
  ])
    expect(shouldDeferResource({ ...request, resourceType }, background)).toBe(false);
  for (const state of [
    { ...background, enabled: false },
    { ...background, background: false },
    { ...background, chatDocument: false },
  ])
    expect(shouldDeferResource(request, state)).toBe(false);
  expect(
    shouldDeferResource({ ...request, frameUrl: 'https://challenges.cloudflare.com/' }, background),
  ).toBe(false);
  expect(
    shouldDeferResource({ ...request, url: 'https://challenges.cloudflare.com/image' }, background),
  ).toBe(false);
  expect(
    shouldDeferResource({ ...request, referrer: 'https://accounts.google.com/' }, background),
  ).toBe(false);
});
