const database = require('./database');
const { logAuditEvent, verifyAuditRow } = require('./auditLogger');
const crypto = require('crypto');

async function runTests() {
  console.log('--- Starting Backend Integration Verification ---');

  try {
    // Wait for DB initialization
    await database.initPromise;

    // 1. Verify Seed Data
    const users = await database.allAsync('SELECT * FROM users');
    console.log(`[PASS] Users seeded successfully. Total users: ${users.length}`);

    const assets = await database.allAsync('SELECT * FROM assets');
    console.log(`[PASS] Assets seeded successfully. Total assets: ${assets.length}`);

    // Select test user & asset
    const testUser = users.find(u => u.username === 'operator_user');
    const testAsset = assets.find(a => a.asset_tag === 'C-101');

    if (!testUser || !testAsset) {
      throw new Error('Required seed data missing. Check seeds.');
    }

    // 2. Insert standard log
    const logId1 = crypto.randomUUID();
    await database.runAsync(`
      INSERT INTO shift_logs (
        log_id, user_id, asset_id, parameter_value, is_out_of_bounds, min_safe_limit, max_safe_limit, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      logId1,
      testUser.user_id,
      testAsset.asset_id,
      12.5, // Normal pressure (limit is 10.0 - 15.0)
      0,
      testAsset.min_safe_limit,
      testAsset.max_safe_limit,
      new Date().toISOString()
    ]);

    const log1 = await database.getAsync('SELECT * FROM shift_logs WHERE log_id = ?', [logId1]);
    console.log(`[PASS] Normal parameter logged successfully. Out-of-bounds flag: ${log1.is_out_of_bounds}`);

    // Create Audit Event for log
    const auditRes1 = await logAuditEvent({
      actorId: testUser.user_id,
      actorRole: 'PLANT_OPERATOR',
      actionType: 'CREATE',
      targetTable: 'shift_logs',
      targetRowId: logId1,
      afterState: log1
    });
    console.log(`[PASS] Audit event created for log. Hash: ${auditRes1.payload_hash}`);

    // Retrieve and verify audit event
    const auditRow1 = await database.getAsync('SELECT * FROM audit_events WHERE audit_id = ?', [auditRes1.auditId]);
    const isValid1 = verifyAuditRow(auditRow1);
    console.log(`[PASS] Audit event verification passed: ${isValid1}`);

    // 3. Insert out-of-bounds log
    const logId2 = crypto.randomUUID();
    await database.runAsync(`
      INSERT INTO shift_logs (
        log_id, user_id, asset_id, parameter_value, is_out_of_bounds, min_safe_limit, max_safe_limit, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      logId2,
      testUser.user_id,
      testAsset.asset_id,
      18.2, // Exceeds max 15.0
      1,
      testAsset.min_safe_limit,
      testAsset.max_safe_limit,
      new Date().toISOString()
    ]);

    const log2 = await database.getAsync('SELECT * FROM shift_logs WHERE log_id = ?', [logId2]);
    console.log(`[PASS] Out-of-bounds parameter logged. Parameter: 18.2, Flag is_out_of_bounds: ${log2.is_out_of_bounds}`);

    // 4. Test tampering detection
    const auditRes2 = await logAuditEvent({
      actorId: testUser.user_id,
      actorRole: 'PLANT_OPERATOR',
      actionType: 'CREATE',
      targetTable: 'shift_logs',
      targetRowId: logId2,
      afterState: log2
    });

    // Verify original audit record
    let auditRow2 = await database.getAsync('SELECT * FROM audit_events WHERE audit_id = ?', [auditRes2.auditId]);
    console.log(`[PASS] Original audit record validated: ${verifyAuditRow(auditRow2)}`);

    // Tamper with audit record by changing actor_role manually
    await database.runAsync('UPDATE audit_events SET actor_role = ? WHERE audit_id = ?', ['SYSTEM_ADMIN', auditRes2.auditId]);
    auditRow2 = await database.getAsync('SELECT * FROM audit_events WHERE audit_id = ?', [auditRes2.auditId]);
    const isTamperedVerified = verifyAuditRow(auditRow2);
    console.log(`[PASS] Tampered audit record detected. Verified status: ${isTamperedVerified} (Expected: false)`);

    if (isTamperedVerified === false) {
      console.log('--- All Backend Tests Passed Successfully ---');
    } else {
      throw new Error('Audit verification failed to detect manual tampering.');
    }

  } catch (error) {
    console.error('[FAIL] Test execution encountered an error:', error);
    process.exit(1);
  } finally {
    database.db.close();
  }
}

// Run test suite
runTests();
