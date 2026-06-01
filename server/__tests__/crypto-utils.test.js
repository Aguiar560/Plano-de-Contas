'use strict';

/**
 * crypto-utils.test.js — Testes unitários para encrypt/decrypt/isEncrypted/hashToken
 * Sem DB. Funções puras determinísticas.
 */

const REAL_KEY = 'a'.repeat(64); // 64 chars hex-like (qualquer string 32+ bytes serve)

// Guarda env original
let _originalKey;
beforeAll(() => { _originalKey = process.env.ENCRYPT_KEY; });
afterAll(() => {
  if (_originalKey === undefined) delete process.env.ENCRYPT_KEY;
  else process.env.ENCRYPT_KEY = _originalKey;
});

// Recarrega módulo sempre que mudar a env (jest cache)
function loadUtils() {
  jest.resetModules();
  return require('../crypto-utils');
}

// ── encrypt / decrypt ──────────────────────────────────────────────────────

describe('encrypt + decrypt', () => {
  beforeEach(() => { process.env.ENCRYPT_KEY = REAL_KEY; });

  test('roundtrip: decrypt(encrypt(x)) === x', () => {
    const { encrypt, decrypt } = loadUtils();
    const plain = '123.456.789-00';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  test('cada chamada gera ciphertext diferente (IV aleatório)', () => {
    const { encrypt } = loadUtils();
    const plain = '12.345.678/0001-99';
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });

  test('ciphertext começa com "ENC:"', () => {
    const { encrypt } = loadUtils();
    expect(encrypt('qualquer').startsWith('ENC:')).toBe(true);
  });

  test('null retorna null', () => {
    const { encrypt, decrypt } = loadUtils();
    expect(encrypt(null)).toBeNull();
    expect(decrypt(null)).toBeNull();
  });

  test('string vazia retorna string vazia', () => {
    const { encrypt, decrypt } = loadUtils();
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });

  test('CNPJ roundtrip', () => {
    const { encrypt, decrypt } = loadUtils();
    const cnpj = '12.345.678/0001-99';
    expect(decrypt(encrypt(cnpj))).toBe(cnpj);
  });

  test('valor numérico é convertido para string e preservado', () => {
    const { encrypt, decrypt } = loadUtils();
    const enc = encrypt(42);
    expect(decrypt(enc)).toBe('42');
  });
});

// ── fallback sem ENCRYPT_KEY ───────────────────────────────────────────────

describe('sem ENCRYPT_KEY', () => {
  beforeEach(() => { delete process.env.ENCRYPT_KEY; });

  test('encrypt retorna "PLAIN:valor"', () => {
    const { encrypt } = loadUtils();
    expect(encrypt('123.456.789-00')).toBe('PLAIN:123.456.789-00');
  });

  test('decrypt de "PLAIN:valor" retorna o valor', () => {
    const { decrypt } = loadUtils();
    expect(decrypt('PLAIN:123.456.789-00')).toBe('123.456.789-00');
  });

  test('decrypt de valor legado (sem prefixo) retorna o próprio valor', () => {
    const { decrypt } = loadUtils();
    expect(decrypt('123.456.789-00')).toBe('123.456.789-00');
  });
});

// ── decrypt com chave errada ───────────────────────────────────────────────

describe('decrypt com chave errada', () => {
  test('retorna null (authTag inválido)', () => {
    process.env.ENCRYPT_KEY = REAL_KEY;
    const { encrypt } = loadUtils();
    const ciphertext = encrypt('segredo');

    process.env.ENCRYPT_KEY = 'b'.repeat(64); // chave diferente
    const { decrypt } = loadUtils();
    expect(decrypt(ciphertext)).toBeNull();
  });
});

// ── ciphertext corrompido ──────────────────────────────────────────────────

describe('decrypt com ciphertext malformado', () => {
  beforeEach(() => { process.env.ENCRYPT_KEY = REAL_KEY; });

  test('formato ENC: sem partes suficientes retorna null', () => {
    const { decrypt } = loadUtils();
    expect(decrypt('ENC:aabbcc')).toBeNull(); // apenas 1 parte, precisaria de 3
  });

  test('hex inválido retorna null', () => {
    const { decrypt } = loadUtils();
    expect(decrypt('ENC:zzzzzz:aabbcc:ddeeff')).toBeNull();
  });
});

// ── isEncrypted ───────────────────────────────────────────────────────────

describe('isEncrypted', () => {
  beforeEach(() => { process.env.ENCRYPT_KEY = REAL_KEY; });

  test('valor criptografado (ENC:) retorna true', () => {
    const { encrypt, isEncrypted } = loadUtils();
    expect(isEncrypted(encrypt('cpf'))).toBe(true);
  });

  test('valor com prefixo PLAIN: retorna true', () => {
    delete process.env.ENCRYPT_KEY;
    const { encrypt, isEncrypted } = loadUtils();
    expect(isEncrypted(encrypt('cpf'))).toBe(true);
  });

  test('plaintext legado retorna false', () => {
    const { isEncrypted } = loadUtils();
    expect(isEncrypted('123.456.789-00')).toBe(false);
  });

  test('null retorna false', () => {
    const { isEncrypted } = loadUtils();
    expect(isEncrypted(null)).toBe(false);
  });

  test('string vazia retorna false', () => {
    const { isEncrypted } = loadUtils();
    expect(isEncrypted('')).toBe(false);
  });
});

// ── hashToken ─────────────────────────────────────────────────────────────

describe('hashToken', () => {
  beforeEach(() => { process.env.ENCRYPT_KEY = REAL_KEY; });

  test('retorna string de 64 chars (SHA-256 hex)', () => {
    const { hashToken } = loadUtils();
    expect(hashToken('qualquer_token').length).toBe(64);
  });

  test('determinístico: mesmo input, mesmo hash', () => {
    const { hashToken } = loadUtils();
    expect(hashToken('token_abc')).toBe(hashToken('token_abc'));
  });

  test('tokens diferentes geram hashes diferentes', () => {
    const { hashToken } = loadUtils();
    expect(hashToken('token_a')).not.toBe(hashToken('token_b'));
  });

  test('resultado é hexadecimal válido', () => {
    const { hashToken } = loadUtils();
    expect(/^[a-f0-9]{64}$/.test(hashToken('test'))).toBe(true);
  });
});
