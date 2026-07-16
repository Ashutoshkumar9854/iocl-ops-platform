# IOCL Digital Logbook & Operations Platform — Developer Documentation

Welcome to the IOCL Digital Logbook & Operations Platform. This system replaces legacy paper logbooks, fragmented shift handovers, and ad hoc communications in refinery and downstream energy operations with a secure, offline-resilient, and regulator-auditable digital platform.

---

## 1. Directory Structure & Architecture

```
.
├── backend/
│   ├── database.js          # SQLite database connection, table schemas, and default seed data
│   ├── auditLogger.js       # SHA-256 tamper-evident event hashing and cryptographic row verification
│   ├── server.js            # Express API server, REST controllers, and offline queue synchronization
│   ├── test.js              # Backend database integrity and tamper-detection integration test suite
│   └── package.json         # Node dependencies (express, cors, sqlite3)
└── frontend/
    ├── src/
    │   ├── App.jsx          # Central React application shell with state, workflows, and tab navigation
    │   ├── index.css        # Curated HSL Zinc styling system (light/dark themes, premium aesthetics)
    │   ├── main.jsx         # SPA entry point
    │   ├── services/
    │   │   ├── db.js        # Local IndexedDB persistence wrapper (offline log and incident queue)
    │   │   └── sync.js      # Synchronizer client pushing queued offline mutations to backend
    │   └── styles/
    └── index.html           # SPA root template
```

---

## 2. Tech Stack & Integration Details

1. **Frontend Core**: React SPA scaffolded with Vite. Styling is written using Vanilla CSS (`index.css`) mapped to modern HSL variable tokens. No heavy frameworks (like TailwindCSS or Bootstrap) are used, maintaining full styling control.
2. **Offline Resilience**: Runs an offline-first state-machine. Read/write mutations are cached locally inside **IndexedDB** using custom client queues.
3. **Backend Service**: Built on Node.js + Express with an embedded SQLite database (`backend/iocl_operations.db`), mimicking the PostgreSQL enterprise schema for portability.
4. **Security & Cryptography**: Log actions, handovers, and incidents require step-up authentication (4-digit digital PIN, default: `1234`). Every mutation is cryptographically signed using SHA-256 of the row columns and actor variables.

---

## 3. SQLite Database Schema Layout

Below is the database structure defined in `backend/database.js`:

```sql
-- 1. Roles
CREATE TABLE IF NOT EXISTS roles (
  role_id TEXT PRIMARY KEY,
  role_name TEXT UNIQUE NOT NULL,
  description TEXT
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id TEXT REFERENCES roles(role_id),
  plant_zone TEXT NOT NULL,
  is_active INTEGER DEFAULT 1
);

-- 3. Asset Registry
CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  asset_tag TEXT UNIQUE NOT NULL,
  asset_name TEXT NOT NULL,
  plant_zone TEXT NOT NULL,
  min_safe_limit REAL,
  max_safe_limit REAL,
  metric_unit TEXT
);

-- 4. Shift Logs
CREATE TABLE IF NOT EXISTS shift_logs (
  log_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id),
  asset_id TEXT REFERENCES assets(asset_id),
  parameter_value REAL NOT NULL,
  is_out_of_bounds INTEGER NOT NULL,
  min_safe_limit REAL NOT NULL,
  max_safe_limit REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  offline_created_at TEXT,
  sync_status TEXT DEFAULT 'SYNCED',
  client_mutation_id TEXT UNIQUE
);

-- 5. Handovers
CREATE TABLE IF NOT EXISTS handovers (
  handover_id TEXT PRIMARY KEY,
  outgoing_shift_in_charge TEXT REFERENCES users(user_id),
  incoming_shift_in_charge TEXT REFERENCES users(user_id),
  shift_date TEXT NOT NULL,
  shift_type TEXT NOT NULL,
  equipment_status_summary TEXT NOT NULL,
  active_incidents_summary TEXT NOT NULL,
  active_permits_summary TEXT NOT NULL,
  status TEXT DEFAULT 'DRAFT', -- 'DRAFT', 'PENDING_INCOMING', 'COMPLETED'
  outgoing_signed_at TEXT,
  incoming_signed_at TEXT
);

-- 6. Incidents
CREATE TABLE IF NOT EXISTS incidents (
  incident_id TEXT PRIMARY KEY,
  reporter_id TEXT REFERENCES users(user_id),
  asset_id TEXT REFERENCES assets(asset_id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL, -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  status TEXT DEFAULT 'DECLARED', -- 'DECLARED', 'ACKNOWLEDGED', 'INVESTIGATION', 'CLOSED'
  sla_escalation_deadline TEXT,
  acknowledged_by TEXT REFERENCES users(user_id),
  acknowledged_at TEXT,
  rca_findings TEXT,
  closure_signed_by TEXT REFERENCES users(user_id),
  closed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 7. Audit Events
CREATE TABLE IF NOT EXISTS audit_events (
  audit_id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(user_id),
  actor_role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_row_id TEXT NOT NULL,
  before_state TEXT,
  after_state TEXT,
  source_ip TEXT NOT NULL,
  source_device_fingerprint TEXT,
  event_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  payload_hash TEXT NOT NULL
);
```

