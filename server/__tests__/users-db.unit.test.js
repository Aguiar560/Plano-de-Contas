/**
 * users-db.unit.test.js — Testes unitários para a camada users-db.js
 *
 * Estratégia: injeta um pool MySQL mockado via init() e verifica
 * que cada função gera as queries corretas e mapeia o resultado.
 * Não faz I/O real: fs é mockado para evitar leitura/escrita de arquivos.
 */

'use strict';

// Interceptar fs antes de qualquer require para evitar I/O real
jest.mock('fs', () => ({
  existsSync:    jest.fn().mockReturnValue(true),  // migration already done
  readFileSync:  jest.fn().mockReturnValue('[]'),
  writeFileSync: jest.fn(),
}));

// ── Mock pool ─────────────────────────────────────────────────────────────

const mockPool = { execute: jest.fn() };

/** Default implementation: responde de forma segura para _ensureTables */
function _resetDefaultMock() {
  mockPool.execute.mockImplementation(async (sql) => {
    if (sql.includes('information_schema')) return [[{ c: 1 }]]; // tables/cols exist
    if (/^\s*SELECT\s+COUNT/i.test(sql))   return [[{ total: '0' }]];
    if (/^\s*SELECT/i.test(sql))           return [[]];
    if (/^\s*INSERT/i.test(sql))           return [{ insertId: 100, affectedRows: 1 }];
    return [{ affectedRows: 1 }];
  });
}

let db;

beforeAll(async () => {
  _resetDefaultMock();
  db = require('../users-db');
  await db.init(mockPool);
  mockPool.execute.mockClear();
  _resetDefaultMock();
});

afterEach(() => {
  mockPool.execute.mockClear();
  _resetDefaultMock();
});

// ── findByUsuario ─────────────────────────────────────────────────────────

describe('findByUsuario', () => {
  test('retorna usuário mapeado quando encontrado', async () => {
    mockPool.execute.mockResolvedValueOnce([[{
      id: 1, usuario: 'admin', nome: 'Admin', senha_hash: '$2a$10$xyz',
      perfil: 'admin', ativo: 1, failed_attempts: 0, lock_until: null, last_failed_at: null
    }]]);

    const user = await db.findByUsuario('admin');

    expect(user).not.toBeNull();
    expect(user.usuario).toBe('admin');
    expect(user.senhaHash).toBe('$2a$10$xyz');
    expect(user.ativo).toBe(true);
    expect(user.perfil).toBe('admin');
    expect(user.failedAttempts).toBe(0);
    expect(mockPool.execute).toHaveBeenCalledWith(
      expect.stringContaining('WHERE usuario = ?'),
      ['admin']
    );
  });

  test('retorna null quando usuário não existe', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    const user = await db.findByUsuario('fantasma');
    expect(user).toBeNull();
  });

  test('mapeia ativo: 0 → false', async () => {
    mockPool.execute.mockResolvedValueOnce([[{
      id: 2, usuario: 'inativo', nome: '', senha_hash: 'h',
      perfil: 'operador', ativo: 0, failed_attempts: 0, lock_until: null, last_failed_at: null
    }]]);
    const user = await db.findByUsuario('inativo');
    expect(user.ativo).toBe(false);
  });
});

// ── findById ──────────────────────────────────────────────────────────────

describe('findById', () => {
  test('retorna usuário por id', async () => {
    mockPool.execute.mockResolvedValueOnce([[{
      id: 5, usuario: 'joao', nome: 'João Silva', senha_hash: 'h',
      perfil: 'operador', ativo: 1, failed_attempts: 2, lock_until: null, last_failed_at: 9999
    }]]);

    const user = await db.findById(5);
    expect(user.id).toBe(5);
    expect(user.failedAttempts).toBe(2);
    expect(user.lastFailedAt).toBe(9999);
  });

  test('retorna null quando id não existe', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    const user = await db.findById(9999);
    expect(user).toBeNull();
  });
});

// ── listAll ───────────────────────────────────────────────────────────────

describe('listAll', () => {
  test('retorna lista sem dados sensíveis', async () => {
    mockPool.execute.mockResolvedValueOnce([[
      { id: 1, usuario: 'admin',  nome: 'Admin', perfil: 'admin',    ativo: 1, lock_until: null },
      { id: 2, usuario: 'op',    nome: 'Op',    perfil: 'operador', ativo: 0, lock_until: 1234567890 }
    ]]);

    const users = await db.listAll();

    expect(users).toHaveLength(2);
    expect(users[0].ativo).toBe(true);
    expect(users[1].ativo).toBe(false);
    expect(users[1].lockUntil).toBe(1234567890);
    // Nunca deve expor hash de senha
    expect(users[0].senhaHash).toBeUndefined();
    expect(users[0].senha_hash).toBeUndefined();
  });

  test('retorna lista vazia quando não há usuários', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    const users = await db.listAll();
    expect(users).toEqual([]);
  });
});

