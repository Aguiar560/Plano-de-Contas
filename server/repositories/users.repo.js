'use strict';

/**
 * UsersRepo — queries SQL para usuários, refresh tokens, permissões e audit.
 * Sem fallback JSON, sem lógica de negócio. Recebe pool MySQL via construtor.
 */
module.exports = function createUsersRepo(pool) {
  // ── Mappers ───────────────────────────────────────────────────────────────

  function _mapRow(r) {
    return {
      id:                  r.id,
      empresaId:           r.empresa_id || null,
      usuario:             r.usuario,
      nome:                r.nome,
      senhaHash:           r.senha_hash,
      perfil:              r.perfil,
      ativo:               !!r.ativo,
      failedAttempts:      r.failed_attempts || 0,
      lockUntil:           r.lock_until      || null,
      lastFailedAt:        r.last_failed_at  || null,
      mustChangePassword:  !!r.must_change_password,
    };
  }

  // ── Usuários ──────────────────────────────────────────────────────────────

  async function findByUsuario(usuario, empresaId) {
    let rows;
    if (empresaId === null || empresaId === undefined) {
      [rows] = await pool.execute(
        'SELECT * FROM usuario WHERE usuario = ? AND empresa_id IS NULL LIMIT 1',
        [usuario.toLowerCase()]
      );
      if (!rows[0]) {
        [rows] = await pool.execute(
          'SELECT * FROM usuario WHERE usuario = ? LIMIT 1',
          [usuario.toLowerCase()]
        );
      }
    } else {
      [rows] = await pool.execute(
        'SELECT * FROM usuario WHERE usuario = ? AND empresa_id = ? LIMIT 1',
        [usuario.toLowerCase(), empresaId]
      );
    }
    return rows[0] ? _mapRow(rows[0]) : null;
  }

  async function findById(id) {
    const [rows] = await pool.execute('SELECT * FROM usuario WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? _mapRow(rows[0]) : null;
  }

  async function listAll(empresaId) {
    let rows;
    if (empresaId !== undefined && empresaId !== null) {
      [rows] = await pool.execute(
        'SELECT id, usuario, nome, perfil, ativo, lock_until FROM usuario WHERE empresa_id = ? ORDER BY id',
        [empresaId]
      );
    } else {
      [rows] = await pool.execute(
        'SELECT id, usuario, nome, perfil, ativo, lock_until FROM usuario ORDER BY id'
      );
    }
    return rows.map(r => ({
      id:        r.id,
      usuario:   r.usuario,
      nome:      r.nome,
      perfil:    r.perfil,
      ativo:     !!r.ativo,
      lockUntil: r.lock_until || null,
    }));
  }

  async function createUser({ usuario, nome, senhaHash, perfil, empresaId }) {
    const [r] = await pool.execute(
      'INSERT INTO usuario (empresa_id, usuario, nome, senha_hash, perfil, ativo, created_at) VALUES (?,?,?,?,?,1,NOW())',
      [empresaId || null, usuario.toLowerCase().trim(), nome.trim(), senhaHash, perfil]
    );
    return r.insertId;
  }

  async function updateUser(id, fields, empresaId) {
    const set = [];
    const vals = [];
    if (fields.perfil !== undefined) { set.push('perfil = ?'); vals.push(fields.perfil); }
    if (fields.ativo  !== undefined) { set.push('ativo = ?');  vals.push(fields.ativo ? 1 : 0); }
    if (!set.length) return true;
    vals.push(id);
    const whereParts = ['id = ?'];
    if (empresaId !== undefined) { whereParts.push('empresa_id = ?'); vals.push(empresaId); }
    await pool.execute(`UPDATE usuario SET ${set.join(', ')} WHERE ${whereParts.join(' AND ')}`, vals);
    return true;
  }

  async function updatePassword(id, newHash) {
    await pool.execute('UPDATE usuario SET senha_hash = ? WHERE id = ?', [newHash, id]);
    return true;
  }

  async function deleteUser(id, empresaId) {
    if (empresaId !== undefined) {
      await pool.execute('DELETE FROM usuario WHERE id = ? AND empresa_id = ?', [id, empresaId]);
    } else {
      await pool.execute('DELETE FROM usuario WHERE id = ?', [id]);
    }
    return true;
  }

  async function unlockUser(id) {
    await pool.execute('UPDATE usuario SET lock_until = NULL, failed_attempts = 0 WHERE id = ?', [id]);
    return true;
  }

  async function recordLoginFailure(id, maxAttempts, lockoutMs) {
    await pool.execute(
      `UPDATE usuario SET
         last_failed_at  = ?,
         lock_until      = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE lock_until END,
         failed_attempts = CASE WHEN failed_attempts + 1 >= ? THEN 0 ELSE failed_attempts + 1 END
       WHERE id = ?`,
      [Date.now(), maxAttempts, Date.now() + lockoutMs, maxAttempts, id]
    );
  }

  async function clearLoginFailures(id) {
    await pool.execute('UPDATE usuario SET failed_attempts = 0, lock_until = NULL WHERE id = ?', [id]);
  }

  // ── Permissões ────────────────────────────────────────────────────────────

  async function getUserPermissions(userId) {
    const [rows] = await pool.execute(
      'SELECT perms_json FROM user_permissions WHERE usuario_id = ? LIMIT 1',
      [userId]
    );
    if (!rows[0]) return null;
    try { return JSON.parse(rows[0].perms_json); } catch(e) { return null; }
  }

  async function saveUserPermissions(userId, permsObj) {
    await pool.execute(
      `INSERT INTO user_permissions (usuario_id, perms_json, updated_at) VALUES (?,?,NOW())
       ON DUPLICATE KEY UPDATE perms_json = VALUES(perms_json), updated_at = NOW()`,
      [userId, JSON.stringify(permsObj)]
    );
    return true;
  }

  // ── Refresh Tokens ────────────────────────────────────────────────────────

  async function insertRefreshToken(tokenHash, userId, expiresAt) {
    await pool.execute('DELETE FROM refresh_token WHERE usuario_id = ? AND expires_at < ?', [userId, Date.now()]);
    await pool.execute(
      'INSERT INTO refresh_token (token, usuario_id, expires_at, hashed) VALUES (?,?,?,1)',
      [tokenHash, userId, expiresAt]
    );
  }

  async function findRefreshToken(tokenHash) {
    const [rows] = await pool.execute(
      'SELECT usuario_id, expires_at FROM refresh_token WHERE token = ? AND hashed = 1 AND expires_at > ? LIMIT 1',
      [tokenHash, Date.now()]
    );
    return rows[0] ? { userId: rows[0].usuario_id, expiresAt: rows[0].expires_at } : null;
  }

  async function deleteRefreshToken(tokenHash) {
    await pool.execute('DELETE FROM refresh_token WHERE token = ? AND hashed = 1', [tokenHash]);
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  async function appendAudit(action, actorUserId, { entityType, entityId, targetUserId, detail, ip, userAgent }) {
    await pool.execute(
      `INSERT INTO audit_log (action, entity_type, entity_id, target_user_id, actor_user_id, detail, ip_address, user_agent, \`when\`)
       VALUES (?,?,?,?,?,?,?,?,NOW())`,
      [
        action, entityType || null,
        entityId ? String(entityId) : null,
        targetUserId || null, actorUserId || null,
        detail ? JSON.stringify(detail) : null,
        ip || null, userAgent || null,
      ]
    );
  }

  async function getAuditEntries({ action, entityType, entityId, actorUserId, dtI, dtF, page = 1, limit = 100 } = {}) {
    const where = [];
    const params = [];
    if (action)      { where.push('action = ?');        params.push(action); }
    if (entityType)  { where.push('entity_type = ?');   params.push(entityType); }
    if (entityId)    { where.push('entity_id = ?');     params.push(String(entityId)); }
    if (actorUserId) { where.push('actor_user_id = ?'); params.push(actorUserId); }
    if (dtI)         { where.push('`when` >= ?');       params.push(dtI + ' 00:00:00'); }
    if (dtF)         { where.push('`when` <= ?');       params.push(dtF + ' 23:59:59'); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (page - 1) * limit;
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM audit_log ${whereClause}`, params);
    const [rows] = await pool.execute(
      `SELECT id, action, entity_type AS entityType, entity_id AS entityId,
              target_user_id AS targetUserId, actor_user_id AS actorUserId,
              detail, ip_address AS ip, user_agent AS userAgent, \`when\`
       FROM audit_log ${whereClause} ORDER BY \`when\` DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return {
      entries: rows.map(r => {
        let det = null;
        if (r.detail) { try { det = JSON.parse(r.detail); } catch(e) { det = r.detail; } }
        return { ...r, detail: det };
      }),
      total: Number(total), page, limit,
      pages: Math.max(1, Math.ceil(Number(total) / limit)),
    };
  }

  return {
    findByUsuario, findById, listAll,
    createUser, updateUser, updatePassword, deleteUser,
    unlockUser, recordLoginFailure, clearLoginFailures,
    getUserPermissions, saveUserPermissions,
    insertRefreshToken, findRefreshToken, deleteRefreshToken,
    appendAudit, getAuditEntries,
  };
};
