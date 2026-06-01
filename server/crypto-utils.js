'use strict';

const crypto = require('crypto');

const ALGO             = 'aes-256-gcm';
const ENCRYPTED_PREFIX = 'ENC:';
const PLAIN_PREFIX     = 'PLAIN:';

function _getKey() {
  const raw = process.env.ENCRYPT_KEY || '';
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest(); // 32 bytes
}

/**
 * Criptografa um valor com AES-256-GCM.
 * Retorna "ENC:iv_hex:tag_hex:cipher_hex" ou "PLAIN:valor" se sem chave.
 */
function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const key = _getKey();
  if (!key) return PLAIN_PREFIX + plaintext;

  const iv       = crypto.randomBytes(12);
  const cipher   = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag  = cipher.getAuthTag();

  return ENCRYPTED_PREFIX
    + iv.toString('hex') + ':'
    + authTag.toString('hex') + ':'
    + encrypted.toString('hex');
}

/**
 * Descriptografa um valor produzido por encrypt().
 * Retorna null se a decriptografia falhar ou a chave estiver ausente.
 */
function decrypt(ciphertext) {
  if (!ciphertext) return ciphertext;

  if (ciphertext.startsWith(PLAIN_PREFIX)) return ciphertext.slice(PLAIN_PREFIX.length);
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) return ciphertext; // legado: plain sem prefixo

  const key = _getKey();
  if (!key) return null;

  const parts = ciphertext.slice(ENCRYPTED_PREFIX.length).split(':');
  if (parts.length !== 3) return null;

  try {
    const iv        = Buffer.from(parts[0], 'hex');
    const authTag   = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  } catch {
    return null;
  }
}

/** Retorna true se o valor já foi processado por encrypt(). */
function isEncrypted(value) {
  return typeof value === 'string'
    && (value.startsWith(ENCRYPTED_PREFIX) || value.startsWith(PLAIN_PREFIX));
}

/** SHA-256 hex de um token — usado para armazenar refresh tokens no banco. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { encrypt, decrypt, isEncrypted, hashToken };