// ── createUser ────────────────────────────────────────────────────────────

describe('createUser', () => {
  test('executa INSERT e retorna insertId', async () => {
    mockPool.execute.mockResolvedValueOnce([{ insertId: 42, affectedRows: 1 }]);

    const id = await db.createUser({
      usuario: 'novousuario', nome: 'Novo', senhaHash: '$2a$hash', perfil: 'operador'
    });

    expect(id).toBe(42);
    expect(mockPool.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO usuario'),
      expect.arrayContaining(['novousuario', 'Novo', '$2a$hash', 'operador'])
    );
  });

  test('normaliza usuario para minúsculas no INSERT', async () => {
    mockPool.execute.mockResolvedValueOnce([{ insertId: 7 }]);
    await db.createUser({ usuario: 'MAIUSCULAS', nome: 'N', senhaHash: 'h', perfil: 'gerente' });

    const params = mockPool.execute.mock.calls[0][1];
    expect(params[1]).toBe('maiusculas'); // params[0] = empresa_id, params[1] = usuario
  });
});

// ── updateUser ────────────────────────────────────────────────────────────

describe('updateUser', () => {
  test('atualiza perfil', async () => {
    await db.updateUser(1, { perfil: 'gerente' });
    expect(mockPool.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET perfil'),
      expect.arrayContaining(['gerente', 1])
    );
  });

  test('atualiza ativo', async () => {
    await db.updateUser(2, { ativo: false });
    const params = mockPool.execute.mock.calls[0][1];
    expect(params).toContain(0);
  });

  test('sem campos não chama execute', async () => {
    const result = await db.updateUser(1, {});
    expect(result).toBe(true);
    expect(mockPool.execute).not.toHaveBeenCalled();
  });
});

// ── updatePassword ────────────────────────────────────────────────────────

describe('updatePassword', () => {
  test('atualiza senha_hash', async () => {
    await db.updatePassword(3, '$2a$novoHash');
    expect(mockPool.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET senha_hash = ?'),
      ['$2a$novoHash', 3]
    );
  });
});

// ── deleteUser ────────────────────────────────────────────────────────────

describe('deleteUser', () => {
  test('executa DELETE pelo id', async () => {
    await db.deleteUser(5);
    expect(mockPool.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM usuario WHERE id = ?'),
      [5]
    );
  });
});

// ── unlockUser ────────────────────────────────────────────────────────────

describe('unlockUser', () => {
  test('zera lock_until e failed_attempts', async () => {
    await db.unlockUser(7);
    const [sql, params] = mockPool.execute.mock.calls[0];
    expect(sql).toMatch(/lock_until = NULL/i);
    expect(sql).toMatch(/failed_attempts = 0/i);
    expect(params).toContain(7);
  });
});

// ── recordLoginFailure ────────────────────────────────────────────────────

describe('recordLoginFailure', () => {
  test('incrementa failed_attempts', async () => {
    await db.recordLoginFailure(2);
    const [sql] = mockPool.execute.mock.calls[0];
    expect(sql).toMatch(/failed_attempts/i);
  });

  test('passa userId e timestamp correto', async () => {
    const before = Date.now();
    await db.recordLoginFailure(4);
    const params = mockPool.execute.mock.calls[0][1];
    const ts = params[0];
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(params[params.length - 1]).toBe(4); // userId é o último param
  });
});

// ── clearLoginFailures ────────────────────────────────────────────────────

describe('clearLoginFailures', () => {
  test('reseta tentativas e lock', async () => {
    await db.clearLoginFailures(1);
    const [sql, params] = mockPool.execute.mock.calls[0];
    expect(sql).toMatch(/failed_attempts = 0/i);
    expect(params).toContain(1);
  });
});

// ── getUserPermissions ────────────────────────────────────────────────────

describe('getUserPermissions', () => {
  test('parseia e retorna objeto de permissões', async () => {
    const perms = { addConta: true, removeConta: false, newLancamento: true };
    mockPool.execute.mockResolvedValueOnce([[{ perms_json: JSON.stringify(perms) }]]);

    const result = await db.getUserPermissions(3);
    expect(result).toEqual(perms);
  });

  test('retorna null quando usuário não tem permissões salvas', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    const result = await db.getUserPermissions(999);
    expect(result).toBeNull();
  });

  test('retorna null para JSON malformado', async () => {
    mockPool.execute.mockResolvedValueOnce([[{ perms_json: '{invalido:' }]]);
    const result = await db.getUserPermissions(1);
    expect(result).toBeNull();
  });
});