---

## 4. API Endpoint Reference

All non-auth REST requests require authentication via the `Authorization` header containing the user's token UUID (e.g. `Authorization: Bearer <user_id>`).

| Method | Endpoint | Description | Access Control |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | Log in user and fetch token + profile details | Public |
| `GET` | `/api/v1/assets` | Get all plant assets with safe limits | Authenticated |
| `GET` | `/api/v1/logs` | Fetch shift log parameter readings | Authenticated |
| `POST` | `/api/v1/logs` | Create a log entry (checks SOL and out-of-bounds) | Operators, Supervisors |
| `GET` | `/api/v1/incidents` | List declared shift incidents | Authenticated |
| `POST` | `/api/v1/incidents` | Declare an incident (sets SLA escalation deadlines) | Authenticated |
| `PATCH` | `/api/v1/incidents/:id` | Transition incident state (Acknowledge / RCA findings / Close) | Authenticated |
| `GET` | `/api/v1/handovers` | List historical and pending handovers | Authenticated |
| `POST` | `/api/v1/handovers` | Submit handover wizard data (Blocked if unassigned incidents exist) | Shift In-Charge |
| `POST` | `/api/v1/handovers/:id/acknowledge` | Sign-off incoming handover (resolves custody) | Shift In-Charge |
| `POST` | `/api/v1/sync` | Batch resolve offline mutations queue | Authenticated |
| `GET` | `/api/v1/audit-logs` | Fetch system audit trail with recalculation verifications | Auditors, Supervisors |

---

## 5. Offline Sync & Conflict Protocols

- **Queuing**: When network connectivity fails, browser queries to index or save details are rerouted to `IndexedDB` stores. The UI labels these entries in amber as `PENDING`.
- **Syncing**: Once connectivity is restored, the client reads the queue sequentially and posts payloads in chronological order to `/api/v1/sync`.
- **Conflicts (LWW)**: If duplicate parameter writes are detected, the system logs both to the audit registry, but preserves the latest NTP-timestamped entry as the state value.
- **Handover Constraint (REQ-8.4)**: Outgoing Shift In-Charges cannot execute handover sign-offs on the server if there are unassigned, unacknowledged CRITICAL or HIGH incidents in the plant. The server returns `400 Bad Request` to enforce process safety.

---

## 6. Local Quickstart Guide

### Start Backend Service
```bash
cd backend
npm install
npm start
```
*Port: [http://localhost:3001](http://localhost:3001)*

### Start React SPA Frontend
```bash
cd frontend
npm install
npm run dev
```
*Port: [http://localhost:5173](http://localhost:5173)*

### Start Using Docker Compose
Alternatively, spin up both systems inside containerized environments with a single command:
```bash
docker compose up
```
*Both servers will auto-install packages and run on their designated local ports.*

### Run Automated Integration Tests
Verify database seeding, parameter constraints, audit hashing, and mock database tampering alerts:
```bash
cd backend
npm test
```

---

## 7. Operational Personas (For UI Testing)

All personas use the password `password123` and sign-off PIN `1234`.

1. **🔧 Plant Operator (`operator_user`)**: Logs parameters, registers incidents, drafts permits. Tab access: Dashboard, Logbook, Incident Board, Permits, Communications, Reports.
2. **📋 Shift In-Charge / Supervisor (`supervisor_user`)**: Approves shift handovers, acknowledges incidents, audits logs. Tab access: Dashboard, Logbook, Handover Wizard, Incident Board, Permits, Communications, Reports, Audit Explorer.
3. **🦺 Safety Officer (`safety_user`)**: Manages Permit-to-Work isolates and LOTO points, signs off closed incidents. Tab access: Dashboard, Logbook, Incident Board, Permits, Communications, Reports.
4. **🔍 Corporate Auditor (`auditor_user`)**: Read-only tracking. Tab access: Dashboard, Logbook, Incident Board, Permits, Communications, Reports, Audit Explorer.
