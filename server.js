const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/build')));



// const Docker = require('dockerode');
// const docker = new Docker(); // auto connects to local Docker
// ─── In-Memory State ────────────────────────────────────────────────────────
let state = {
  source: {
    id: 'env-source-001',
    name: 'Production Source',
    status: 'online',
    health: 100,
    containers: [
      { id: 'c1', name: 'web-app', image: 'nginx:1.21', size: 128, status: 'running', data: { records: 1200, config: { port: 80, replicas: 3 } } },
      { id: 'c2', name: 'api-service', image: 'node:18-alpine', size: 256, status: 'running', data: { records: 4500, config: { port: 3000, replicas: 2 } } },
      { id: 'c3', name: 'postgres-db', image: 'postgres:14', size: 512, status: 'running', data: { records: 89000, config: { port: 5432, replicas: 1 } } },
      { id: 'c4', name: 'redis-cache', image: 'redis:7', size: 64, status: 'running', data: { records: 320, config: { port: 6379, replicas: 1 } } },
      { id: 'c5', name: 'monitoring', image: 'grafana:9', size: 192, status: 'running', data: { records: 15000, config: { port: 3001, replicas: 1 } } },
    ]
  },
  target: {
    id: 'env-target-001',
    name: 'Azure Cloud Target',
    status: 'ready',
    health: 100,
    containers: []
  },
  migration: {
    id: null,
    status: 'idle', // idle | preparing | migrating | validating | completed | failed | recovering
    progress: 0,
    currentContainer: null,
    startTime: null,
    endTime: null,
    transferredBytes: 0,
    totalBytes: 0,
    errors: [],
    failureInjected: false
  },
  backups: [],
  logs: [],
  stats: {
    totalMigrations: 0,
    successfulMigrations: 0,
    failedMigrations: 0,
    totalDataTransferred: 0,
    avgMigrationTime: 0
  }
};

// SSE clients
let sseClients = [];

// ─── Helpers ────────────────────────────────────────────────────────────────
function addLog(level, message, container = null, meta = {}) {
  const log = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    level, // info | warn | error | success | system
    message,
    container,
    meta,
    migrationId: state.migration.id
  };
  state.logs.unshift(log);
  if (state.logs.length > 500) state.logs = state.logs.slice(0, 500);
  broadcast({ type: 'LOG', payload: log });
  return log;
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  sseClients = sseClients.filter(client => {
    try { client.write(data); return true; }
    catch { return false; }
  });
}

function broadcastState() {
  broadcast({ type: 'STATE_UPDATE', payload: getSafeState() });
}

