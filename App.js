import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

const API = 'http://localhost:8080';

// ─── Utility ─────────────────────────────────────────────────────────────────
const fmt = {
  bytes: (b) => b > 1e9 ? `${(b/1e9).toFixed(2)} GB` : b > 1e6 ? `${(b/1e6).toFixed(1)} MB` : `${Math.round(b/1024)} KB`,
  time: (iso) => iso ? new Date(iso).toLocaleTimeString() : '—',
  duration: (start, end) => {
    if (!start) return '—';
    const ms = (end ? new Date(end) : new Date()) - new Date(start);
    return `${(ms/1000).toFixed(1)}s`;
  }
};

const STATUS_META = {
  idle:       { color: '#64748b', label: 'IDLE',       glow: false },
  preparing:  { color: '#f59e0b', label: 'PREPARING',  glow: true  },
  migrating:  { color: '#3b82f6', label: 'MIGRATING',  glow: true  },
  validating: { color: '#8b5cf6', label: 'VALIDATING', glow: true  },
  completed:  { color: '#10b981', label: 'COMPLETED',  glow: false },
  failed:     { color: '#ef4444', label: 'FAILED',     glow: false },
  recovering: { color: '#f97316', label: 'RECOVERING', glow: true  },
};

const ENV_STATUS_COLOR = {
  online:    '#10b981',
  ready:     '#3b82f6',
  migrating: '#f59e0b',
  error:     '#ef4444',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function ScanLine() {
  return <div className="scanline" aria-hidden />;
}

function GlitchText({ text }) {
  return (
    <span className="glitch" data-text={text}>{text}</span>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.idle;
  return (
    <span className="status-badge" style={{ '--c': meta.color, '--glow': meta.glow ? `0 0 12px ${meta.color}88` : 'none' }}>
      <span className="status-dot" />
      {meta.label}
    </span>
  );
}

function ProgressBar({ value, status }) {
  const meta = STATUS_META[status] || STATUS_META.idle;
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${value}%`, background: meta.color, boxShadow: `0 0 16px ${meta.color}66` }} />
      <div className="progress-glow" style={{ left: `${value}%`, background: meta.color }} />
    </div>
  );
}

function ContainerCard({ container, migrated = false, active = false }) {
  const statusColor = container.status === 'running' ? '#10b981' : '#ef4444';
  return (
    <div className={`container-card ${active ? 'active' : ''} ${migrated ? 'migrated' : ''}`}>
      <div className="container-card-top">
        <span className="container-dot" style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}` }} />
        <span className="container-name">{container.name}</span>
        {active && <span className="active-tag">TRANSFERRING</span>}
        {migrated && <span className="migrated-tag">✓ MIGRATED</span>}
      </div>
      <div className="container-meta">
        <span>{container.image}</span>
        <span>{container.size} MB</span>
      </div>
      <div className="container-records">
        <span className="records-label">Records</span>
        <span className="records-value">{container.data?.records?.toLocaleString() || 0}</span>
      </div>
    </div>
  );
}

