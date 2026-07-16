const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'iocl_operations.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected at:', dbPath);
  }
});

// Enable foreign keys and WAL mode
db.run('PRAGMA foreign_keys = ON;');
db.run('PRAGMA journal_mode = WAL;');

// Helper to run query as promise
const runAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

// Helper to get query as promise
const getAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Helper to all query as promise
const allAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Setup schemas
async function initDatabase() {
  try {
    // 1. Roles table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS roles (
        role_id TEXT PRIMARY KEY,
        role_name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Users table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role_id TEXT,
        plant_zone TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE RESTRICT
      )
    `);

    // 3. Asset Registry table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS assets (
        asset_id TEXT PRIMARY KEY,
        asset_tag TEXT UNIQUE NOT NULL,
        asset_name TEXT NOT NULL,
        plant_zone TEXT NOT NULL,
        description TEXT,
        min_safe_limit REAL,
        max_safe_limit REAL,
        metric_unit TEXT,
        is_isolated INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Shift Logs table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS shift_logs (
        log_id TEXT PRIMARY KEY,
        user_id TEXT,
        asset_id TEXT,
        parameter_value REAL NOT NULL,
        is_out_of_bounds INTEGER NOT NULL,
        min_safe_limit REAL NOT NULL,
        max_safe_limit REAL NOT NULL,
        recorded_at TEXT NOT NULL,
        offline_created_at TEXT,
        sync_status TEXT DEFAULT 'SYNCED',
        client_mutation_id TEXT UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id),
        FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
      )
    `);

    // 5. Handovers table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS handovers (
        handover_id TEXT PRIMARY KEY,
        outgoing_shift_in_charge TEXT,
        incoming_shift_in_charge TEXT,
        shift_date TEXT NOT NULL,
        shift_type TEXT NOT NULL,
        equipment_status_summary TEXT NOT NULL,
        active_incidents_summary TEXT NOT NULL,
        active_permits_summary TEXT NOT NULL,
        status TEXT DEFAULT 'DRAFT',
        outgoing_signed_at TEXT,
        incoming_signed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (outgoing_shift_in_charge) REFERENCES users(user_id),
        FOREIGN KEY (incoming_shift_in_charge) REFERENCES users(user_id)
      )
    `);

    // 6. Incidents table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS incidents (
        incident_id TEXT PRIMARY KEY,
        reporter_id TEXT,
        asset_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT DEFAULT 'DECLARED',
        sla_escalation_deadline TEXT,
        is_escalated INTEGER DEFAULT 0,
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        rca_findings TEXT,
        closure_signed_by TEXT,
        closed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reporter_id) REFERENCES users(user_id),
        FOREIGN KEY (asset_id) REFERENCES assets(asset_id),
        FOREIGN KEY (acknowledged_by) REFERENCES users(user_id),
        FOREIGN KEY (closure_signed_by) REFERENCES users(user_id)
      )
    `);

    // 7. Permits Table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS permits (
        permit_id TEXT PRIMARY KEY,
        permit_number TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        asset_id TEXT,
        applicant_id TEXT,
        approver_id TEXT,
        status TEXT DEFAULT 'PTW_DRAFT',
        valid_from TEXT,
        valid_until TEXT,
        safety_precautions TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (asset_id) REFERENCES assets(asset_id),
        FOREIGN KEY (applicant_id) REFERENCES users(user_id),
        FOREIGN KEY (approver_id) REFERENCES users(user_id)
      )
    `);

    // 8. LOTO Record table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS loto_records (
        loto_id TEXT PRIMARY KEY,
        permit_id TEXT,
        asset_id TEXT,
        isolation_point TEXT NOT NULL,
        lock_number TEXT NOT NULL,
        tag_description TEXT,
        applied_by TEXT,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
        removed_by TEXT,
        removed_at TEXT,
        FOREIGN KEY (permit_id) REFERENCES permits(permit_id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES assets(asset_id),
        FOREIGN KEY (applied_by) REFERENCES users(user_id),
        FOREIGN KEY (removed_by) REFERENCES users(user_id)
      )
    `);

    // 9. Audit Events table (Immutable Logs)
    await runAsync(`
      CREATE TABLE IF NOT EXISTS audit_events (
        audit_id TEXT PRIMARY KEY,
        actor_id TEXT,
        actor_role TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target_table TEXT NOT NULL,
        target_row_id TEXT NOT NULL,
        before_state TEXT,
        after_state TEXT,
        source_ip TEXT NOT NULL,
        source_device_fingerprint TEXT,
        event_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        payload_hash TEXT NOT NULL,
        FOREIGN KEY (actor_id) REFERENCES users(user_id)
      )
    `);

    // Seed Roles
    const rolesCount = await getAsync('SELECT count(*) as count FROM roles');
    if (rolesCount.count === 0) {
      await runAsync("INSERT INTO roles (role_id, role_name, description) VALUES (?, 'PLANT_OPERATOR', 'Logs hourly readings, triggers incidents, requests permits')", [crypto.randomUUID()]);
      await runAsync("INSERT INTO roles (role_id, role_name, description) VALUES (?, 'SHIFT_IN_CHARGE', 'Reviews and signs off handovers, releases standing orders')", [crypto.randomUUID()]);
      await runAsync("INSERT INTO roles (role_id, role_name, description) VALUES (?, 'SAFETY_OFFICER', 'Approves PTW/LOTO, oversees incident RCAs and closures')", [crypto.randomUUID()]);
      await runAsync("INSERT INTO roles (role_id, role_name, description) VALUES (?, 'CORPORATE_AUDITOR', 'Read-only access to historical logs and reports')", [crypto.randomUUID()]);
      await runAsync("INSERT INTO roles (role_id, role_name, description) VALUES (?, 'SYSTEM_ADMIN', 'Manages users, roles, and system parameters')", [crypto.randomUUID()]);
    }

    // Seed Users
    const usersCount = await getAsync('SELECT count(*) as count FROM users');
    if (usersCount.count === 0) {
      const operatorRole = await getAsync("SELECT role_id FROM roles WHERE role_name = 'PLANT_OPERATOR'");
      const supervisorRole = await getAsync("SELECT role_id FROM roles WHERE role_name = 'SHIFT_IN_CHARGE'");
      const safetyRole = await getAsync("SELECT role_id FROM roles WHERE role_name = 'SAFETY_OFFICER'");
      const auditorRole = await getAsync("SELECT role_id FROM roles WHERE role_name = 'CORPORATE_AUDITOR'");
      const adminRole = await getAsync("SELECT role_id FROM roles WHERE role_name = 'SYSTEM_ADMIN'");

      // Simplistic hash for testing: SHA256 of 'password123'
      const hashedPw = crypto.createHash('sha256').update('password123').digest('hex');

      await runAsync("INSERT INTO users (user_id, username, email, password_hash, role_id, plant_zone) VALUES (?, 'operator_user', 'operator@iocl.in', ?, ?, 'ZONE_A_DISTILLATION')", [crypto.randomUUID(), hashedPw, operatorRole.role_id]);
      await runAsync("INSERT INTO users (user_id, username, email, password_hash, role_id, plant_zone) VALUES (?, 'supervisor_user', 'supervisor@iocl.in', ?, ?, 'ZONE_A_DISTILLATION')", [crypto.randomUUID(), hashedPw, supervisorRole.role_id]);
      await runAsync("INSERT INTO users (user_id, username, email, password_hash, role_id, plant_zone) VALUES (?, 'safety_user', 'safety@iocl.in', ?, ?, 'ALL_ZONES')", [crypto.randomUUID(), hashedPw, safetyRole.role_id]);
      await runAsync("INSERT INTO users (user_id, username, email, password_hash, role_id, plant_zone) VALUES (?, 'auditor_user', 'auditor@iocl.in', ?, ?, 'ALL_ZONES')", [crypto.randomUUID(), hashedPw, auditorRole.role_id]);
      await runAsync("INSERT INTO users (user_id, username, email, password_hash, role_id, plant_zone) VALUES (?, 'admin_user', 'admin@iocl.in', ?, ?, 'ALL_ZONES')", [crypto.randomUUID(), hashedPw, adminRole.role_id]);
    }

    // Seed Assets
    const assetsCount = await getAsync('SELECT count(*) as count FROM assets');
    if (assetsCount.count === 0) {
      await runAsync(`
        INSERT INTO assets (asset_id, asset_tag, asset_name, plant_zone, description, min_safe_limit, max_safe_limit, metric_unit)
        VALUES (?, 'C-101', 'Air Compressor Primary', 'ZONE_A_DISTILLATION', 'Main air compressor for pressure lines', 10.0, 15.0, 'Bar')
      `, [crypto.randomUUID()]);
      await runAsync(`
        INSERT INTO assets (asset_id, asset_tag, asset_name, plant_zone, description, min_safe_limit, max_safe_limit, metric_unit)
        VALUES (?, 'T-202', 'Boiler Feed Pump Temp', 'ZONE_B_BOILERS', 'Temperature sensor on water supply', 150.0, 220.0, '°C')
      `, [crypto.randomUUID()]);
      await runAsync(`
        INSERT INTO assets (asset_id, asset_tag, asset_name, plant_zone, description, min_safe_limit, max_safe_limit, metric_unit)
        VALUES (?, 'L-303', 'Distillation Tower Level', 'ZONE_A_DISTILLATION', 'Level indicator on heavy crude tower', 20.0, 80.0, '%')
      `, [crypto.randomUUID()]);
      await runAsync(`
        INSERT INTO assets (asset_id, asset_tag, asset_name, plant_zone, description, min_safe_limit, max_safe_limit, metric_unit)
        VALUES (?, 'P-404', 'LPG Tank Pressure', 'ZONE_C_LPG', 'Pressure valve on storage tank 404', 2.0, 8.0, 'Bar')
      `, [crypto.randomUUID()]);
    }

    console.log('Database schema initialization completed.');
  } catch (error) {
    console.error('Error initializing database tables:', error);
  }
}

// Initialize database
const initPromise = initDatabase();

module.exports = {
  db,
  runAsync,
  getAsync,
  allAsync,
  initPromise
};
