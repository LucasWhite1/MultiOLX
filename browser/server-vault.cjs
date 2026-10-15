const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} = require('node:crypto');
function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256)
    throw Error('Use uma senha de 12 a 256 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
function validHash(value) {
  return typeof value === 'string' && /^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(value);
}
function verifyPassword(password, hash) {
  if (!validHash(hash) || typeof password !== 'string' || password.length > 256) return false;
  const [, salt, digest] = hash.split(':');
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(digest, 'hex'));
}
function createServerVault(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || ''))
    throw Error('MULTIOLX_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.');
  const key = Buffer.from(value, 'hex'),
    magic = Buffer.from('MOLXWEB1');
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'server-aes-256-gcm',
    encryptString(text) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(bytes) {
      if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(magic) || bytes.length < 36)
        throw Error(
          'Formato de cofre incompatível. Não copie arquivos criptografados do Windows para a VPS.',
        );
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
      cipher.setAuthTag(bytes.subarray(20, 36));
      return Buffer.concat([cipher.update(bytes.subarray(36)), cipher.final()]).toString('utf8');
    },
  };
}
module.exports = { passwordHash, verifyPassword, validHash, createServerVault };