function LogLine({ log }) {
  const colors = { info: '#64748b', warn: '#f59e0b', error: '#ef4444', success: '#10b981', system: '#8b5cf6' };
  const icons  = { info: '›', warn: '⚠', error: '✕', success: '✓', system: '◈' };
  return (
    <div className="log-line" style={{ '--lc': colors[log.level] || '#64748b' }}>
      <span className="log-icon">{icons[log.level] || '›'}</span>
      <span className="log-time">{fmt.time(log.timestamp)}</span>
      {log.container && <span className="log-container">[{log.container}]</span>}
      <span className="log-msg">{log.message}</span>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="stat-card" style={{ '--acc': accent || '#3b82f6' }}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function BackupCard({ backup, onRestore }) {
  return (
    <div className="backup-card">
      <div className="backup-header">
        <span className="backup-id">{backup.id}</span>
        <span className={`backup-status ${backup.status}`}>{backup.status.toUpperCase()}</span>
      </div>
      <div className="backup-label">{backup.label}</div>
      <div className="backup-meta">
        <span>📦 {backup.environment}</span>
        <span>🕐 {fmt.time(backup.timestamp)}</span>
        <span>💾 {backup.size} MB</span>
        <span>🔐 {backup.checksum?.slice(0, 8)}…</span>
      </div>
      <button className="btn-restore" onClick={() => onRestore(backup.id)}>
        ↺ Restore
      </button>
    </div>
  );
}

// ─── Data Flow Animation ──────────────────────────────────────────────────────
function DataFlow({ active, status }) {
  const particles = Array.from({ length: 12 }, (_, i) => i);
  const color = STATUS_META[status]?.color || '#3b82f6';
  return (
    <div className={`data-flow ${active ? 'flowing' : ''}`}>
      <svg viewBox="0 0 300 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="flow-svg">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Main pipe */}
        <line x1="20" y1="30" x2="280" y2="30" stroke="#1e293b" strokeWidth="3" />
        <line x1="20" y1="30" x2="280" y2="30" stroke={color} strokeWidth="1" opacity="0.3" />
        {/* Arrow head */}
        <polygon points="275,25 285,30 275,35" fill={color} opacity="0.8" filter="url(#glow)" />
        {/* Animated particles */}
        {active && particles.map(i => (
          <circle key={i} r="2.5" fill={color} filter="url(#glow)" opacity="0.9">
            <animateMotion
              dur={`${1.2 + i * 0.15}s`}
              begin={`${-i * 0.1}s`}
              repeatCount="indefinite"
              path="M20,30 L280,30"
            />
          </circle>
        ))}
      </svg>
      {active && (
        <div className="flow-label" style={{ color }}>
          {status === 'migrating' && '⟶ LIVE TRANSFER'}
          {status === 'validating' && '⟶ VALIDATING'}
          {status === 'recovering' && '⟵ RECOVERING'}
          {status === 'preparing' && '⟶ PREPARING'}
        </div>
      )}
    </div>
  );
}

// ─── Notification Toast ───────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [appState, setAppState] = useState(null);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState({});
  const [toasts, setToasts] = useState([]);
  const [validation, setValidation] = useState(null);
  const [connected, setConnected] = useState(false);
  const logsEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  const toast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  // SSE connection
  useEffect(() => {
    const connect = () => {
      const es = new EventSource(`${API}/api/events`);
      eventSourceRef.current = es;

      es.onopen = () => setConnected(true);
      es.onmessage = (e) => {
        const evt = JSON.parse(e.data);
        if (evt.type === 'CONNECTED' || evt.type === 'STATE_UPDATE') {
          setAppState(evt.payload);
        } else if (evt.type === 'LOG') {
          setLogs(prev => [evt.payload, ...prev].slice(0, 300));
        } else if (evt.type === 'VALIDATION') {
          setValidation(evt.payload);
        }
      };
      es.onerror = () => { setConnected(false); es.close(); setTimeout(connect, 3000); };
    };
    connect();
    return () => eventSourceRef.current?.close();
  }, []);

  // Fetch initial logs
  useEffect(() => {
    fetch(`${API}/api/logs?limit=100`).then(r => r.json()).then(setLogs).catch(() => {});
  }, []);

  const call = async (method, endpoint, body) => {
    setLoading(l => ({ ...l, [endpoint]: true }));
    try {
      const r = await fetch(`${API}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await r.json();
      if (!data.success && data.error) toast(data.error, 'error');
      return data;
    } catch (err) {
      toast('Network error', 'error');
    } finally {
      setLoading(l => ({ ...l, [endpoint]: false }));
    }
  };

  const handleMigrate = async () => {
    toast('Migration started!', 'info');
    await call('POST', '/api/migrate');
  };

  const handleBackup = async (env) => {
    const r = await call('POST', '/api/backup', { environment: env });
    if (r?.success) toast(`Backup created: ${r.backup.id}`, 'success');
  };

  const handleRestore = async (backupId) => {
    const r = await call('POST', '/api/restore', { backupId, targetEnvironment: 'target' });
    if (r?.success) toast(r.checksumValid ? 'Restore complete ✓' : 'Restore done (checksum mismatch!)', r.checksumValid ? 'success' : 'warn');
  };

  const handleValidate = async () => {
    const r = await call('POST', '/api/validate');
    if (r) toast(r.valid ? '✓ Data is consistent!' : '✗ Inconsistency detected!', r.valid ? 'success' : 'error');
  };

  const handleInjectFailure = async () => {
    await call('POST', '/api/simulate-failure');
    toast('⚠ Failure injection armed!', 'warn');
  };

  const handleReset = async () => {
    await call('POST', '/api/reset');
    setValidation(null);
    toast('System reset', 'info');
  };

  const mig = appState?.migration || {};
  const src = appState?.source;
  const tgt = appState?.target;
  const stats = appState?.stats || {};
  const isActive = ['preparing', 'migrating', 'validating', 'recovering'].includes(mig.status);

  return (
    <div className="app">
      <ScanLine />
      <Toast toasts={toasts} />

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <div className="logo-icon">⬡</div>
            <div>
              <div className="logo-title"><GlitchText text="MIGRATEK" /></div>
              <div className="logo-sub">Container Migration & Backup System</div>
            </div>
          </div>
        </div>
        <div className="header-center">
          <nav className="nav">
            {['dashboard', 'logs', 'backups', 'validation'].map(tab => (
              <button key={tab} className={`nav-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                {tab.toUpperCase()}
                {tab === 'logs' && logs.length > 0 && <span className="nav-badge">{logs.length}</span>}
              </button>
            ))}
          </nav>
        </div>
        <div className="header-right">
          <div className={`conn-dot ${connected ? 'live' : 'dead'}`} />
          <span className="conn-label">{connected ? 'LIVE' : 'OFFLINE'}</span>
        </div>
      </header>

      <main className="main">

        {/* ── DASHBOARD ─────────────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div className="dashboard">

            {/* Stats row */}
            <div className="stats-row">
              <StatCard label="TOTAL MIGRATIONS" value={stats.totalMigrations || 0} accent="#3b82f6" />
              <StatCard label="SUCCESSFUL" value={stats.successfulMigrations || 0} accent="#10b981" />
              <StatCard label="FAILED" value={stats.failedMigrations || 0} accent="#ef4444" />
              <StatCard label="DATA TRANSFERRED" value={`${stats.totalDataTransferred || 0} MB`} accent="#8b5cf6" />
              <StatCard label="AVG DURATION" value={`${stats.avgMigrationTime || 0}s`} accent="#f59e0b" />
              <StatCard label="BACKUPS" value={appState?.backups?.length || 0} accent="#06b6d4" />
            </div>

            {/* Migration Status Bar */}
            {mig.id && (
              <div className="migration-status-bar">
                <div className="msb-left">
                  <StatusBadge status={mig.status} />
                  <span className="msb-id">{mig.id}</span>
                  {mig.currentContainer && <span className="msb-container">⟶ {mig.currentContainer}</span>}
                </div>
                <div className="msb-center">
                  <ProgressBar value={mig.progress} status={mig.status} />
                  <div className="msb-pcnt">{mig.progress}%</div>
                </div>
                <div className="msb-right">
                  <span>{fmt.bytes(mig.transferredBytes)} / {fmt.bytes(mig.totalBytes)}</span>
                  <span>{fmt.duration(mig.startTime, mig.endTime)}</span>
                </div>
              </div>
            )}

            {/* Environments Arena */}
            <div className="arena">

              {/* Source Env */}
              <div className="env-panel source">
                <div className="env-header">
                  <div className="env-title-group">
                    <span className="env-label">SOURCE</span>
                    <span className="env-name">{src?.name}</span>
                  </div>
                  <div className="env-badges">
                    <span className="env-status-dot" style={{ background: ENV_STATUS_COLOR[src?.status] || '#64748b', boxShadow: `0 0 8px ${ENV_STATUS_COLOR[src?.status] || '#64748b'}` }} />
                    <span className="env-status-text">{src?.status?.toUpperCase()}</span>
                  </div>
                </div>
                <div className="env-id">{src?.id}</div>
                <div className="env-health">
                  <span>HEALTH</span>
                  <div className="health-bar">
                    <div className="health-fill" style={{ width: `${src?.health || 0}%`, background: src?.health > 70 ? '#10b981' : src?.health > 40 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span>{src?.health}%</span>
                </div>
                <div className="containers-grid">
                  {src?.containers?.map(c => (
                    <ContainerCard key={c.id} container={c}
                      active={mig.currentContainer === c.name}
                      migrated={tgt?.containers?.some(t => t.id === c.id)}
                    />
                  ))}
                </div>
                <button className="btn-secondary btn-sm" onClick={() => handleBackup('source')} disabled={loading['/api/backup']}>
                  📸 Snapshot
                </button>
              </div>

              {/* Flow Column */}
              <div className="flow-column">
                <DataFlow active={isActive} status={mig.status} />
                <div className="flow-controls">
                  <button className="btn-primary" onClick={handleMigrate}
                    disabled={isActive || loading['/api/migrate']}>
                    {isActive ? '⟳ IN PROGRESS' : '▶ START MIGRATION'}
                  </button>
                  <button className="btn-danger-outline" onClick={handleInjectFailure}
                    disabled={isActive || mig.failureInjected}
                    title="Arm a failure that fires mid-migration">
                    {mig.failureInjected ? '💥 ARMED' : '☠ INJECT FAILURE'}
                  </button>
                  <button className="btn-secondary btn-sm" onClick={handleReset} disabled={isActive}>
                    ↺ Reset Target
                  </button>
                </div>
                {mig.failureInjected && (
                  <div className="failure-armed-badge">⚠ FAILURE ARMED</div>
                )}
              </div>

              {/* Target Env */}
              <div className="env-panel target">
                <div className="env-header">
                  <div className="env-title-group">
                    <span className="env-label">TARGET</span>
                    <span className="env-name">{tgt?.name}</span>
                  </div>
                  <div className="env-badges">
                    <span className="env-status-dot" style={{ background: ENV_STATUS_COLOR[tgt?.status] || '#64748b', boxShadow: `0 0 8px ${ENV_STATUS_COLOR[tgt?.status] || '#64748b'}` }} />
                    <span className="env-status-text">{tgt?.status?.toUpperCase()}</span>
                  </div>
                </div>
                <div className="env-id">{tgt?.id}</div>
                <div className="env-health">
                  <span>HEALTH</span>
                  <div className="health-bar">
                    <div className="health-fill" style={{ width: `${tgt?.health || 0}%`, background: tgt?.health > 70 ? '#10b981' : tgt?.health > 40 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span>{tgt?.health}%</span>
                </div>
                <div className="containers-grid">
                  {tgt?.containers?.length === 0 && (
                    <div className="empty-target">
                      <span>Awaiting migration…</span>
                    </div>
                  )}
                  {tgt?.containers?.map(c => (
                    <ContainerCard key={c.id} container={c} migrated />
                  ))}
                </div>
                <button className="btn-validate" onClick={handleValidate} disabled={!tgt?.containers?.length || loading['/api/validate']}>
                  ✓ Validate Consistency
                </button>
              </div>
            </div>

            {/* Validation result */}
            {validation && (
              <div className={`validation-result ${validation.valid ? 'pass' : 'fail'}`}>
                <div className="vr-header">
                  <span className="vr-icon">{validation.valid ? '✓' : '✗'}</span>
                  <span className="vr-title">{validation.valid ? 'DATA CONSISTENCY VERIFIED' : 'INCONSISTENCY DETECTED'}</span>
                </div>
                <div className="vr-grid">
                  <div><label>Source Checksum</label><code>{validation.sourceChecksum}</code></div>
                  <div><label>Target Checksum</label><code>{validation.targetChecksum}</code></div>
                  <div><label>Source Records</label><code>{validation.sourceRecords?.toLocaleString()}</code></div>
                  <div><label>Target Records</label><code>{validation.targetRecords?.toLocaleString()}</code></div>
                  <div><label>Containers (Src)</label><code>{validation.containerCount?.source}</code></div>
                  <div><label>Containers (Tgt)</label><code>{validation.containerCount?.target}</code></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LOGS ──────────────────────────────────────────────────────────── */}
        {activeTab === 'logs' && (
          <div className="logs-panel">
            <div className="logs-toolbar">
              <span className="logs-count">{logs.length} entries</span>
              <button className="btn-secondary btn-sm" onClick={() => setLogs([])}>Clear</button>
            </div>
            <div className="logs-stream" ref={logsEndRef}>
              {logs.length === 0 && <div className="logs-empty">No logs yet. Start a migration to see live activity.</div>}
              {logs.map(log => <LogLine key={log.id} log={log} />)}
            </div>
          </div>
        )}

        {/* ── BACKUPS ───────────────────────────────────────────────────────── */}
        {activeTab === 'backups' && (
          <div className="backups-panel">
            <div className="backups-toolbar">
              <span>{appState?.backups?.length || 0} backups</span>
              <div className="backup-actions">
                <button className="btn-secondary" onClick={() => handleBackup('source')} disabled={loading['/api/backup']}>
                  + Snapshot Source
                </button>
                <button className="btn-secondary" onClick={() => handleBackup('target')} disabled={!tgt?.containers?.length}>
                  + Snapshot Target
                </button>
              </div>
            </div>
            {(!appState?.backups || appState.backups.length === 0) && (
              <div className="backups-empty">No backups yet. Create a snapshot or start a migration.</div>
            )}
            <div className="backups-grid">
              {appState?.backups?.map(b => (
                <BackupCard key={b.id} backup={b} onRestore={handleRestore} />
              ))}
            </div>
          </div>
        )}

        {/* ── VALIDATION ────────────────────────────────────────────────────── */}
        {activeTab === 'validation' && (
          <div className="validation-panel">
            <div className="val-header">
              <h2>Data Consistency Validator</h2>
              <p>Compare source and target environments to ensure migration integrity.</p>
            </div>
            <button className="btn-validate-large" onClick={handleValidate} disabled={loading['/api/validate']}>
              ▶ Run Consistency Check
            </button>
            {validation && (
              <div className={`validation-detail ${validation.valid ? 'pass' : 'fail'}`}>
                <div className="vd-score">
                  <div className="vd-icon">{validation.valid ? '✓' : '✗'}</div>
                  <div className="vd-verdict">{validation.valid ? 'CONSISTENT' : 'INCONSISTENT'}</div>
                  <div className="vd-time">Checked at {fmt.time(validation.timestamp)}</div>
                </div>
                <div className="vd-table">
                  <table>
                    <thead><tr><th>Metric</th><th>Source</th><th>Target</th><th>Match</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>Checksum</td>
                        <td><code>{validation.sourceChecksum}</code></td>
                        <td><code>{validation.targetChecksum}</code></td>
                        <td className={validation.sourceChecksum === validation.targetChecksum ? 'match' : 'mismatch'}>
                          {validation.sourceChecksum === validation.targetChecksum ? '✓' : '✗'}
                        </td>
                      </tr>
                      <tr>
                        <td>Total Records</td>
                        <td>{validation.sourceRecords?.toLocaleString()}</td>
                        <td>{validation.targetRecords?.toLocaleString()}</td>
                        <td className={validation.sourceRecords === validation.targetRecords ? 'match' : 'mismatch'}>
                          {validation.sourceRecords === validation.targetRecords ? '✓' : '✗'}
                        </td>
                      </tr>
                      <tr>
                        <td>Container Count</td>
                        <td>{validation.containerCount?.source}</td>
                        <td>{validation.containerCount?.target}</td>
                        <td className={validation.containerCount?.source === validation.containerCount?.target ? 'match' : 'mismatch'}>
                          {validation.containerCount?.source === validation.containerCount?.target ? '✓' : '✗'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {!validation && <div className="val-empty">Run a check to see results.</div>}
          </div>
        )}

      </main>
    </div>
  );
}
