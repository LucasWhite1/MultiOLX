const crypto = require('node:crypto');

function profileName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80)
    throw new Error('Informe um nome de até 80 caracteres.');
  return value.trim();
}
function profileId(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  )
    throw new Error('Perfil inválido.');
  return value;
}
function createProfile(name) {
  return { id: crypto.randomUUID(), name: profileName(name) };
}
function allowedUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === 'olx.com.br' ||
        url.hostname.endsWith('.olx.com.br') ||
        ['accounts.google.com', 'accounts.google.com.br'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}
function cookieForRestore(cookie) {
  if (!cookie || !cookie.name || !cookie.domain || !cookie.path?.startsWith('/'))
    throw new Error('Cookie inválido.');
  const host = cookie.domain.replace(/^\./, '');
  const url = `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`;
  // State is restored only inside the same local profile. Nothing is imported
  // from the personal Chrome or transferred to another browser or server.
  const result = {
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  };
  if (!cookie.hostOnly) result.domain = cookie.domain;
  if (!cookie.session && cookie.expirationDate) result.expirationDate = cookie.expirationDate;
  return result;
}
module.exports = { profileName, profileId, createProfile, allowedUrl, cookieForRestore };
