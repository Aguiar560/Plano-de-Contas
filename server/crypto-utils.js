'use strict';

/**
 * crypto-utils.js — Criptografia AES-256-GCM com versionamento de chave.
 *
 * Formato armazenado:
 *   ENC:v{n}:iv_hex:tag_hex:cipher_hex  ← novo (v >= 1)
 *   ENC:iv_hex:tag_hex:cipher_hex        ← legado (lido como v1, nunca escrito)
 *   PLAIN:valor                          ← sem chave (dev/teste)
 *
 * Variáveis de ambiente:
 *   ENCRYPT_KEY          chave atual (usada para encrypt() e como fallback para a versão corrente)
 *   ENCRYPT_KEY_VERSION  versão inteira da ENCRYPT_KEY (padrão: 1)
 *   ENCRYPT_KEY_V{n}     chaves históricas — permite decrypt de dados criados com chave anterior
 *
 * Rotação de chave:
 *   1. Defina ENCRYPT_KEY_V{versão_atual} = valor atual de ENCRYPT_KEY
 *   2. Defina ENCRYPT_KEY = novo valor
 *   3. Incremente ENCRYPT_KEY_VERSION
 *   4. Reinicie o servidor → novos dados usam nova chave; dados antigos ainda descriptografam
 *   5. Execute POST /api/admin/re-encrypt para migrar dados históricos (opcional)
 */

const crypto = require('crypto');

const ALGO         = 'aes-256-gcm';
const ENC_PREFIX   = 'ENC:';
const PLAIN_PREFIX = 'PLAIN:';

function _currentVersion() {
  const v = parseInt(process.env.ENCRYPT_KEY_VERSION || '1', 10);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function _deriveKey(raw) {
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Retorna a chave Buffer para a versão solicitada, ou null se não disponível.
 * Prioridade: ENCRYPT_KEY_V{n} > ENCRYPT_KEY (se n === versão corrente).
 */
function _keyForVersion(version) {
  const specific = process.env[`ENCRYPT_KEY_V${version}`];
  if (specific) return _deriveKey(specific);
  if (version === _currentVersion() && process.env.ENCRYPT_KEY) {
    return _deriveKey(process.env.ENCRYPT_KEY);
  }
  return null;
}

/**
 * Criptografa plaintext com AES-256-GCM usando a chave/versão corrente.
 * Retorna "ENC:v{n}:iv:tag:cipher" ou "PLAIN:valor" se ENCRYPT_KEY não definida.
 */
function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  if (!process.env.ENCRYPT_KEY) return PLAIN_PREFIX + plaintext;

  const version  = _currentVersion();
  const key      = _deriveKey(process.env.ENCRYPT_KEY);
  const iv       = crypto.randomBytes(12);
  const cipher   = crypto.createCipheriv(ALGO, key, iv);
  const enc      = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag  = cipher.getAuthTag();

  return `${ENC_PREFIX}v${version}:`
    + iv.toString('hex') + ':'
    + authTag.toString('hex') + ':'
    + enc.toString('hex');
}

/**
 * Descriptografa um valor produzido por encrypt().
 * Suporta formato legado (ENC:iv:tag:cipher = v1) e versionado (ENC:v{n}:iv:tag:cipher).
 * Retorna null se a decriptografia falhar ou a chave da versão não estiver disponível.
 */
function decrypt(ciphertext) {
  if (!ciphertext) return ciphertext;
  if (ciphertext.startsWith(PLAIN_PREFIX)) return ciphertext.slice(PLAIN_PREFIX.length);
  if (!ciphertext.startsWith(ENC_PREFIX))  return ciphertext; // legado: plain sem prefixo

  const body  = ciphertext.slice(ENC_PREFIX.length);
  const parts = body.split(':');

  let version, ivHex, tagHex, encHex;

  if (parts.length === 4 && /^v\d+$/.test(parts[0])) {
    // Formato versionado: ENC:v{n}:iv:tag:cipher
    version = parseInt(parts[0].slice(1), 10);
    [, ivHex, tagHex, encHex] = parts;
  } else if (parts.length === 3) {
    // Formato legado: ENC:iv:tag:cipher → trata como v1
    version = 1;
    [ivHex, tagHex, encHex] = parts;
  } else {
    return null;
  }

  const key = _keyForVersion(version);
  if (!key) return null;

  try {
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
  } catch {
    return null;
  }
}

/**
 * Re-criptografa um valor com a chave/versão corrente.
 * - Se já estiver na versão corrente, retorna o original sem modificar.
 * - Se for legado ou de versão anterior, descriptografa e re-criptografa.
 * - Se a decriptografia falhar (chave histórica indisponível), retorna null.
 * - Se for PLAIN e ENCRYPT_KEY estiver disponível, promove para ENC.
 */
function reEncrypt(ciphertext) {
  if (!ciphertext) return ciphertext;

  const currentVersion = _currentVersion();

  if (ciphertext.startsWith(ENC_PREFIX)) {
    const body  = ciphertext.slice(ENC_PREFIX.length);
    const parts = body.split(':');
    // Já está na versão corrente — não modifica
    if (parts.length === 4 && parts[0] === `v${currentVersion}`) return ciphertext;
  }

  // Precisa migrar: descriptografa com chave antiga e re-criptografa com a corrente
  const plain = decrypt(ciphertext);
  if (plain === null) return null;
  return encrypt(plain);
}

/** Retorna true se o valor já passou por encrypt() (ENC: ou PLAIN:). */
function isEncrypted(value) {
  return typeof value === 'string'
    && (value.startsWith(ENC_PREFIX) || value.startsWith(PLAIN_PREFIX));
}

/** SHA-256 hex de um token — para armazenar refresh tokens no banco. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { encrypt, decrypt, reEncrypt, isEncrypted, hashToken };
