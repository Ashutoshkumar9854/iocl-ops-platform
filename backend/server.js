const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const database = require('./database');
const { logAuditEvent, verifyAuditRow } = require('./auditLogger');

const app = express();
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:5173']
  : true; // allow all in development
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Simple authentication middleware
// In a production environment, this would verify JWT tokens
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header is missing or invalid' });
  }
  const userId = authHeader.split(' ')[1];
  try {
    const user = await database.getAsync(`
      SELECT u.*, r.role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.role_id
      WHERE u.user_id = ? AND u.is_active = 1
    `, [userId]);

    if (!user) {
      return res.status(401).json({ error: 'User session invalid or expired' });
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// 1. Auth Endpoint
app.post('/api/v1/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const hashed = crypto.createHash('sha256').update(password).digest('hex');
    const user = await database.getAsync(`
      SELECT u.user_id, u.username, u.email, u.plant_zone, r.role_name
      FROM users u
      JOIN roles r ON u.role_id = r.role_id
      WHERE u.username = ? AND u.password_hash = ?
    `, [username, hashed]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Capture auth audit event
    await logAuditEvent({
      actorId: user.user_id,
      actorRole: user.role_name,
      actionType: 'AUTH_LOGIN',
      targetTable: 'users',
      targetRowId: user.user_id,
      sourceIp: req.ip,
      sourceDeviceFingerprint: req.headers['user-agent']
    });

    res.json({
      token: user.user_id, // Simple token implementation
      user: {
        userId: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role_name,
        zone: user.plant_zone
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. Fetch Assets
app.get('/api/v1/assets', authenticateUser, async (req, res) => {
  try {
    const assets = await database.allAsync('SELECT * FROM assets');
    res.json(assets);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch assets' });
  }
});

// 3. Fetch Logs
app.get('/api/v1/logs', authenticateUser, async (req, res) => {
  try {
    const logs = await database.allAsync(`
      SELECT l.*, a.asset_tag, a.asset_name, u.username
      FROM shift_logs l
      JOIN assets a ON l.asset_id = a.asset_id
      JOIN users u ON l.user_id = u.user_id
      ORDER BY l.recorded_at DESC
      LIMIT 100
    `);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Helper for log validation
function checkOutOfBounds(val, min, max) {
  return val < min || val > max;
}

// 4. Create Shift Log
app.post('/api/v1/logs', authenticateUser, async (req, res) => {
  const { asset_id, parameter_value, recorded_at, client_mutation_id } = req.body;
  if (!asset_id || parameter_value === undefined || !recorded_at) {
    return res.status(400).json({ error: 'Missing required log fields' });
  }

  try {
    // Check if client mutation is already applied
    if (client_mutation_id) {
      const existing = await database.getAsync('SELECT * FROM shift_logs WHERE client_mutation_id = ?', [client_mutation_id]);
      if (existing) {
        return res.status(200).json(existing);
      }
    }

    const asset = await database.getAsync('SELECT * FROM assets WHERE asset_id = ?', [asset_id]);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const isOutOfBounds = checkOutOfBounds(parameter_value, asset.min_safe_limit, asset.max_safe_limit) ? 1 : 0;
    const logId = crypto.randomUUID();

    await database.runAsync(`
      INSERT INTO shift_logs (
        log_id, user_id, asset_id, parameter_value, is_out_of_bounds, min_safe_limit, max_safe_limit, recorded_at, client_mutation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      logId,
      req.user.user_id,
      asset_id,
      parameter_value,
      isOutOfBounds,
      asset.min_safe_limit,
      asset.max_safe_limit,
      recorded_at,
      client_mutation_id || null
    ]);

    const savedLog = await database.getAsync('SELECT * FROM shift_logs WHERE log_id = ?', [logId]);

    // Log Audit Event
    await logAuditEvent({
      actorId: req.user.user_id,
      actorRole: req.user.role_name,
      actionType: 'CREATE',
      targetTable: 'shift_logs',
      targetRowId: logId,
      afterState: savedLog,
      sourceIp: req.ip,
      sourceDeviceFingerprint: req.headers['user-agent']
    });

    res.status(201).json(savedLog);
  } catch (error) {
    console.error('Log creation error:', error);
    res.status(500).json({ error: 'Failed to create log entry' });
  }
});

// 5. Fetch active handovers
app.get('/api/v1/handovers', authenticateUser, async (req, res) => {
  try {
    const handovers = await database.allAsync(`
      SELECT h.*, u1.username as outgoing_name, u2.username as incoming_name
      FROM handovers h
      LEFT JOIN users u1 ON h.outgoing_shift_in_charge = u1.user_id
      LEFT JOIN users u2 ON h.incoming_shift_in_charge = u2.user_id
      ORDER BY h.created_at DESC
      LIMIT 50
    `);
    res.json(handovers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch handovers' });
  }
});

// 6. Submit Shift Handover
app.post('/api/v1/handovers', authenticateUser, async (req, res) => {
  const {
    shift_date,
    shift_type,
    equipment_status_summary,
    active_incidents_summary,
    active_permits_summary,
    status, // DRAFT or PENDING_INCOMING
    incoming_shift_in_charge_id,
  } = req.body;

  try {
    // REQ-8.4: Block handover if unacknowledged CRITICAL/HIGH incidents exist
    if (status === 'PENDING_INCOMING') {
      const blockers = await database.allAsync(
        `SELECT incident_id, severity, title FROM incidents WHERE severity IN ('CRITICAL','HIGH') AND status = 'DECLARED'`
      );
      if (blockers.length > 0) {
        return res.status(400).json({
          error: 'Handover blocked: unacknowledged CRITICAL/HIGH incidents must be assigned first.',
          blockers: blockers.map(b => ({ id: b.incident_id, severity: b.severity, title: b.title }))
        });
      }
    }

    // Resolve incoming_shift_in_charge: accept either a user_id (UUID) or a username
    let incomingUserId = incoming_shift_in_charge_id || null;
    if (incomingUserId) {
      // If it doesn't look like a UUID, treat it as a username and look up the real user_id
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(incomingUserId);
      if (!isUUID) {
        const resolvedUser = await database.getAsync('SELECT user_id FROM users WHERE username = ?', [incomingUserId]);
        incomingUserId = resolvedUser ? resolvedUser.user_id : null;
      }
    }

    const handoverId = crypto.randomUUID();
    await database.runAsync(`
      INSERT INTO handovers (
        handover_id, outgoing_shift_in_charge, incoming_shift_in_charge, shift_date, shift_type,
        equipment_status_summary, active_incidents_summary, active_permits_summary, status, outgoing_signed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      handoverId,
      req.user.user_id,
      incomingUserId,
      shift_date,
      shift_type,
      equipment_status_summary,
      active_incidents_summary,
      active_permits_summary,
      status || 'DRAFT',
      status === 'PENDING_INCOMING' ? new Date().toISOString() : null
    ]);

    const savedHandover = await database.getAsync('SELECT * FROM handovers WHERE handover_id = ?', [handoverId]);

    await logAuditEvent({
      actorId: req.user.user_id,
      actorRole: req.user.role_name,
      actionType: 'CREATE_HANDOVER',
      targetTable: 'handovers',
      targetRowId: handoverId,
      afterState: savedHandover,
      sourceIp: req.ip,
      sourceDeviceFingerprint: req.headers['user-agent']
    });

    res.status(201).json(savedHandover);
  } catch (error) {
    console.error('Handover creation error:', error);
    res.status(500).json({ error: 'Failed to submit handover' });
  }
});

// 7. Acknowledge Handover (Incoming Supervisor)
app.post('/api/v1/handovers/:id/acknowledge', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const { pin } = req.body;

  if (pin !== '1234') {
    return res.status(400).json({ error: 'Invalid verification pin' });
  }

  try {
    const handover = await database.getAsync('SELECT * FROM handovers WHERE handover_id = ?', [id]);
    if (!handover) {
      return res.status(404).json({ error: 'Handover not found' });
    }

    if (handover.status !== 'PENDING_INCOMING') {
      return res.status(400).json({ error: 'Handover is not in pending status' });
    }

    await database.runAsync(`
      UPDATE handovers
      SET status = 'COMPLETED', incoming_shift_in_charge = ?, incoming_signed_at = ?
      WHERE handover_id = ?
    `, [req.user.user_id, new Date().toISOString(), id]);

    const updated = await database.getAsync('SELECT * FROM handovers WHERE handover_id = ?', [id]);

    await logAuditEvent({
      actorId: req.user.user_id,
      actorRole: req.user.role_name,
      actionType: 'APPROVE_HANDOVER',
      targetTable: 'handovers',
      targetRowId: id,
      beforeState: handover,
      afterState: updated,
      sourceIp: req.ip,
      sourceDeviceFingerprint: req.headers['user-agent']
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to acknowledge handover' });
  }
});

// 8. Incidents Endpoints
app.get('/api/v1/incidents', authenticateUser, async (req, res) => {
  try {
    const incidents = await database.allAsync(`
      SELECT i.*, a.asset_tag, u.username as reporter_name
      FROM incidents i
      LEFT JOIN assets a ON i.asset_id = a.asset_id
      LEFT JOIN users u ON i.reporter_id = u.user_id
      ORDER BY i.created_at DESC
    `);
    res.json(incidents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

app.post('/api/v1/incidents', authenticateUser, async (req, res) => {
  const { title, description, severity, asset_id } = req.body;
  if (!title || !description || !severity) {
    return res.status(400).json({ error: 'Missing required incident fields' });
  }

  try {
    const incidentId = crypto.randomUUID();
    const slaDeadline = new Date();
    // SLA thresholds: Critical 15m, High 1h, Medium 4h, Low 24h
    if (severity === 'CRITICAL') slaDeadline.setMinutes(slaDeadline.getMinutes() + 15);
    else if (severity === 'HIGH') slaDeadline.setHours(slaDeadline.getHours() + 1);
    else if (severity === 'MEDIUM') slaDeadline.setHours(slaDeadline.getHours() + 4);
    else slaDeadline.setHours(slaDeadline.getHours() + 24);

    await database.runAsync(`
      INSERT INTO incidents (
        incident_id, reporter_id, asset_id, title, description, severity, status, sla_escalation_deadline
      ) VALUES (?, ?, ?, ?, ?, ?, 'DECLARED', ?)
    `, [incidentId, req.user.user_id, asset_id || null, title, description, severity, slaDeadline.toISOString()]);

    const saved = await database.getAsync('SELECT * FROM incidents WHERE incident_id = ?', [incidentId]);

    await logAuditEvent({
      actorId: req.user.user_id,
      actorRole: req.user.role_name,
      actionType: 'CREATE_INCIDENT',
      targetTable: 'incidents',
      targetRowId: incidentId,
      afterState: saved,
      sourceIp: req.ip,
      sourceDeviceFingerprint: req.headers['user-agent']
    });

    res.status(201).json(saved);
  } catch (error) {
    console.error('Incident declaration error:', error);
    res.status(500).json({ error: 'Failed to create incident' });
  }
});

// Incident State Machine: PATCH /api/v1/incidents/:id
// Transitions: DECLARED→ACKNOWLEDGED, ACKNOWLEDGED→INVESTIGATION, INVESTIGATION→CLOSED
const VALID_TRANSITIONS = {
  DECLARED: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['INVESTIGATION'],
  INVESTIGATION: ['CLOSED'],
};

app.patch('/api/v1/incidents/:id', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const { action, rca_findings } = req.body; // action: 'acknowledge' | 'investigate' | 'close'

  const actionToStatus = { acknowledge: 'ACKNOWLEDGED', investigate: 'INVESTIGATION', close: 'CLOSED' };
  const newStatus = actionToStatus[action];
  if (!newStatus) return res.status(400).json({ error: 'Invalid action. Use: acknowledge, investigate, close' });

  try {
    const incident = await database.getAsync('SELECT * FROM incidents WHERE incident_id = ?', [id]);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const allowed = VALID_TRANSITIONS[incident.status] || [];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({
        error: `Invalid transition: ${incident.status} → ${newStatus}. Allowed: ${allowed.join(', ') || 'none'}`
      });
    }

    const now = new Date().toISOString();
    await database.runAsync(`
      UPDATE incidents SET status = ?,
        acknowledged_by = CASE WHEN ? = 'ACKNOWLEDGED' THEN ? ELSE acknowledged_by END,
        acknowledged_at = CASE WHEN ? = 'ACKNOWLEDGED' THEN ? ELSE acknowledged_at END,
        rca_findings = CASE WHEN ? IS NOT NULL THEN ? ELSE rca_findings END,
        closure_signed_by = CASE WHEN ? = 'CLOSED' THEN ? ELSE closure_signed_by END,
        closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE closed_at END
      WHERE incident_id = ?
    `, [
      newStatus,
      newStatus, req.user.user_id,
      newStatus, now,
      rca_findings, rca_findings,
      newStatus, req.user.user_id,
      newStatus, now,
      id
    ]);

    const updated = await database.getAsync('SELECT * FROM incidents WHERE incident_id = ?', [id]);

    await logAuditEvent({
      actorId: req.user.user_id,
      actorRole: req.user.role_name,
      actionType: `INCIDENT_${newStatus}`,
      targetTable: 'incidents',
      targetRowId: id,
      beforeState: incident,
      afterState: updated,
      sourceIp: req.ip,
      sourceDeviceFingerprint: req.headers['user-agent']
    });

    res.json(updated);
  } catch (error) {
    console.error('Incident state transition error:', error);
    res.status(500).json({ error: 'Failed to update incident status' });
  }
});


// 9. Sync Endpoint (Batch offline queues)
app.post('/api/v1/sync', authenticateUser, async (req, res) => {
  const { mutations, device_fingerprint } = req.body;
  if (!mutations || !Array.isArray(mutations)) {
    return res.status(400).json({ error: 'Invalid mutations format' });
  }

  const results = [];
  let applied = 0;
  let conflicts = 0;

  for (const mut of mutations) {
    const { mutation_id, target_table, action, payload, offline_timestamp } = mut;

    try {
      if (target_table === 'shift_logs') {
        // Check duplication
        const existing = await database.getAsync('SELECT log_id FROM shift_logs WHERE client_mutation_id = ?', [mutation_id]);
        if (existing) {
          results.push({ mutation_id, status: 'SUCCESS', server_id: existing.log_id });
          applied++;
          continue;
        }

        // Fetch asset limits
        const asset = await database.getAsync('SELECT min_safe_limit, max_safe_limit FROM assets WHERE asset_id = ?', [payload.asset_id]);
        const isOutOfBounds = checkOutOfBounds(payload.parameter_value, asset.min_safe_limit, asset.max_safe_limit) ? 1 : 0;
        const logId = crypto.randomUUID();

        await database.runAsync(`
          INSERT INTO shift_logs (
            log_id, user_id, asset_id, parameter_value, is_out_of_bounds, min_safe_limit, max_safe_limit, recorded_at, offline_created_at, sync_status, client_mutation_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?)
        `, [
          logId,
          req.user.user_id,
          payload.asset_id,
          payload.parameter_value,
          isOutOfBounds,
          asset.min_safe_limit,
          asset.max_safe_limit,
          payload.recorded_at,
          offline_timestamp,
          mutation_id
        ]);

        const saved = await database.getAsync('SELECT * FROM shift_logs WHERE log_id = ?', [logId]);
        await logAuditEvent({
          actorId: req.user.user_id,
          actorRole: req.user.role_name,
          actionType: 'CREATE_OFFLINE',
          targetTable: 'shift_logs',
          targetRowId: logId,
          afterState: saved,
          sourceIp: req.ip,
          sourceDeviceFingerprint: device_fingerprint || req.headers['user-agent']
        });

        results.push({ mutation_id, status: 'SUCCESS', server_id: logId });
        applied++;
      } else if (target_table === 'incidents') {
        const incidentId = crypto.randomUUID();
        const slaDeadline = new Date(offline_timestamp || Date.now());
        if (payload.severity === 'CRITICAL') slaDeadline.setMinutes(slaDeadline.getMinutes() + 15);
        else slaDeadline.setHours(slaDeadline.getHours() + 4);

        await database.runAsync(`
          INSERT INTO incidents (
            incident_id, reporter_id, asset_id, title, description, severity, status, sla_escalation_deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'DECLARED', ?, ?)
        `, [
          incidentId,
          req.user.user_id,
          payload.asset_id || null,
          payload.title,
          payload.description,
          payload.severity,
          slaDeadline.toISOString(),
          offline_timestamp || new Date().toISOString()
        ]);

        const saved = await database.getAsync('SELECT * FROM incidents WHERE incident_id = ?', [incidentId]);
        await logAuditEvent({
          actorId: req.user.user_id,
          actorRole: req.user.role_name,
          actionType: 'CREATE_INCIDENT_OFFLINE',
          targetTable: 'incidents',
          targetRowId: incidentId,
          afterState: saved,
          sourceIp: req.ip,
          sourceDeviceFingerprint: device_fingerprint || req.headers['user-agent']
        });

        results.push({ mutation_id, status: 'SUCCESS', server_id: incidentId });
        applied++;
      } else {
        results.push({ mutation_id, status: 'SKIPPED', error: 'Table sync not supported yet' });
        conflicts++;
      }
    } catch (err) {
      console.error('Error syncing mutation:', mut, err);
      results.push({ mutation_id, status: 'ERROR', error: err.message });
      conflicts++;
    }
  }

  res.json({
    sync_summary: {
      total_received: mutations.length,
      applied,
      conflicts
    },
    results
  });
});

// 10. Audit log endpoint
app.get('/api/v1/audit-logs', authenticateUser, async (req, res) => {
  if (req.user.role_name !== 'CORPORATE_AUDITOR' && req.user.role_name !== 'SHIFT_IN_CHARGE') {
    return res.status(403).json({ error: 'Access denied: Audit authorization required' });
  }

  try {
    const rawEvents = await database.allAsync(`
      SELECT a.*, u.username
      FROM audit_events a
      LEFT JOIN users u ON a.actor_id = u.user_id
      ORDER BY a.event_timestamp DESC
    `);

    // Add validation flag in real-time to each row
    const events = rawEvents.map(event => {
      const isVerified = verifyAuditRow(event);
      return {
        ...event,
        verified: isVerified
      };
    });

    res.json(events);
  } catch (error) {
    console.error('Error loading audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// 11. Admin User Management Endpoints
const verifyAdmin = (req, res, next) => {
  if (req.user.role_name !== 'SYSTEM_ADMIN') {
    return res.status(403).json({ error: 'Access denied: System Administrator privileges required' });
  }
  next();
};

app.get('/api/v1/admin/users', authenticateUser, verifyAdmin, async (req, res) => {
  try {
    const users = await database.allAsync(`
      SELECT u.user_id, u.username, u.email, u.plant_zone, u.is_active, r.role_id, r.role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.role_id
      ORDER BY u.username ASC
    `);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users list' });
  }
});

app.get('/api/v1/admin/roles', authenticateUser, verifyAdmin, async (req, res) => {
  try {
    const roles = await database.allAsync('SELECT role_id, role_name, description FROM roles');
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

app.post('/api/v1/admin/users', authenticateUser, verifyAdmin, async (req, res) => {
  const { username, email, password, role_id, plant_zone } = req.body;
  if (!username || !email || !password || !role_id || !plant_zone) {
    return res.status(400).json({ error: 'Missing required user fields' });
  }

  try {
    const hashed = crypto.createHash('sha256').update(password).digest('hex');
    const userId = crypto.randomUUID();

    await database.runAsync(`
      INSERT INTO users (user_id, username, email, password_hash, role_id, plant_zone, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `, [userId, username, email, hashed, role_id, plant_zone]);

    const createdUser = await database.getAsync(`
      SELECT u.user_id, u.username, u.email, u.plant_zone, r.role_name
      FROM users u
      JOIN roles r ON u.role_id = r.role_id
      WHERE u.user_id = ?
    `, [userId]);

    await logAuditEvent({
      actorId: req.user.user_id,
      actorRole: req.user.role_name,
      actionType: 'CREATE_USER',
      targetTable: 'users',
      targetRowId: userId,
      afterState: createdUser,
      sourceIp: req.ip,
      sourceDeviceFingerprint: req.headers['user-agent']
    });

    res.status(201).json(createdUser);
  } catch (error) {
    console.error('User creation error:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username or Email already exists' });
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.patch('/api/v1/admin/users/:id/role', authenticateUser, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { role_id } = req.body;
  if (!role_id) {
    return res.status(400).json({ error: 'role_id is required' });
  }

  try {
    const existing = await database.getAsync('SELECT * FROM users WHERE user_id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    await database.runAsync('UPDATE users SET role_id = ? WHERE user_id = ?', [role_id, id]);

    const updated = await database.getAsync(`
      SELECT u.user_id, u.username, u.email, u.plant_zone, r.role_name
      FROM users u
      JOIN roles r ON u.role_id = r.role_id
      WHERE u.user_id = ?
    `, [id]);

    await logAuditEvent({
      actorId: req.user.user_id,
      actorRole: req.user.role_name,
      actionType: 'UPDATE_USER_ROLE',
      targetTable: 'users',
      targetRowId: id,
      beforeState: existing,
      afterState: updated,
      sourceIp: req.ip,
      sourceDeviceFingerprint: req.headers['user-agent']
    });

    res.json(updated);
  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// WebSocket Server for Voice Communications (Walkie-Talkie)
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Extract token from query params or headers if needed, for simplicity we broadcast to all
  ws.on('message', (message) => {
    // message is a JSON string or Buffer. We expect it to be a JSON with audio data or just broadcast the raw blob.
    // For simplicity, we assume messages are JSON containing { type: 'audio', data: base64, sender: '...', role: '...' }
    
    // Broadcast to all other clients
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) { // 1 is WebSocket.OPEN
        client.send(message);
      }
    });
  });
});