// ── saveUserPermissions ───────────────────────────────────────────────────

describe('saveUserPermissions', () => {
  test('executa UPSERT com perms serializadas', async () => {
    const perms = { addConta: false, manageUsers: true };
    const result = await db.saveUserPermissions(7, perms);

    expect(result).toBe(true);
    const [sql, params] = mockPool.execute.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO user_permissions/i);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(params[0]).toBe(7);
    expect(params[1]).toBe(JSON.stringify(perms));
  });
});

// ── findRefreshToken ──────────────────────────────────────────────────────

describe('findRefreshToken', () => {
  test('retorna info de token válido', async () => {
    const future = Date.now() + 100_000;
    mockPool.execute.mockResolvedValueOnce([[{ usuario_id: 1, expires_at: future }]]);

    const result = await db.findRefreshToken('token123');
    expect(result).not.toBeNull();
    expect(result.userId).toBe(1);
    expect(result.expiresAt).toBe(future);
  });

  test('retorna null quando token não encontrado', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    const result = await db.findRefreshToken('inexistente');
    expect(result).toBeNull();
  });

  test('busca com expires_at > agora', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    const before = Date.now();
    await db.findRefreshToken('tok');
    const params = mockPool.execute.mock.calls[0][1];
    const tsParam = params[1]; // segundo param é o timestamp de expiração mínimo
    expect(tsParam).toBeGreaterThanOrEqual(before);
  });
});

// ── appendAudit ───────────────────────────────────────────────────────────

describe('appendAudit', () => {
  test('insere registro no audit_log com todos os campos', async () => {
    await db.appendAudit('conta_criada', 1, {
      entityType: 'conta',
      entityId:   '1.5',
      ip:         '192.168.1.1',
      userAgent:  'TestAgent/1.0'
    });

    const [sql, params] = mockPool.execute.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO audit_log/i);
    expect(params[0]).toBe('conta_criada');
    expect(params[1]).toBe('conta');
    expect(params[2]).toBe('1.5');
    expect(params[4]).toBe(1);    // actorUserId
  });

  test('serializa detail como JSON', async () => {
    const detail = { antes: { nome: 'A' }, depois: { nome: 'B' } };
    await db.appendAudit('conta_renomeada', 2, { detail });

    const params = mockPool.execute.mock.calls[0][1];
    const detailParam = params.find(p => typeof p === 'string' && p.startsWith('{'));
    expect(detailParam).toBe(JSON.stringify(detail));
  });

  test('não lança exceção em caso de falha no DB', async () => {
    mockPool.execute.mockRejectedValueOnce(new Error('DB down'));
    await expect(db.appendAudit('test', null, {})).resolves.not.toThrow();
  });
});

// ── getAuditEntries ───────────────────────────────────────────────────────

describe('getAuditEntries', () => {
  test('retorna lista paginada com total e pages', async () => {
    mockPool.execute
      .mockResolvedValueOnce([[{ total: '5' }]])
      .mockResolvedValueOnce([[
        { id: 1, action: 'login', entityType: 'usuario', entityId: '1',
          targetUserId: null, actorUserId: 1, detail: null, ip: '127.0.0.1', userAgent: 'test', when: '2026-01-01' }
      ]]);

    const result = await db.getAuditEntries({ page: 1, limit: 10 });

    expect(result.total).toBe(5);
    expect(result.pages).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].action).toBe('login');
  });

  test('parseia detail JSON em objeto', async () => {
    const detail = { before: { nome: 'X' }, after: { nome: 'Y' } };
    mockPool.execute
      .mockResolvedValueOnce([[{ total: '1' }]])
      .mockResolvedValueOnce([[{
        id: 2, action: 'conta_renomeada', entityType: 'conta', entityId: '1',
        targetUserId: null, actorUserId: 1, detail: JSON.stringify(detail),
        ip: null, userAgent: null, when: '2026-01-15'
      }]]);

    const result = await db.getAuditEntries({});
    expect(result.entries[0].detail).toEqual(detail);
  });

  test('aplica filtro action na query', async () => {
    mockPool.execute
      .mockResolvedValueOnce([[{ total: '0' }]])
      .mockResolvedValueOnce([[]]);

    await db.getAuditEntries({ action: 'login' });

    const [countSql, countParams] = mockPool.execute.mock.calls[0];
    expect(countSql).toMatch(/action = \?/i);
    expect(countParams).toContain('login');
  });

  test('calcula pages corretamente', async () => {
    mockPool.execute
      .mockResolvedValueOnce([[{ total: '25' }]])
      .mockResolvedValueOnce([[]]);

    const result = await db.getAuditEntries({ page: 1, limit: 10 });
    expect(result.pages).toBe(3); // ceil(25/10)
  });
});
