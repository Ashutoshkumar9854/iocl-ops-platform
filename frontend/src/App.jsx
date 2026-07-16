import React, { useState, useEffect } from 'react';
import {
  queueMutation,
  cacheData,
  getCachedData,
  addSingleCachedItem
} from './services/db';
import { syncOfflineQueue } from './services/sync';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1';

// ─── Helpers ────────────────────────────────────────────────────────────────
const toArray = (d) => (Array.isArray(d) ? d : []);

function Icon({ d, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  logbook: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14 2zM14 2v6h6M16 13H8M16 17H8M10 9H9H8',
  handover: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  incidents: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  permits: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  reports: 'M18 20V10M12 20V4M6 20v-6',
  audit: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM9 12l2 2 4-4',
  comms: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  sun: 'M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
};

// ─── App ────────────────────────────────────────────────────────────────────
export default function App() {
  // Auth
  const [token, setToken] = useState(localStorage.getItem('iocl_token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('iocl_user') || 'null'));
  const [loginUsername, setLoginUsername] = useState('operator_user');
  const [loginPassword, setLoginPassword] = useState('password123');
  const [authError, setAuthError] = useState('');

  // Layout
  const [activeTab, setActiveTab] = useState('dashboard');
  const [darkMode, setDarkMode] = useState(true);
  const [online, setOnline] = useState(true);
  const [syncMsg, setSyncMsg] = useState('');

  // Data
  const [assets, setAssets] = useState([]);
  const [logs, setLogs] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [handovers, setHandovers] = useState([]);
  const [permits, setPermits] = useState([
    { permit_id: 'PTW-990', category: 'HOT_WORK', asset_tag: 'C-101', status: 'WorkActive', applied_by: 'safety_user', valid_until: new Date(Date.now() + 3600000 * 4).toISOString(), safety_precautions: 'Fire watch required. Gas test mandatory before ignition.', loto: [{ lock_number: 'L-4221', isolation_point: 'Line AD-10', applied_by: 'safety_user', removed_at: null }] },
    { permit_id: 'PTW-882', category: 'CONFINED_SPACE', asset_tag: 'P-404', status: 'IsolationInProgress', applied_by: 'operator_user', valid_until: new Date(Date.now() + 3600000 * 8).toISOString(), safety_precautions: 'Continuous gas monitoring. Rescue team on standby.', loto: [{ lock_number: 'L-882', isolation_point: 'Boiler B-202 Feed Line', applied_by: 'safety_user', removed_at: null }] },
  ]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [, setTick] = useState(0);

  // Log form
  const [selectedAsset, setSelectedAsset] = useState('');
  const [paramValue, setParamValue] = useState('');
  const [logPin, setLogPin] = useState('');
  const [logFormError, setLogFormError] = useState('');
  const [shiftLocked, setShiftLocked] = useState(false);

  // Incident form
  const [incTitle, setIncTitle] = useState('');
  const [incDesc, setIncDesc] = useState('');
  const [incSeverity, setIncSeverity] = useState('MEDIUM');
  const [incAsset, setIncAsset] = useState('');
  const [incFormError, setIncFormError] = useState('');

  // Handover Wizard
  const [wizardStep, setWizardStep] = useState(1);
  const [handoverEquip, setHandoverEquip] = useState('All pressure checks normal. C-101 running. Steam line inspections completed.');
  const [handoverIncText, setHandoverIncText] = useState('No major incidents open. SLA timers cleared.');
  const [handoverPermText, setHandoverPermText] = useState('LOTO active on Compressor A maintenance line. Hot work permit #PTW-990 active.');
  const [handoverPin, setHandoverPin] = useState('');
  const [handoverError, setHandoverError] = useState('');
  const [incomingUser, setIncomingUser] = useState('supervisor_user');
  const [wizardBlocked, setWizardBlocked] = useState(false);
  const [wizardBlockReason, setWizardBlockReason] = useState('');

  // Permit form state
  const [newPermitCat, setNewPermitCat] = useState('HOT_WORK');
  const [newPermitAsset, setNewPermitAsset] = useState('');
  const [newPermitPrecautions, setNewPermitPrecautions] = useState('');
  const [permitFormError, setPermitFormError] = useState('');
  const [permitSuccessMsg, setPermitSuccessMsg] = useState('');

  // Reports state
  const [reportType, setReportType] = useState('shift_summary');

  // Communications state
  const [broadcasts, setBroadcasts] = useState([
    { id: '1', sender: 'safety_user', role: 'SAFETY_OFFICER', message: 'SAFETY NOTICE: Gas test mandatory before confined space entry on LPG Tank P-404. Rescue team deployed at Gate 3.', severity: 'HIGH', scope: 'PLANT_WIDE', timestamp: new Date(Date.now() - 900000).toISOString(), acknowledged: false },
    { id: '2', sender: 'supervisor_user', role: 'SHIFT_IN_CHARGE', message: 'Shift A handover completed. Shift B personnel please report to Zone A by 14:00. C-101 compressor running at reduced capacity.', severity: 'INFO', scope: 'ZONE_A', timestamp: new Date(Date.now() - 1800000).toISOString(), acknowledged: false },
    { id: '3', sender: 'operator_user', role: 'PLANT_OPERATOR', message: 'Maintenance window for Boiler B-202 scheduled 15:00–17:00. Hot work permit #PTW-882 will be active. Ensure isolation complete.', severity: 'INFO', scope: 'ZONE_B', timestamp: new Date(Date.now() - 3600000).toISOString(), acknowledged: true },
  ]);
  const [newBroadcast, setNewBroadcast] = useState('');
  const [broadcastSeverity, setBroadcastSeverity] = useState('INFO');
  const [broadcastScope, setBroadcastScope] = useState('PLANT_WIDE');

  // Admin Panel states
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminRoles, setAdminRoles] = useState([]);
  const [adminNewUsername, setAdminNewUsername] = useState('');
  const [adminNewEmail, setAdminNewEmail] = useState('');
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [adminNewRole, setAdminNewRole] = useState('');
  const [adminNewZone, setAdminNewZone] = useState('ZONE_A_DISTILLATION');
  const [adminFormError, setAdminFormError] = useState('');
  const [adminFormSuccess, setAdminFormSuccess] = useState('');

  // Voice Integration State (Walkie-Talkie)
  const wsRef = React.useRef(null);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isReceivingAudio, setIsReceivingAudio] = useState(false);
  const [speakerInfo, setSpeakerInfo] = useState('');

  // ── Effects ──
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (token) loadData();
  }, [token, online]);

  // WebSocket for Walkie-Talkie
  useEffect(() => {
    if (token) {
      const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onmessage = async (event) => {
        setIsReceivingAudio(true);
        setSpeakerInfo('Incoming Transmission...');
        try {
          const blob = event.data;
          // Only process blobs
          if (blob instanceof Blob) {
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            audio.onended = () => {
              setIsReceivingAudio(false);
              setSpeakerInfo('');
            };
            await audio.play();
          } else {
            setIsReceivingAudio(false);
            setSpeakerInfo('');
          }
        } catch (e) {
          console.error("Audio play error", e);
          setIsReceivingAudio(false);
          setSpeakerInfo('');
        }
      };
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
    }
  }, [token]);

  // SLA countdown ticker
  useEffect(() => {
    const t = setInterval(() => setTick(p => p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Sync on reconnect only (not on mount)
  const prevOnlineRef = React.useRef(true);
  useEffect(() => {
    if (online && token && prevOnlineRef.current === false) {
      doSync();
    }
    prevOnlineRef.current = online;
  }, [online]);

  // Handover wizard validation: re-check whenever incidents/logs change
  useEffect(() => {
    const criticalOpen = incidents.filter(i =>
      (i.severity === 'CRITICAL' || i.severity === 'HIGH') && i.status === 'DECLARED'
    );
    const outOfBounds = logs.filter(l => l.is_out_of_bounds === 1);
    const activePermits = permits.filter(p => p.status === 'WorkActive');

    if (criticalOpen.length > 0) {
      setWizardBlocked(true);
      setWizardBlockReason(`${criticalOpen.length} unacknowledged CRITICAL/HIGH incident(s) must be assigned before handover can proceed.`);
    } else if (outOfBounds.length > 0 && logs.length > 0) {
      // allow handover but show warning — don't block
      setWizardBlocked(false);
      setWizardBlockReason('');
    } else {
      setWizardBlocked(false);
      setWizardBlockReason('');
    }
  }, [incidents, logs, permits]);

  // ── Data Loading ──
  const loadData = async () => {
    try {
      if (online) {
        const [aR, lR, iR, hR] = await Promise.all([
          fetch(`${API_BASE}/assets`, auth()),
          fetch(`${API_BASE}/logs`, auth()),
          fetch(`${API_BASE}/incidents`, auth()),
          fetch(`${API_BASE}/handovers`, auth()),
        ]);
        const [a, l, i, h] = await Promise.all([
          aR.ok ? aR.json() : [],
          lR.ok ? lR.json() : [],
          iR.ok ? iR.json() : [],
          hR.ok ? hR.json() : [],
        ]);
        setAssets(toArray(a));
        setLogs(toArray(l));
        setIncidents(toArray(i));
        setHandovers(toArray(h));
        if (toArray(a).length) await cacheData('cached_assets', toArray(a));
        if (toArray(l).length) await cacheData('cached_logs', toArray(l));
        if (toArray(i).length) await cacheData('cached_incidents', toArray(i));
        if (toArray(h).length > 0 && toArray(h)[0].status === 'COMPLETED') setShiftLocked(true);

        if (user?.role === 'CORPORATE_AUDITOR' || user?.role === 'SHIFT_IN_CHARGE') {
          const ar = await fetch(`${API_BASE}/audit-logs`, auth());
          setAuditLogs(ar.ok ? toArray(await ar.json()) : []);
        }

        if (user?.role === 'SYSTEM_ADMIN') {
          const [uRes, rRes] = await Promise.all([
            fetch(`${API_BASE}/admin/users`, auth()),
            fetch(`${API_BASE}/admin/roles`, auth())
          ]);
          const u = uRes.ok ? await uRes.json() : [];
          const r = rRes.ok ? await rRes.json() : [];
          setAdminUsers(toArray(u));
          setAdminRoles(toArray(r));
          if (toArray(r).length > 0 && !adminNewRole) {
            setAdminNewRole(toArray(r)[0].role_id);
          }
        }
      } else {
        setAssets(toArray(await getCachedData('cached_assets')));
        setLogs(toArray(await getCachedData('cached_logs')));
        setIncidents(toArray(await getCachedData('cached_incidents')));
        setSyncMsg('Running Offline — data from local cache');
      }
    } catch (err) {
      console.error('loadData error:', err);
      try {
        setAssets(toArray(await getCachedData('cached_assets')));
        setLogs(toArray(await getCachedData('cached_logs')));
        setIncidents(toArray(await getCachedData('cached_incidents')));
      } catch (_) {}
    }
  };

  const doSync = async () => {
    setSyncMsg('Synchronizing offline queue…');
    const r = await syncOfflineQueue(token);
    if (r.success && r.count > 0) {
      setSyncMsg(`Sync complete: ${r.count} mutations applied`);
      loadData();
    } else {
      setSyncMsg(r.success ? 'Queue already clear.' : `Sync failed: ${r.reason}`);
    }
    setTimeout(() => setSyncMsg(''), 5000);
  };

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

  // ── Auth ──
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('iocl_token', data.token);
      localStorage.setItem('iocl_user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (err) { setAuthError(err.message); }
  };

  const handleLogout = () => {
    localStorage.clear();
    setToken(''); setUser(null);
  };

  // ── Computed: SOL check ──
  const limits = assets.find(a => a.asset_id === selectedAsset) || null;
  const isOutOfBounds = limits && paramValue !== '' &&
    (parseFloat(paramValue) < limits.min_safe_limit || parseFloat(paramValue) > limits.max_safe_limit);

  const checkOOB = (val, asset) =>
    asset && (val < asset.min_safe_limit || val > asset.max_safe_limit);

  // ── Log Submit ──
  const handleLogSubmit = async (e) => {
    e.preventDefault();
    setLogFormError('');
    if (!selectedAsset || paramValue === '') return setLogFormError('Asset and value are required.');
    if (logPin !== '1234') return setLogFormError('Invalid sign-off PIN.');
    if (shiftLocked) return setLogFormError('Shift is locked — handover already completed.');

    const asset = assets.find(a => a.asset_id === selectedAsset);
    const val = parseFloat(paramValue);
    const isOut = checkOOB(val, asset) ? 1 : 0;
    const payload = { asset_id: selectedAsset, parameter_value: val, recorded_at: new Date().toISOString() };
    const mid = crypto.randomUUID();

    if (online) {
      try {
        const res = await fetch(`${API_BASE}/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...payload, client_mutation_id: mid }),
        });
        if (!res.ok) throw new Error();
        const saved = await res.json();
        setLogs(prev => [{ ...saved, asset_tag: asset.asset_tag, asset_name: asset.asset_name, username: user.username }, ...prev]);
      } catch { setLogFormError('Server write failed — queued offline.'); }
    } else {
      const mock = { log_id: mid, username: user.username, asset_tag: asset.asset_tag, asset_name: asset.asset_name, parameter_value: val, is_out_of_bounds: isOut, min_safe_limit: asset.min_safe_limit, max_safe_limit: asset.max_safe_limit, recorded_at: payload.recorded_at, sync_status: 'PENDING' };
      await queueMutation({ mutation_id: mid, target_table: 'shift_logs', action: 'CREATE', payload, offline_timestamp: payload.recorded_at });
      setLogs(prev => [mock, ...prev]);
      await addSingleCachedItem('cached_logs', mock);
      setSyncMsg('Log queued — pending sync.');
    }
    setParamValue(''); setLogPin('');
  };

  // ── Incident State Machine ──
  const handleIncidentTransition = async (incidentId, action) => {
    try {
      const res = await fetch(`${API_BASE}/incidents/${incidentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Transition failed: ${err.error}`);
        return;
      }
      const updated = await res.json();
      setIncidents(prev => prev.map(i => i.incident_id === incidentId ? { ...i, ...updated } : i));
    } catch (e) {
      alert('Network error during state transition.');
    }
  };

  // ── Send Broadcast ──
  const handleBroadcast = (e) => {
    e.preventDefault();
    if (!newBroadcast.trim()) return;
    const msg = {
      id: crypto.randomUUID(),
      sender: user?.username,
      role: user?.role,
      message: newBroadcast,
      severity: broadcastSeverity,
      scope: broadcastScope,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };
    setBroadcasts(prev => [msg, ...prev]);
    setNewBroadcast('');
  };

  const acknowledgeBroadcast = (id) => {
    setBroadcasts(prev => prev.map(b => b.id === id ? { ...b, acknowledged: true } : b));
  };

  // ── Dictation (Speech-to-Text) ──
  const handleDictate = (setter) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech Recognition is not supported in this browser. Try Chrome.");
      return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setter(prev => prev ? prev + ' ' + transcript : transcript);
    };
    
    recognition.onerror = (event) => {
      console.error('Speech recognition error', event.error);
    };
    
    recognition.start();
  };

  // ── Push-to-Talk (Walkie-Talkie) ──
  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(audioBlob);
        }
        // Stop all tracks to release mic
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('Could not access microphone for Push-to-Talk.');
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleIncidentSubmit = async (e) => {
    e.preventDefault();
    setIncFormError('');
    if (!incTitle || !incDesc) return setIncFormError('Title and description are required.');
    const payload = { title: incTitle, description: incDesc, severity: incSeverity, asset_id: incAsset || null };
    const mid = crypto.randomUUID();

    if (online) {
      try {
        const res = await fetch(`${API_BASE}/incidents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const saved = await res.json();
        const asset = assets.find(a => a.asset_id === incAsset);
        setIncidents(prev => [{ ...saved, reporter_name: user.username, asset_tag: asset?.asset_tag }, ...prev]);
      } catch { setIncFormError('Server save failed.'); }
    } else {
      const mock = { incident_id: mid, ...payload, status: 'DECLARED', reporter_name: user.username, created_at: new Date().toISOString(), sla_escalation_deadline: new Date(Date.now() + 3600000).toISOString(), sync_status: 'PENDING' };
      await queueMutation({ mutation_id: mid, target_table: 'incidents', action: 'CREATE', payload, offline_timestamp: mock.created_at });
      setIncidents(prev => [mock, ...prev]);
      setSyncMsg('Incident queued offline.');
    }
    setIncTitle(''); setIncDesc(''); setIncAsset('');
  };

  // ── Handover Submit ──
  const handleHandoverSubmit = async () => {
    setHandoverError('');
    if (wizardBlocked) return setHandoverError(wizardBlockReason);
    if (handoverPin !== '1234') return setHandoverError('Invalid verification PIN.');
    try {
      const res = await fetch(`${API_BASE}/handovers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shift_date: new Date().toISOString().split('T')[0], shift_type: 'A', equipment_status_summary: handoverEquip, active_incidents_summary: handoverIncText, active_permits_summary: handoverPermText, status: 'PENDING_INCOMING', incoming_shift_in_charge_id: incomingUser }),
      });
      if (!res.ok) throw new Error('Handover registration failed');
      const data = await res.json();
      setHandovers(prev => [data, ...prev]);
      setShiftLocked(true);
      setWizardStep(1); setHandoverPin('');
      setActiveTab('dashboard');
    } catch (err) { setHandoverError(err.message); }
  };

  // ── Permit Submit ──
  const handlePermitSubmit = (e) => {
    e.preventDefault();
    setPermitFormError('');
    if (!newPermitAsset) return setPermitFormError('Asset is required for a permit.');
    const asset = assets.find(a => a.asset_id === newPermitAsset);
    const newPermit = {
      permit_id: `PTW-${Math.floor(Math.random() * 9000) + 1000}`,
      category: newPermitCat,
      asset_tag: asset?.asset_tag || 'Unknown',
      status: 'PTW_Draft',
      applied_by: user?.username,
      valid_until: new Date(Date.now() + 3600000 * 12).toISOString(),
      safety_precautions: newPermitPrecautions || 'Standard isolation protocol applies.',
      loto: [],
    };
    setPermits(prev => [newPermit, ...prev]);
    setPermitSuccessMsg(`Permit ${newPermit.permit_id} created. Awaiting safety officer approval.`);
    setNewPermitAsset(''); setNewPermitPrecautions('');
    setTimeout(() => setPermitSuccessMsg(''), 5000);
  };

  // ── SLA Timer Render ──
  const renderSLA = (inc) => {
    if (inc.status === 'CLOSED') return <span className="badge badge-green">Closed</span>;
    if (!inc.sla_escalation_deadline) return '—';
    const diff = new Date(inc.sla_escalation_deadline) - Date.now();
    if (diff <= 0) return <span className="badge badge-critical" style={{ animation: 'none' }}>SLA BREACHED</span>;
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return <span className={`badge ${m < 5 ? 'badge-critical' : 'badge-amber'}`}>{m}m {s}s</span>;
  };

  // ── Permit status badge ──
  const permitStatusBadge = (status) => {
    const map = { PTW_Draft: 'badge-low', PTW_PendingApproval: 'badge-amber', PTW_Approved: 'badge-green', IsolationInProgress: 'badge-amber', WorkActive: 'badge-green', WorkSuspended: 'badge-medium', DeisolationPending: 'badge-amber', LOTO_Removed: 'badge-low', PTW_Closed: 'badge-green' };
    return <span className={`badge ${map[status] || 'badge-low'}`}>{status.replace(/_/g, ' ')}</span>;
  };

  // ── Admin Panel Handlers ──
  const handleCreateUser = async (e) => {
    e.preventDefault();
    setAdminFormError('');
    setAdminFormSuccess('');
    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          username: adminNewUsername,
          email: adminNewEmail,
          password: adminNewPassword,
          role_id: adminNewRole,
          plant_zone: adminNewZone
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      
      setAdminUsers(prev => [...prev, data]);
      setAdminFormSuccess(`User ${adminNewUsername} created successfully.`);
      setAdminNewUsername('');
      setAdminNewEmail('');
      setAdminNewPassword('');
    } catch (err) {
      setAdminFormError(err.message);
    }
  };

  const handleUpdateRole = async (userId, roleId) => {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ role_id: roleId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update role');
      
      setAdminUsers(prev => prev.map(u => u.user_id === userId ? { ...u, role_id: roleId, role_name: data.role_name } : u));
    } catch (err) {
      alert(`Error updating role: ${err.message}`);
    }
  };

  // ── Generate Report ──
  const generateReport = () => {
    const outLogs = logs.filter(l => l.is_out_of_bounds === 1);
    const critInc = incidents.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH');
    const lines = [
      `IOCL OPERATIONS ${reportType.toUpperCase().replace(/_/g, ' ')} REPORT`,
      `Generated: ${new Date().toLocaleString()}`,
      `Operator Zone: ${user?.zone || 'ALL_ZONES'}`,
      `Generated By: ${user?.username} (${user?.role})`,
      '',
      '═══════════════════════════════════════',
      'SHIFT SUMMARY',
      '═══════════════════════════════════════',
      `Total Parameters Logged: ${logs.length}`,
      `Out-of-Bounds Readings: ${outLogs.length}`,
      '',
      'OUT-OF-BOUNDS DETAILS:',
      ...outLogs.map(l => `  • ${l.asset_tag}: ${l.parameter_value} (Limits: ${l.min_safe_limit}–${l.max_safe_limit}) at ${new Date(l.recorded_at).toLocaleTimeString()}`),
      '',
      '═══════════════════════════════════════',
      'INCIDENT SUMMARY',
      '═══════════════════════════════════════',
      `Total Incidents Declared: ${incidents.length}`,
      `Critical/High: ${critInc.length}`,
      '',
      'INCIDENT LIST:',
      ...incidents.map(i => `  • [${i.severity}] ${i.title} (${i.status}) — ${i.reporter_name || 'System'}`),
      '',
      '═══════════════════════════════════════',
      'PERMIT STATUS',
      '═══════════════════════════════════════',
      ...permits.map(p => `  • ${p.permit_id} [${p.category}] on ${p.asset_tag}: ${p.status}`),
      '',
      '═══════════════════════════════════════',
      'HANDOVERS',
      '═══════════════════════════════════════',
      `Total Handovers: ${handovers.length}`,
      ...handovers.map(h => `  • Shift ${h.shift_type} on ${h.shift_date}: ${h.status}`),
      '',
      '═══════════════════════════════════════',
      'AUDIT COVERAGE',
      '═══════════════════════════════════════',
      `Total Audit Events: ${auditLogs.length}`,
      `Tampered Rows Detected: ${auditLogs.filter(a => a.verified === false).length}`,
      '',
      '[END OF REPORT — IOCL CONFIDENTIAL]',
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `IOCL_${reportType}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };

  // ── Login Screen ──
  if (!token) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-page)' }}>
        <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '2.5rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ width: 56, height: 56, borderRadius: '12px', background: 'linear-gradient(135deg, hsl(215,80%,25%), hsl(217,91%,60%))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <Icon d={ICONS.permits} size={28} />
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.5rem', color: 'var(--primary)' }}>IOCL DIGITAL LOGBOOK</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Downstream Operations & Audit Platform</p>
          </div>

          {authError && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{authError}</div>}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Role Selection (Demo)</label>
              <select className="form-input" value={loginUsername}
                onChange={e => { setLoginUsername(e.target.value); setLoginPassword('password123'); }}>
                <option value="operator_user">🔧 Plant Operator</option>
                <option value="supervisor_user">📋 Shift In-Charge / Supervisor</option>
                <option value="safety_user">🦺 Safety Officer</option>
                <option value="auditor_user">🔍 Corporate Auditor</option>
                <option value="admin_user">⚙️ System Administrator</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input type="password" className="form-input" value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
              Authenticate (SSO + MFA)
            </button>
          </form>

          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--bg-page)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <strong>Test PIN for all sign-offs:</strong> 1234<br />
            <strong>Password for all roles:</strong> password123
          </div>
        </div>
      </div>
    );
  }

  // ── Sidebar nav items by role ──
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, roles: null },
    { id: 'logbook', label: 'Shift Logbook', icon: ICONS.logbook, roles: null },
    { id: 'handover', label: 'Handover Wizard', icon: ICONS.handover, roles: ['SHIFT_IN_CHARGE'] },
    { id: 'incidents', label: 'Incident Board', icon: ICONS.incidents, roles: null },
    { id: 'permits', label: 'Permits & LOTO', icon: ICONS.permits, roles: null },
    { id: 'comms', label: 'Communications', icon: ICONS.comms, roles: null },
    { id: 'reports', label: 'Reports & Exports', icon: ICONS.reports, roles: null },
    { id: 'audit', label: 'Audit Explorer', icon: ICONS.audit, roles: ['CORPORATE_AUDITOR', 'SHIFT_IN_CHARGE'] },
    { id: 'admin', label: 'Admin Panel', icon: ICONS.handover, roles: ['SYSTEM_ADMIN'] },
  ].filter(item => !item.roles || item.roles.includes(user?.role));

  const criticalOpen = incidents.filter(i => (i.severity === 'CRITICAL' || i.severity === 'HIGH') && i.status === 'DECLARED');
  const outOfBoundsLogs = logs.filter(l => l.is_out_of_bounds === 1);

  return (
    <div className="app-container">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div style={{ width: 32, height: 32, borderRadius: '8px', background: 'linear-gradient(135deg, hsl(215,80%,25%), hsl(217,91%,55%))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon d={ICONS.permits} size={16} />
          </div>
          <span className="sidebar-logo-text">IOCL OPS</span>
        </div>

        <ul className="sidebar-menu">
          {navItems.map(item => (
            <li key={item.id}
              className={`sidebar-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}>
              <Icon d={item.icon} />
              {item.label}
              {item.id === 'incidents' && criticalOpen.length > 0 && (
                <span style={{ marginLeft: 'auto', background: 'var(--danger)', color: '#fff', borderRadius: '9999px', fontSize: '0.7rem', padding: '0.15rem 0.45rem', fontWeight: 700 }}>
                  {criticalOpen.length}
                </span>
              )}
            </li>
          ))}
        </ul>

        <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Authenticated As</div>
          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{user?.username}</div>
          <span className="badge badge-low">{user?.role}</span>
          <button className="btn btn-secondary" onClick={handleLogout} style={{ marginTop: '0.5rem', fontSize: '0.85rem', padding: '0.5rem' }}>
            <Icon d={ICONS.logout} size={14} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="main-content">
        {/* Top Bar */}
        <div className="top-bar">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', textTransform: 'capitalize' }}>
            {navItems.find(n => n.id === activeTab)?.label || activeTab}
          </h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {syncMsg && <span className="badge badge-amber">{syncMsg}</span>}

            <button
              className={`indicator-pill ${online ? 'indicator-online' : 'indicator-offline'}`}
              onClick={() => setOnline(v => !v)}
              title="Click to simulate plant network offline/online"
              style={{ cursor: 'pointer', border: 'none', fontWeight: 700 }}>
              {online ? '● ONLINE' : '○ OFFLINE'}
            </button>

            <button className="btn btn-secondary" onClick={() => setDarkMode(v => !v)} style={{ padding: '0.5rem' }}>
              <Icon d={darkMode ? ICONS.sun : ICONS.moon} />
            </button>
          </div>
        </div>

        {/* Critical incidents system banner */}
        {criticalOpen.length > 0 && (
          <div className="alert alert-danger" style={{ margin: '1.5rem 2rem 0', fontWeight: 500 }}>
            ⚠ <strong>ACTIVE ALERT:</strong> {criticalOpen.length} unacknowledged CRITICAL/HIGH incident(s) require immediate response.
            Handover will be blocked until resolved.
          </div>
        )}

        {/* ═══ DASHBOARD ═══ */}
        {activeTab === 'dashboard' && (
          <>
            {/* System Notice Banner */}
            <div className="alert alert-warning" style={{ margin: '1.5rem 2rem 0' }}>
              <strong>SAFETY NOTICE:</strong> Confined space work active on LPG Tank P-404. Ensure gas test completed before entry. LOTO #L-882 in force.
            </div>

            {/* KPI Grid */}
            <div className="dashboard-grid" style={{ paddingBottom: '0' }}>
              {[
                { label: 'Safe Operating Days', value: '421', trend: 'No LOTO breaches', color: '#10b981' },
                { label: 'Active Isolation Points', value: permits.reduce((n, p) => n + p.loto.filter(l => !l.removed_at).length, 0).toString(), trend: 'LOTO locks applied', color: '#3b82f6' },
                { label: 'Open Permits', value: permits.filter(p => p.status !== 'PTW_Closed').length.toString(), trend: `${permits.filter(p => p.category === 'HOT_WORK').length} Hot Work active`, color: '#f59e0b' },
                { label: 'Parameters Logged', value: logs.length.toString(), trend: `${outOfBoundsLogs.length} out-of-bounds`, color: outOfBoundsLogs.length > 0 ? '#ef4444' : '#10b981' },
              ].map(kpi => (
                <div key={kpi.label} className="card">
                  <span className="kpi-title">{kpi.label}</span>
                  <span className="kpi-value" style={{ color: kpi.color }}>{kpi.value}</span>
                  <span className="kpi-trend" style={{ backgroundColor: `${kpi.color}20`, color: kpi.color }}>
                    {kpi.trend}
                  </span>
                </div>
              ))}
            </div>

            {/* Asset Status + Roster */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', padding: '1.5rem 2rem' }}>
              {/* Asset Cards */}
              <div className="card">
                <h3 style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                  Live Asset Parameter Status
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                  {assets.map(asset => {
                    const latest = logs.filter(l => l.asset_id === asset.asset_id)[0];
                    const oob = latest && checkOOB(latest.parameter_value, asset);
                    return (
                      <div key={asset.asset_id} className="card"
                        style={{ padding: '1rem', borderLeft: `4px solid ${oob ? 'var(--danger)' : 'var(--success)'}`, transition: 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem' }}>{asset.asset_tag}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{asset.asset_name}</div>
                          </div>
                          <span className={`badge ${oob ? 'badge-red' : 'badge-green'}`}>
                            {oob ? 'EXCESS' : 'NORMAL'}
                          </span>
                        </div>
                        <div style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0.5rem 0', color: oob ? 'var(--danger)' : 'var(--text-primary)' }}>
                          {latest ? `${latest.parameter_value}` : '—'}
                          <span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--text-secondary)' }}> {asset.metric_unit}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Safe: {asset.min_safe_limit}–{asset.max_safe_limit} {asset.metric_unit}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Shift Roster */}
              <div className="card">
                <h3 style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                  Active Shift Roster
                </h3>
                {[
                  { label: 'Zone', value: user?.zone },
                  { label: 'Shift', value: 'Shift A (06:00–14:00)' },
                  { label: 'Operator', value: 'operator_user' },
                  { label: 'Supervisor', value: 'supervisor_user' },
                  { label: 'Safety Officer', value: 'safety_user' },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
                <div style={{ marginTop: '1rem' }}>
                  <span className={`badge ${shiftLocked ? 'badge-amber' : 'badge-green'}`}>
                    {shiftLocked ? '🔒 SHIFT HANDED OVER' : '✓ SHIFT ACTIVE — LOGGING OPEN'}
                  </span>
                </div>

                {/* Pending actions drawer */}
                <div style={{ marginTop: '1.25rem', padding: '0.75rem', background: 'var(--bg-page)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    Pending Actions
                  </div>
                  {criticalOpen.length > 0 && <div style={{ fontSize: '0.8rem', color: 'var(--danger)', marginBottom: '0.25rem' }}>• {criticalOpen.length} critical incident(s) unacknowledged</div>}
                  {outOfBoundsLogs.length > 0 && <div style={{ fontSize: '0.8rem', color: 'var(--warning)', marginBottom: '0.25rem' }}>• {outOfBoundsLogs.length} out-of-bounds reading(s) logged</div>}
                  {criticalOpen.length === 0 && outOfBoundsLogs.length === 0 && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--success)' }}>✓ No pending actions</div>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Incidents strip */}
            {incidents.length > 0 && (
              <div style={{ padding: '0 2rem 2rem' }}>
                <div className="card">
                  <h3 style={{ marginBottom: '1rem' }}>Recent Incident Declarations</h3>
                  <table className="log-grid" style={{ fontSize: '0.875rem' }}>
                    <thead><tr><th>Time</th><th>Severity</th><th>Title</th><th>Status</th><th>SLA</th></tr></thead>
                    <tbody>
                      {incidents.slice(0, 5).map(inc => (
                        <tr key={inc.incident_id} style={inc.severity === 'CRITICAL' ? { borderLeft: '3px solid var(--danger)' } : {}}>
                          <td>{new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                          <td><span className={`badge ${inc.severity === 'CRITICAL' ? 'badge-critical' : inc.severity === 'HIGH' ? 'badge-high' : inc.severity === 'MEDIUM' ? 'badge-medium' : 'badge-low'}`}>{inc.severity}</span></td>
                          <td><strong>{inc.title}</strong></td>
                          <td><span className="badge badge-low">{inc.status}</span></td>
                          <td>{renderSLA(inc)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ SHIFT LOGBOOK ═══ */}
        {activeTab === 'logbook' && (
          <div className="dashboard-grid" style={{ gridTemplateColumns: '3fr 1fr', padding: '2rem' }}>
            {/* Logs Table */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                <h3>Parameter Readings Grid</h3>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {outOfBoundsLogs.length > 0 && (
                    <span className="badge badge-red">{outOfBoundsLogs.length} OUT OF BOUNDS</span>
                  )}
                  {shiftLocked && <span className="badge badge-amber">SHIFT LOCKED</span>}
                </div>
              </div>

              {shiftLocked && (
                <div className="alert alert-warning" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
                  <strong>Shift locked:</strong> Handover completed. Future entries must be logged by the incoming shift.
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table className="log-grid">
                  <thead>
                    <tr>
                      <th>Time</th><th>Tag</th><th>Asset</th><th>Value</th>
                      <th>Safe Range</th><th>Status</th><th>Operator</th><th>Sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No readings yet this shift</td></tr>
                    )}
                    {logs.map(log => {
                      const oob = log.is_out_of_bounds === 1 || log.is_out_of_bounds === true;
                      return (
                        <tr key={log.log_id} className={oob ? 'log-row-out' : 'log-row-normal'}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                            {new Date(log.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td><strong style={{ fontFamily: 'var(--font-mono)' }}>{log.asset_tag}</strong></td>
                          <td style={{ fontSize: '0.85rem' }}>{log.asset_name}</td>
                          <td>
                            <strong style={{ color: oob ? 'var(--danger)' : 'inherit', fontSize: '1rem' }}>
                              {log.parameter_value}
                            </strong>
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                            {log.min_safe_limit}–{log.max_safe_limit}
                          </td>
                          <td>
                            {oob
                              ? <span className="badge badge-critical">EXCESS LIMIT</span>
                              : <span className="badge badge-green">NORMAL</span>}
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>{log.username || 'System'}</td>
                          <td>
                            {log.sync_status === 'PENDING'
                              ? <span className="badge badge-amber">PENDING</span>
                              : <span className="badge badge-green">SYNCED</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Log Input Form */}
            <div className="card">
              <h3 style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                Record Hourly Reading
              </h3>
              {logFormError && <div className="alert alert-danger" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>{logFormError}</div>}

              <form onSubmit={handleLogSubmit}>
                <div className="form-group">
                  <label className="form-label">Asset / Tag ID</label>
                  <select className="form-input" value={selectedAsset}
                    onChange={e => setSelectedAsset(e.target.value)} disabled={shiftLocked} required>
                    <option value="">— Select Asset —</option>
                    {assets.map(a => <option key={a.asset_id} value={a.asset_id}>{a.asset_tag} — {a.asset_name}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Parameter Value {limits && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({limits.metric_unit})</span>}
                  </label>
                  <input type="number" step="0.01"
                    className={`form-input ${isOutOfBounds ? 'out-of-bounds' : ''}`}
                    value={paramValue}
                    onChange={e => setParamValue(e.target.value)}
                    placeholder={limits ? `Normal: ${limits.min_safe_limit}–${limits.max_safe_limit}` : 'Select asset first'}
                    disabled={!selectedAsset || shiftLocked} required />
                  {isOutOfBounds && (
                    <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', fontWeight: 700, color: 'var(--danger)', padding: '0.35rem 0.6rem', background: 'var(--danger-bg)', borderRadius: '4px' }}>
                      ⚠ OUT OF BOUNDS — Exceeds safe limit ({limits?.min_safe_limit}–{limits?.max_safe_limit} {limits?.metric_unit})
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Digital Sign-off PIN</label>
                  <input type="password" maxLength={4} className="form-input"
                    value={logPin} onChange={e => setLogPin(e.target.value)}
                    placeholder="4-digit PIN (1234)" disabled={shiftLocked} required />
                </div>

                <button type="submit" className={`btn ${isOutOfBounds ? 'btn-danger' : 'btn-primary'}`}
                  style={{ width: '100%', marginTop: '0.5rem' }} disabled={shiftLocked}>
                  {isOutOfBounds ? '⚠ Record (Bounds Alert)' : 'Record Parameter'}
                </button>
              </form>

              {/* SOL reference card */}
              {limits && (
                <div style={{ marginTop: '1.25rem', padding: '0.75rem', background: 'var(--bg-page)', borderRadius: '8px', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Safe Operating Limits</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--success)' }}>Min: {limits.min_safe_limit} {limits.metric_unit}</span>
                    <span style={{ color: 'var(--danger)' }}>Max: {limits.max_safe_limit} {limits.metric_unit}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ HANDOVER WIZARD ═══ */}
        {activeTab === 'handover' && (
          <div style={{ padding: '2rem' }}>
            {/* Wizard Blocking Alert */}
            {wizardBlocked && (
              <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
                <strong>⛔ HANDOVER BLOCKED:</strong> {wizardBlockReason}
                <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                  Go to the Incident Board and assign all unacknowledged CRITICAL/HIGH incidents before proceeding.
                </div>
              </div>
            )}

            <div className="card" style={{ maxWidth: '820px', margin: '0 auto' }}>
              <h2 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>Shift Handover Wizard</h2>
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '2rem', fontSize: '0.875rem' }}>
                Complete all 4 steps and sign off to transfer shift custody.
              </p>

              {/* Steps indicator */}
              <div className="wizard-steps" style={{ marginBottom: '2.5rem' }}>
                {['Asset Logs', 'Permits & LOTO', 'Open Incidents', 'Sign-off'].map((label, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                    <div className={`wizard-step ${wizardStep > idx + 1 ? 'completed' : ''} ${wizardStep === idx + 1 ? 'active' : ''}`}>
                      {wizardStep > idx + 1 ? '✓' : idx + 1}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: wizardStep === idx + 1 ? 'var(--primary)' : 'var(--text-muted)', fontWeight: wizardStep === idx + 1 ? 700 : 400, textAlign: 'center' }}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              {handoverError && <div className="alert alert-danger">{handoverError}</div>}

              {/* Step 1: Asset Logs */}
              {wizardStep === 1 && (
                <div>
                  <h3 style={{ marginBottom: '1rem' }}>Step 1: Review Asset Anomalies</h3>
                  <div style={{ background: 'var(--bg-page)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Out-of-Bounds Readings This Shift</span>
                      {outOfBoundsLogs.length === 0
                        ? <span className="badge badge-green">All Clear</span>
                        : <span className="badge badge-red">{outOfBoundsLogs.length} Alerts</span>}
                    </div>
                    {outOfBoundsLogs.length === 0
                      ? <p style={{ color: 'var(--success)', fontSize: '0.875rem' }}>✓ All parameters within safe limits.</p>
                      : outOfBoundsLogs.map(l => (
                        <div key={l.log_id} style={{ padding: '0.5rem', background: 'var(--danger-bg)', borderRadius: '4px', fontSize: '0.85rem', color: 'var(--danger)', marginBottom: '0.25rem' }}>
                          <strong>{l.asset_tag}</strong>: {l.parameter_value} (limit {l.min_safe_limit}–{l.max_safe_limit}) at {new Date(l.recorded_at).toLocaleTimeString()}
                        </div>
                      ))}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Equipment Status Summary</label>
                    <textarea className="form-input" rows={4} value={handoverEquip} onChange={e => setHandoverEquip(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                    <button className="btn btn-primary" onClick={() => setWizardStep(2)}>Next →</button>
                  </div>
                </div>
              )}

              {/* Step 2: Permits & LOTO */}
              {wizardStep === 2 && (
                <div>
                  <h3 style={{ marginBottom: '1rem' }}>Step 2: Confirm Permits & LOTO Isolation Status</h3>
                  <div style={{ background: 'var(--bg-page)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
                    {permits.filter(p => p.status !== 'PTW_Closed').map(p => (
                      <div key={p.permit_id} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ fontFamily: 'var(--font-mono)' }}>{p.permit_id}</strong>
                          <span className="badge badge-amber" style={{ marginLeft: '0.5rem' }}>{p.category.replace(/_/g, ' ')}</span>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                            Asset: {p.asset_tag} | LOTO locks: {p.loto.filter(l => !l.removed_at).length} active
                          </div>
                        </div>
                        {permitStatusBadge(p.status)}
                      </div>
                    ))}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Permit & LOTO Handover Summary</label>
                    <textarea className="form-input" rows={4} value={handoverPermText} onChange={e => setHandoverPermText(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
                    <button className="btn btn-secondary" onClick={() => setWizardStep(1)}>← Back</button>
                    <button className="btn btn-primary" onClick={() => setWizardStep(3)}>Next →</button>
                  </div>
                </div>
              )}

              {/* Step 3: Incidents */}
              {wizardStep === 3 && (
                <div>
                  <h3 style={{ marginBottom: '1rem' }}>Step 3: Review Open Incident Declarations</h3>

                  {wizardBlocked && (
                    <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
                      <strong>Cannot proceed:</strong> {criticalOpen.length} unacknowledged CRITICAL/HIGH incident(s) must be resolved.
                      The "Sign-off" step will remain locked.
                    </div>
                  )}

                  <div style={{ background: 'var(--bg-page)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
                    {incidents.length === 0
                      ? <p style={{ color: 'var(--success)', fontSize: '0.875rem' }}>✓ No incidents declared this shift.</p>
                      : incidents.slice(0, 5).map(inc => (
                        <div key={inc.incident_id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
                          <div>
                            <span className={`badge ${inc.severity === 'CRITICAL' ? 'badge-critical' : inc.severity === 'HIGH' ? 'badge-high' : 'badge-medium'}`}>{inc.severity}</span>
                            <span style={{ marginLeft: '0.5rem' }}>{inc.title}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="badge badge-low">{inc.status}</span>
                            {renderSLA(inc)}
                          </div>
                        </div>
                      ))}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Incident Handover Remarks</label>
                    <textarea className="form-input" rows={4} value={handoverIncText} onChange={e => setHandoverIncText(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
                    <button className="btn btn-secondary" onClick={() => setWizardStep(2)}>← Back</button>
                    <button className="btn btn-primary" onClick={() => setWizardStep(4)} disabled={wizardBlocked}>
                      {wizardBlocked ? '⛔ Blocked — Resolve Incidents First' : 'Next →'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: Sign-off */}
              {wizardStep === 4 && (
                <div>
                  <h3 style={{ marginBottom: '1rem' }}>Step 4: Final Sign-off & Custody Transfer</h3>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                    The outgoing shift log will be sealed and the incoming Shift In-Charge will be notified for acknowledgment.
                  </p>

                  {wizardBlocked && (
                    <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
                      ⛔ Sign-off is disabled: {wizardBlockReason}
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">Incoming Shift In-Charge</label>
                    <select className="form-input" value={incomingUser} onChange={e => setIncomingUser(e.target.value)}>
                      <option value="supervisor_user">supervisor_user — Shift B</option>
                      <option value="safety_user">safety_user — Safety Inspector</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Authorization PIN (MFA step-up)</label>
                    <input type="password" maxLength={4} className="form-input"
                      value={handoverPin} onChange={e => setHandoverPin(e.target.value)}
                      placeholder="Enter 4-digit PIN (1234)" disabled={wizardBlocked} />
                  </div>

                  <div style={{ background: 'var(--bg-page)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Handover Summary Preview</div>
                    <div style={{ color: 'var(--text-secondary)' }}><strong>Equipment:</strong> {handoverEquip.slice(0, 80)}…</div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}><strong>Permits:</strong> {handoverPermText.slice(0, 80)}…</div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}><strong>Incidents:</strong> {handoverIncText.slice(0, 80)}…</div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
                    <button className="btn btn-secondary" onClick={() => setWizardStep(3)}>← Back</button>
                    <button className="btn btn-accent" onClick={handleHandoverSubmit} disabled={wizardBlocked}>
                      {wizardBlocked ? '⛔ Sign-off Blocked' : '✓ Sign & Complete Handover'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ INCIDENT BOARD ═══ */}
        {activeTab === 'incidents' && (
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '1.5rem', padding: '2rem' }}>
            {/* Incidents Table */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                <h3>Incident Declarations & SLA Timers</h3>
                {criticalOpen.length > 0 && (
                  <span className="badge badge-critical">{criticalOpen.length} CRITICAL UNACKNOWLEDGED</span>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="log-grid" style={{ fontSize: '0.875rem' }}>
                  <thead>
                    <tr><th>Time</th><th>Severity</th><th>Title</th><th>Asset</th><th>Status</th><th>SLA</th><th>Reporter</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {incidents.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No incidents declared this shift</td></tr>
                    )}
                    {incidents.map(inc => (
                      <tr key={inc.incident_id} style={inc.severity === 'CRITICAL' ? { borderLeft: '3px solid var(--danger)' } : {}}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                          {new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td>
                          <span className={`badge ${inc.severity === 'CRITICAL' ? 'badge-critical' : inc.severity === 'HIGH' ? 'badge-high' : inc.severity === 'MEDIUM' ? 'badge-medium' : 'badge-low'}`}>
                            {inc.severity}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{inc.title}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{inc.description?.slice(0, 60)}</div>
                          {inc.rca_findings && (
                            <div style={{ marginTop: '0.25rem', padding: '0.25rem 0.5rem', background: 'var(--bg-page)', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--success)' }}>
                              <strong>RCA:</strong> {inc.rca_findings}
                            </div>
                          )}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{inc.asset_tag || '—'}</td>
                        <td><span className="badge badge-low">{inc.status}</span></td>
                        <td>{renderSLA(inc)}</td>
                        <td style={{ fontSize: '0.85rem' }}>{inc.reporter_name || 'System'}</td>
                        <td>
                          {inc.status === 'DECLARED' && (
                            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => handleIncidentTransition(inc.incident_id, 'acknowledge')}>
                              Acknowledge
                            </button>
                          )}
                          {inc.status === 'ACKNOWLEDGED' && (
                            <button className="btn btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => {
                                const findings = prompt('Enter Root Cause Analysis (RCA) findings:', 'Operator error or mechanical fatigue identified.');
                                if (findings) {
                                  // Update status and save RCA findings
                                  fetch(`${API_BASE}/incidents/${inc.incident_id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                    body: JSON.stringify({ action: 'investigate', rca_findings: findings }),
                                  })
                                  .then(res => res.json())
                                  .then(updated => {
                                    setIncidents(prev => prev.map(i => i.incident_id === inc.incident_id ? { ...i, ...updated } : i));
                                  });
                                }
                              }}>
                              Open RCA
                            </button>
                          )}
                          {inc.status === 'INVESTIGATION' && (
                            <button className="btn btn-accent" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => handleIncidentTransition(inc.incident_id, 'close')}>
                              Sign Close
                            </button>
                          )}
                          {inc.status === 'CLOSED' && (
                            <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.75rem' }}>✓ Closed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Incident Declaration Form */}
            <div className="card">
              <h3 style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                Declare Incident
              </h3>
              {incFormError && <div className="alert alert-danger" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>{incFormError}</div>}

              <form onSubmit={handleIncidentSubmit}>
                <div className="form-group">
                  <label className="form-label">Incident Title</label>
                  <input type="text" className="form-input" value={incTitle}
                    onChange={e => setIncTitle(e.target.value)} placeholder="Brief one-line description" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Details</label>
                  <textarea className="form-input" rows={3} value={incDesc}
                    onChange={e => setIncDesc(e.target.value)} placeholder="Describe the abnormal condition, sounds, or observations" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Severity</label>
                  <select className="form-input" value={incSeverity} onChange={e => setIncSeverity(e.target.value)}>
                    <option value="LOW">Low — Defect, no production impact</option>
                    <option value="MEDIUM">Medium — Operations affected</option>
                    <option value="HIGH">High — Unit outage risk (1 hr SLA)</option>
                    <option value="CRITICAL">Critical — Life safety threat (15 min SLA)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Related Asset (Optional)</label>
                  <select className="form-input" value={incAsset} onChange={e => setIncAsset(e.target.value)}>
                    <option value="">— Plant-wide / No specific asset —</option>
                    {assets.map(a => <option key={a.asset_id} value={a.asset_id}>{a.asset_tag} — {a.asset_name}</option>)}
                  </select>
                </div>
                <button type="submit" className="btn btn-danger" style={{ width: '100%', marginTop: '0.5rem' }}>
                  Declare & Escalate Incident
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ═══ PERMITS & LOTO ═══ */}
        {activeTab === 'permits' && (
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '1.5rem', padding: '2rem' }}>
            {/* Permits Table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Active Permits */}
              <div className="card">
                <h3 style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                  Active Permit-to-Work (PTW) Registry
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {permits.map(permit => (
                    <div key={permit.permit_id} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                      {/* Permit Header */}
                      <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-page)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', align: 'center', gap: '0.75rem' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{permit.permit_id}</span>
                          <span className="badge badge-amber">{permit.category.replace(/_/g, ' ')}</span>
                          {permitStatusBadge(permit.status)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Valid until {new Date(permit.valid_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      {/* Permit Body */}
                      <div style={{ padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Asset</div>
                          <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{permit.asset_tag}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Applied By</div>
                          <div style={{ fontWeight: 600 }}>{permit.applied_by}</div>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Safety Precautions</div>
                          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{permit.safety_precautions}</div>
                        </div>
                      </div>

                      {/* LOTO Records */}
                      {permit.loto.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border-color)', padding: '0.75rem 1rem', background: 'var(--bg-page)' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                            LOTO Isolation Points
                          </div>
                          {permit.loto.map((lock, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', fontSize: '0.875rem', borderBottom: idx < permit.loto.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                              <div>
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--danger)' }}>#{lock.lock_number}</span>
                                <span style={{ marginLeft: '0.75rem', color: 'var(--text-secondary)' }}>{lock.isolation_point}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>By: {lock.applied_by}</span>
                                {lock.removed_at
                                  ? <span className="badge badge-green">REMOVED</span>
                                  : <span className="badge badge-red">LOCKED</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Permit Request Form */}
            <div className="card">
              <h3 style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                Request New Permit
              </h3>
              {permitFormError && <div className="alert alert-danger" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>{permitFormError}</div>}
              {permitSuccessMsg && <div className="alert alert-success" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>{permitSuccessMsg}</div>}

              <form onSubmit={handlePermitSubmit}>
                <div className="form-group">
                  <label className="form-label">Permit Category</label>
                  <select className="form-input" value={newPermitCat} onChange={e => setNewPermitCat(e.target.value)}>
                    <option value="HOT_WORK">Hot Work</option>
                    <option value="CONFINED_SPACE">Confined Space Entry</option>
                    <option value="COLD_WORK">Cold Work / General</option>
                    <option value="HEIGHT_WORK">Work at Height</option>
                    <option value="ELECTRICAL">Electrical Isolation</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Asset / Location</label>
                  <select className="form-input" value={newPermitAsset} onChange={e => setNewPermitAsset(e.target.value)} required>
                    <option value="">— Select Asset —</option>
                    {assets.map(a => <option key={a.asset_id} value={a.asset_id}>{a.asset_tag} — {a.asset_name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Safety Precautions</label>
                  <textarea className="form-input" rows={3} value={newPermitPrecautions}
                    onChange={e => setNewPermitPrecautions(e.target.value)}
                    placeholder="Describe required safety measures, PPE, and isolation steps" />
                </div>
                <button type="submit" className="btn btn-accent" style={{ width: '100%' }}>
                  Submit Permit Request
                </button>
              </form>

              {/* Legend */}
              <div style={{ marginTop: '1.5rem', padding: '0.75rem', background: 'var(--bg-page)', borderRadius: '8px', fontSize: '0.8rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>PTW Lifecycle</div>
                {['PTW_Draft → PendingApproval', 'Approved → IsolationInProgress', 'WorkActive → DeisolationPending', 'LOTO Removed → PTW_Closed'].map((step, i) => (
                  <div key={i} style={{ color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                    {i + 1}. {step}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ REPORTS & EXPORTS ═══ */}
        {activeTab === 'reports' && (
          <div style={{ padding: '2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem' }}>
              {/* Report Generator */}
              <div className="card">
                <h3 style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                  Report Generator
                </h3>
                <div className="form-group">
                  <label className="form-label">Report Type</label>
                  <select className="form-input" value={reportType} onChange={e => setReportType(e.target.value)}>
                    <option value="shift_summary">Daily Shift Summary</option>
                    <option value="incident_report">Incident Trend Report</option>
                    <option value="permit_compliance">Permit Compliance Report</option>
                    <option value="audit_export">Audit Trail Export</option>
                  </select>
                </div>
                <div style={{ marginTop: '0.5rem', marginBottom: '1.5rem', padding: '0.75rem', background: 'var(--bg-page)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {reportType === 'shift_summary' && 'Exports all shift readings, out-of-bounds alerts, and handover records for the current session.'}
                  {reportType === 'incident_report' && 'Summarises declared incidents, severity distribution, SLA breach rates, and resolution times.'}
                  {reportType === 'permit_compliance' && 'Lists all PTW and LOTO records with isolation verification status and closure dates.'}
                  {reportType === 'audit_export' && 'Exports all audit events with SHA-256 hash signatures for regulatory review.'}
                </div>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={generateReport}>
                  ↓ Download .txt Report
                </button>
              </div>

              {/* Summary Stats */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Shift Stats */}
                <div className="card">
                  <h3 style={{ marginBottom: '1rem' }}>Current Shift Statistics</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                    {[
                      { label: 'Total Logs', value: logs.length, color: '#3b82f6' },
                      { label: 'OOB Readings', value: outOfBoundsLogs.length, color: outOfBoundsLogs.length > 0 ? '#ef4444' : '#10b981' },
                      { label: 'Incidents', value: incidents.length, color: incidents.length > 0 ? '#f59e0b' : '#10b981' },
                      { label: 'Critical/High', value: criticalOpen.length, color: criticalOpen.length > 0 ? '#ef4444' : '#10b981' },
                      { label: 'Active Permits', value: permits.filter(p => p.status !== 'PTW_Closed').length, color: '#f59e0b' },
                      { label: 'Audit Events', value: auditLogs.length, color: '#8b5cf6' },
                    ].map(stat => (
                      <div key={stat.label} style={{ padding: '1rem', background: 'var(--bg-page)', borderRadius: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '2rem', fontWeight: 800, color: stat.color, fontFamily: 'var(--font-display)' }}>{stat.value}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Handover history */}
                <div className="card">
                  <h3 style={{ marginBottom: '1rem' }}>Handover History</h3>
                  {handovers.length === 0
                    ? <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No handovers completed this session.</p>
                    : (
                      <table className="log-grid" style={{ fontSize: '0.875rem' }}>
                        <thead><tr><th>Date</th><th>Shift</th><th>Outgoing</th><th>Status</th><th>Signed At</th></tr></thead>
                        <tbody>
                          {handovers.map(h => (
                            <tr key={h.handover_id}>
                              <td>{h.shift_date}</td>
                              <td>Shift {h.shift_type}</td>
                              <td>{h.outgoing_name || user?.username}</td>
                              <td>{permitStatusBadge(h.status)}</td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                                {h.outgoing_signed_at ? new Date(h.outgoing_signed_at).toLocaleTimeString() : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ COMMUNICATIONS & BROADCASTS ═══ */}
        {activeTab === 'comms' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '2rem' }}>
            
            {/* Walkie-Talkie */}
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', border: isRecording ? '2px solid var(--danger)' : isReceivingAudio ? '2px solid var(--success)' : '1px solid var(--border-color)' }}>
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Icon d={ICONS.mic} size={20} />
                  Live Walkie-Talkie Channel
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  Push and hold to broadcast your voice to all active operators on the network.
                </p>
                {speakerInfo && (
                  <div style={{ marginTop: '0.5rem', color: 'var(--success)', fontWeight: 'bold', fontSize: '0.85rem' }}>
                    <span className="badge badge-green">{speakerInfo}</span>
                  </div>
                )}
              </div>
              <button 
                className={`btn ${isRecording ? 'btn-critical' : 'btn-primary'}`}
                style={{ padding: '1rem 2rem', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '50px', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.1s' }}
                onMouseDown={handleStartRecording}
                onMouseUp={handleStopRecording}
                onMouseLeave={handleStopRecording}
                onTouchStart={handleStartRecording}
                onTouchEnd={handleStopRecording}
              >
                <Icon d={ICONS.mic} size={24} />
                {isRecording ? 'RECORDING... (Release to send)' : 'PUSH TO TALK'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '1.5rem' }}>
              {/* Active Broadcasts */}
              <div className="card">
                <h3 style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                  Plant Communications & Safety Broadcasts
                </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {broadcasts.map(msg => (
                  <div key={msg.id} style={{ 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    background: msg.severity === 'HIGH' ? 'var(--danger-bg)' : 'var(--bg-page)',
                    borderLeft: `4px solid ${msg.severity === 'HIGH' ? 'var(--danger)' : 'var(--info)'}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <strong>{msg.sender}</strong>
                        <span className="badge badge-low">{msg.role}</span>
                        <span className={`badge ${msg.scope === 'PLANT_WIDE' ? 'badge-amber' : 'badge-low'}`}>{msg.scope.replace(/_/g, ' ')}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                    
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                      {msg.message}
                    </p>

                    <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                      {msg.acknowledged ? (
                        <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>✓ Acknowledged</span>
                      ) : (
                        <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                          onClick={() => acknowledgeBroadcast(msg.id)}>
                          Acknowledge
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Broadcast Form */}
            <div className="card">
              <h3 style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                Publish Broadcast
              </h3>
              
              <form onSubmit={handleBroadcast}>
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>Message Text</label>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }} onClick={() => handleDictate(setNewBroadcast)}>
                      <Icon d={ICONS.mic} size={14} /> Dictate
                    </button>
                  </div>
                  <textarea className="form-input" rows={4} value={newBroadcast} 
                    onChange={e => setNewBroadcast(e.target.value)}
                    placeholder="Enter safety instructions or announcement..." required />
                </div>

                <div className="form-group">
                  <label className="form-label">Severity Level</label>
                  <select className="form-input" value={broadcastSeverity} onChange={e => setBroadcastSeverity(e.target.value)}>
                    <option value="INFO">Information / Update</option>
                    <option value="HIGH">High Alert / Safety Advisory</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Target Broadcast Scope</label>
                  <select className="form-input" value={broadcastScope} onChange={e => setBroadcastScope(e.target.value)}>
                    <option value="PLANT_WIDE">Plant Wide</option>
                    <option value="ZONE_A">Zone A Distillation</option>
                    <option value="ZONE_B">Zone B Vacuum Unit</option>
                    <option value="LPG_BOTTLING">LPG Bottling Facility</option>
                    <option value="R_AND_D">R&D Lab</option>
                  </select>
                </div>

                <button type="submit" className="btn btn-accent" style={{ width: '100%' }}>
                  Publish Alert
                </button>
              </form>
            </div>
            </div>
          </div>
        )}

        {/* ═══ AUDIT EXPLORER ═══ */}
        {activeTab === 'audit' && (
          <div style={{ padding: '2rem' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
                <div>
                  <h3>Tamper-Evident Audit Trail</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                    Every mutation is SHA-256 signed using actor ID + role + action + timestamps. Row integrity is verified on each load.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexShrink: 0 }}>
                  <button className="btn btn-secondary" onClick={loadData}>↻ Refresh</button>
                </div>
              </div>

              {/* Integrity Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                  { label: 'Total Events', value: auditLogs.length, color: '#3b82f6' },
                  { label: 'Verified OK', value: auditLogs.filter(a => a.verified !== false).length, color: '#10b981' },
                  { label: 'Tampered Rows', value: auditLogs.filter(a => a.verified === false).length, color: '#ef4444' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '1rem', background: 'var(--bg-page)', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.75rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="log-grid" style={{ fontSize: '0.825rem' }}>
                  <thead>
                    <tr>
                      <th>Timestamp</th><th>Actor</th><th>Role</th><th>Action</th>
                      <th>Table</th><th>Source IP</th><th>Integrity</th><th>SHA-256</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        No audit events yet. Log in and perform actions, then refresh.
                      </td></tr>
                    )}
                    {auditLogs.map(a => (
                      <tr key={a.audit_id} style={a.verified === false ? { background: 'var(--danger-bg)' } : {}}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                          {new Date(a.event_timestamp).toLocaleString()}
                        </td>
                        <td><strong>{a.username || 'System'}</strong></td>
                        <td><span className="badge badge-low">{a.actor_role}</span></td>
                        <td><strong>{a.action_type}</strong></td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{a.target_table}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{a.source_ip}</td>
                        <td>
                          {a.verified === false
                            ? <span className="badge badge-critical">✗ TAMPERED</span>
                            : <span className="badge badge-green">✓ VERIFIED</span>}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          {a.payload_hash?.slice(0, 12)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {/* ═══ ADMIN PANEL ═══ */}
        {activeTab === 'admin' && (
          <div style={{ padding: '2rem' }}>
            <div className="card" style={{ marginBottom: '2rem' }}>
              <h3 style={{ marginBottom: '1.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                System Administration - User Management
              </h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
                {/* Create User Form */}
                <div style={{ padding: '1.5rem', background: 'var(--bg-page)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ marginBottom: '1rem', color: 'var(--primary)' }}>Provision New Identity</h4>
                  {adminFormError && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{adminFormError}</div>}
                  {adminFormSuccess && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{adminFormSuccess}</div>}
                  
                  <form onSubmit={handleCreateUser}>
                    <div className="form-group">
                      <label className="form-label">Username</label>
                      <input type="text" className="form-input" value={adminNewUsername} onChange={e => setAdminNewUsername(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email Address</label>
                      <input type="email" className="form-input" value={adminNewEmail} onChange={e => setAdminNewEmail(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Initial Password</label>
                      <input type="password" className="form-input" value={adminNewPassword} onChange={e => setAdminNewPassword(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">System Role</label>
                      <select className="form-input" value={adminNewRole} onChange={e => setAdminNewRole(e.target.value)} required>
                        {adminRoles.map(r => (
                          <option key={r.role_id} value={r.role_id}>{r.role_name} - {r.description}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Plant Zone / Assignment</label>
                      <select className="form-input" value={adminNewZone} onChange={e => setAdminNewZone(e.target.value)}>
                        <option value="ZONE_A_DISTILLATION">Zone A (Distillation)</option>
                        <option value="ZONE_B_VACUUM">Zone B (Vacuum Unit)</option>
                        <option value="LPG_BOTTLING">LPG Bottling Facility</option>
                        <option value="PLANT_WIDE">Plant Wide (All Zones)</option>
                        <option value="CORPORATE_HQ">Corporate HQ</option>
                      </select>
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
                      Create User Identity
                    </button>
                  </form>
                </div>

                {/* Users List & Role Management */}
                <div>
                  <h4 style={{ marginBottom: '1rem', color: 'var(--primary)' }}>Active Directory</h4>
                  <table className="log-grid" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Email / Zone</th>
                        <th>Status</th>
                        <th>Assigned Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.map(u => (
                        <tr key={u.user_id}>
                          <td><strong>{u.username}</strong></td>
                          <td>
                            <div style={{ color: 'var(--text-secondary)' }}>{u.email}</div>
                            <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>{u.plant_zone}</div>
                          </td>
                          <td>
                            {u.is_active ? <span className="badge badge-green">Active</span> : <span className="badge badge-critical">Disabled</span>}
                          </td>
                          <td>
                            <select className="form-input" style={{ padding: '0.25rem', fontSize: '0.8rem', minWidth: '150px' }}
                              value={u.role_id}
                              onChange={(e) => handleUpdateRole(u.user_id, e.target.value)}
                              disabled={u.username === user?.username}>
                              {adminRoles.map(r => (
                                <option key={r.role_id} value={r.role_id}>{r.role_name}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