function getSafeState() {
  return {
    source: state.source,
    target: state.target,
    migration: state.migration,
    backups: state.backups.map(b => ({ ...b, data: undefined })),
    stats: state.stats,
    logCount: state.logs.length
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calcChecksum(containers) {
  return containers.reduce((acc, c) => acc + c.data.records + c.size, 0).toString(16);
}

// ─── SSE Endpoint ───────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', payload: getSafeState() })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

// ─── State Endpoints ────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => res.json(getSafeState()));
app.get('/api/logs', (req, res) => {
  const { limit = 100, level } = req.query;
  let logs = state.logs;
  if (level) logs = logs.filter(l => l.level === level);
  res.json(logs.slice(0, parseInt(limit)));
});

// ─── Backup Endpoint ────────────────────────────────────────────────────────
app.post('/api/backup', async (req, res) => {
  const { environment = 'source', label } = req.body;
  const env = state[environment];
  if (!env) return res.status(400).json({ error: 'Invalid environment' });

  const backup = {
    id: `bkp-${uuidv4().slice(0, 8)}`,
    label: label || `Backup ${new Date().toLocaleString()}`,
    environment,
    timestamp: new Date().toISOString(),
    containers: JSON.parse(JSON.stringify(env.containers)),
    checksum: calcChecksum(env.containers),
    size: env.containers.reduce((a, c) => a + c.size, 0),
    status: 'creating'
  };

  addLog('system', `Initiating backup of ${env.name}...`, null, { backupId: backup.id });
  await sleep(500);

  for (const c of env.containers) {
    addLog('info', `Snapshotting container: ${c.name}`, c.name, { size: c.size });
    await sleep(200);
  }

  backup.status = 'ready';
  state.backups.unshift(backup);
  addLog('success', `Backup ${backup.id} created successfully. Checksum: ${backup.checksum}`, null, { size: backup.size });
  broadcastState();
  res.json({ success: true, backup: { ...backup, data: undefined } });
});

// ─── Restore Endpoint ───────────────────────────────────────────────────────
app.post('/api/restore', async (req, res) => {
  const { backupId, targetEnvironment = 'target' } = req.body;
  const backup = state.backups.find(b => b.id === backupId);
  if (!backup) return res.status(404).json({ error: 'Backup not found' });

  addLog('system', `Starting restore from backup ${backup.id} to ${targetEnvironment}...`);
  state.migration.status = 'recovering';
  broadcastState();
  await sleep(800);

  for (const c of backup.containers) {
    addLog('info', `Restoring container: ${c.name}`, c.name);
    await sleep(300);
  }

  state[targetEnvironment].containers = JSON.parse(JSON.stringify(backup.containers));
  state[targetEnvironment].status = 'online';
  state[targetEnvironment].health = 100;
  state.migration.status = 'idle';

  const restoredChecksum = calcChecksum(state[targetEnvironment].containers);
  const valid = restoredChecksum === backup.checksum;
  addLog(valid ? 'success' : 'error',
    valid ? `Restore complete. Checksum validated: ${restoredChecksum}` : `Restore complete but checksum mismatch!`
  );
  broadcastState();
  res.json({ success: true, checksumValid: valid });
});

// ─── Validate Endpoint ──────────────────────────────────────────────────────
app.post('/api/validate', (req, res) => {
  const srcChecksum = calcChecksum(state.source.containers);
  const tgtChecksum = calcChecksum(state.target.containers);
  const valid = srcChecksum === tgtChecksum;
  const srcCount = state.source.containers.reduce((a, c) => a + c.data.records, 0);
  const tgtCount = state.target.containers.reduce((a, c) => a + c.data.records, 0);

  const report = {
    valid,
    sourceChecksum: srcChecksum,
    targetChecksum: tgtChecksum,
    sourceRecords: srcCount,
    targetRecords: tgtCount,
    containerCount: { source: state.source.containers.length, target: state.target.containers.length },
    timestamp: new Date().toISOString()
  };

  addLog(valid ? 'success' : 'error',
    valid ? `✓ Data consistency validated. Checksums match: ${srcChecksum}` : `✗ Checksum mismatch! Source: ${srcChecksum} | Target: ${tgtChecksum}`
  );
  broadcast({ type: 'VALIDATION', payload: report });
  res.json(report);
});

// ─── Simulate Failure ───────────────────────────────────────────────────────
app.post('/api/simulate-failure', (req, res) => {
  state.migration.failureInjected = true;
  addLog('warn', '⚠ Failure injection armed — will trigger on next migration', null, { armed: true });
  broadcastState();
  res.json({ success: true, message: 'Failure injection armed' });
});

// ─── Reset ──────────────────────────────────────────────────────────────────
app.post('/api/reset', (req, res) => {
  state.target.containers = [];
  state.target.status = 'ready';
  state.target.health = 100;
  state.migration = { id: null, status: 'idle', progress: 0, currentContainer: null, startTime: null, endTime: null, transferredBytes: 0, totalBytes: 0, errors: [], failureInjected: false };
  addLog('system', 'System reset. Target environment cleared.');
  broadcastState();
  res.json({ success: true });
});

// ─── Migration Endpoint ─────────────────────────────────────────────────────
app.post('/api/migrate', async (req, res) => {
  if (state.migration.status !== 'idle') {
    return res.status(409).json({ error: 'Migration already in progress' });
  }

  const migId = `mig-${uuidv4().slice(0, 8)}`;
  const containersToMigrate = JSON.parse(JSON.stringify(state.source.containers));
  const totalBytes = containersToMigrate.reduce((a, c) => a + c.size * 1024 * 1024, 0);

  state.migration = {
    id: migId,
    status: 'preparing',
    progress: 0,
    currentContainer: null,
    startTime: new Date().toISOString(),
    endTime: null,
    transferredBytes: 0,
    totalBytes,
    errors: [],
    failureInjected: state.migration.failureInjected
  };
  state.target.containers = [];
  state.target.status = 'migrating';
  state.stats.totalMigrations++;
  broadcastState();

  res.json({ success: true, migrationId: migId });

  // Run migration async
  runMigration(migId, containersToMigrate, totalBytes);
});

async function runMigration(migId, containers, totalBytes) {
  try {
    addLog('system', `Migration ${migId} initiated`, null, { containers: containers.length, totalBytes });

    // Phase 1: Pre-flight checks
    addLog('info', 'Running pre-flight environment checks...');
    await sleep(600);
    addLog('success', 'Source environment health: OK');
    await sleep(300);
    addLog('success', 'Target environment connectivity: OK');
    await sleep(300);
    addLog('success', 'Network bandwidth: 1Gbps available');
    await sleep(200);

    state.migration.status = 'migrating';
    state.migration.progress = 5;
    broadcastState();

    // Phase 2: Backup before migration
    addLog('system', 'Creating pre-migration snapshot...');
    await sleep(600);
    const preBackup = {
      id: `bkp-pre-${uuidv4().slice(0, 6)}`,
      label: `Pre-migration snapshot (${migId})`,
      environment: 'source',
      timestamp: new Date().toISOString(),
      containers: JSON.parse(JSON.stringify(state.source.containers)),
      checksum: calcChecksum(state.source.containers),
      size: state.source.containers.reduce((a, c) => a + c.size, 0),
      status: 'ready'
    };
    state.backups.unshift(preBackup);
    addLog('success', `Pre-migration backup created: ${preBackup.id}`);

    // Phase 3: Migrate containers one by one
    let transferred = 0;
    const progressBase = 10;
    const progressRange = 75;

    for (let i = 0; i < containers.length; i++) {
      const container = containers[i];
      state.migration.currentContainer = container.name;

      // Inject failure at 50% progress
      if (state.migration.failureInjected && i === Math.floor(containers.length / 2)) {
        addLog('error', `💥 SIMULATED FAILURE: Network partition during ${container.name} transfer!`, container.name);
        await sleep(500);
        addLog('error', 'Container transfer interrupted. Data integrity at risk.', container.name);
        await sleep(400);

        state.migration.status = 'failed';
        state.migration.errors.push({ container: container.name, error: 'Network partition', time: new Date().toISOString() });
        state.target.status = 'error';
        state.target.health = 45;
        state.stats.failedMigrations++;
        broadcastState();

        // Auto-recovery
        addLog('warn', '🔄 Initiating automatic recovery sequence...');
        await sleep(800);
        state.migration.status = 'recovering';
        broadcastState();

        addLog('info', `Rolling back to pre-migration backup: ${preBackup.id}`);
        await sleep(600);

        for (const c of preBackup.containers) {
          addLog('info', `Restoring: ${c.name}`, c.name);
          await sleep(250);
        }

        state.target.containers = [];
        state.target.status = 'ready';
        state.target.health = 100;
        state.migration.status = 'idle';
        state.migration.failureInjected = false;
        state.migration.endTime = new Date().toISOString();
        addLog('success', '✓ Recovery complete. System restored to pre-migration state.');
        addLog('system', `Migration ${migId} ended: FAILED + RECOVERED`);
        broadcastState();
        return;
      }

      // Normal migration steps
      addLog('info', `[${i + 1}/${containers.length}] Preparing: ${container.name}`, container.name, { size: container.size });
      await sleep(300);

      addLog('info', `Transferring ${container.name} (${container.size}MB)...`, container.name);

      // Simulate chunked transfer with progress updates
      const chunks = 5;
      for (let chunk = 0; chunk < chunks; chunk++) {
        await sleep(180);
        transferred += (container.size * 1024 * 1024) / chunks;
        state.migration.transferredBytes = transferred;
        const overallProgress = progressBase + (progressRange * ((i + (chunk + 1) / chunks) / containers.length));
        state.migration.progress = Math.round(overallProgress);
        broadcastState();
      }

      addLog('success', `✓ ${container.name} transferred successfully`, container.name, { records: container.data.records });
      state.target.containers.push({ ...container, status: 'running' });
      await sleep(150);
    }

    // Phase 4: Validation
    state.migration.status = 'validating';
    state.migration.progress = 88;
    state.migration.currentContainer = null;
    addLog('system', 'Running post-migration data consistency checks...');
    broadcastState();
    await sleep(500);

    const srcChecksum = calcChecksum(state.source.containers);
    const tgtChecksum = calcChecksum(state.target.containers);
    const valid = srcChecksum === tgtChecksum;

    addLog(valid ? 'success' : 'error', `Checksum validation: ${valid ? 'PASSED' : 'FAILED'}`, null, { srcChecksum, tgtChecksum });
    await sleep(400);

    const srcRecords = state.source.containers.reduce((a, c) => a + c.data.records, 0);
    const tgtRecords = state.target.containers.reduce((a, c) => a + c.data.records, 0);
    addLog('success', `Record count: ${srcRecords} → ${tgtRecords} (${srcRecords === tgtRecords ? 'MATCH' : 'MISMATCH'})`);
    await sleep(300);

    state.migration.progress = 95;
    broadcastState();

    // Phase 5: Finalize
    addLog('system', 'Finalizing migration...');
    await sleep(400);
    state.target.status = 'online';
    state.migration.status = 'completed';
    state.migration.progress = 100;
    state.migration.endTime = new Date().toISOString();
    state.stats.successfulMigrations++;
    state.stats.totalDataTransferred += Math.round(totalBytes / 1024 / 1024);

    const duration = ((new Date(state.migration.endTime) - new Date(state.migration.startTime)) / 1000).toFixed(1);
    const prevAvg = state.stats.avgMigrationTime;
    state.stats.avgMigrationTime = prevAvg === 0 ? parseFloat(duration) : ((prevAvg + parseFloat(duration)) / 2).toFixed(1);

    addLog('success', `🎉 Migration ${migId} completed successfully in ${duration}s`, null, {
      containers: containers.length,
      totalMB: Math.round(totalBytes / 1024 / 1024),
      duration
    });
    broadcastState();

  } catch (err) {
    addLog('error', `Unexpected error: ${err.message}`);
    state.migration.status = 'failed';
    state.migration.endTime = new Date().toISOString();
    state.stats.failedMigrations++;
    broadcastState();
  }
}

// ─── Serve React App ────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Migration System running on port ${PORT}`));
