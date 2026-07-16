const crypto = require('crypto');
const database = require('./database');

/**
 * Inserts an immutable record into the audit_events table.
 * Computes a SHA-256 signature to guarantee state integrity.
 */
async function logAuditEvent({
  actorId,
  actorRole,
  actionType,
  targetTable,
  targetRowId,
  beforeState = null,
  afterState = null,
  sourceIp = '127.0.0.1',
  sourceDeviceFingerprint = 'UNKNOWN_DEVICE'
}) {
  try {
    const beforeStateStr = beforeState ? JSON.stringify(beforeState) : '';
    const afterStateStr = afterState ? JSON.stringify(afterState) : '';
    const timestamp = new Date().toISOString();

    // 1. Establish hash link parameters
    const hashPayload = [
      actorId || 'SYSTEM',
      actorRole || 'UNKNOWN_ROLE',
      actionType,
      targetRowId,
      beforeStateStr,
      afterStateStr,
      timestamp
    ].join('|');

    // 2. Compute SHA-256 checksum
    const payloadHash = crypto
      .createHash('sha256')
      .update(hashPayload)
      .digest('hex');

    // 3. Write to SQLite
    const auditId = crypto.randomUUID();
    const sql = `
      INSERT INTO audit_events (
        audit_id, actor_id, actor_role, action_type, target_table, target_row_id,
        before_state, after_state, source_ip, source_device_fingerprint, event_timestamp, payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await database.runAsync(sql, [
      auditId,
      actorId || null,
      actorRole,
      actionType,
      targetTable,
      targetRowId,
      beforeStateStr || null,
      afterStateStr || null,
      sourceIp,
      sourceDeviceFingerprint,
      timestamp,
      payloadHash
    ]);

    return { auditId, payloadHash };
  } catch (error) {
    console.error('Audit Logging Error:', error);
    throw error;
  }
}

/**
 * Recalculates and verifies the checksum of an audit row to check for tampering.
 */
function verifyAuditRow(row) {
  const beforeStateStr = row.before_state || '';
  const afterStateStr = row.after_state || '';
  const hashPayload = [
    row.actor_id || 'SYSTEM',
    row.actor_role || 'UNKNOWN_ROLE',
    row.action_type,
    row.target_row_id,
    beforeStateStr,
    afterStateStr,
    row.event_timestamp
  ].join('|');

  const recomputedHash = crypto
    .createHash('sha256')
    .update(hashPayload)
    .digest('hex');

  return recomputedHash === row.payload_hash;
}

module.exports = {
  logAuditEvent,
  verifyAuditRow
};
