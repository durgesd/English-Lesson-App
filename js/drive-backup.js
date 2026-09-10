/* =========================================================
   BACKUP: Local file export/import, on-device safety snapshots,
   and Google Drive (manual + automatic).

   Three layers, each independent of the others:
   1. Local snapshot (instant, on this device, no internet needed) —
      saved automatically after every change and app close.
   2. Manual "Export Backup" file — a .json you can keep anywhere
      (email it to yourself, save to a USB drive, etc).
   3. Google Drive — optional, needs a one-time setup, then backs
      up automatically in the background too.
   ========================================================= */

let SETTINGS = { driveClientId: '', driveAutoBackupEnabled: false, driveAccountEmail: '', driveLastBackupDate: '' };

async function loadSettings() {
  const s = await dbGet('settings', 'main');
  if (s) SETTINGS = { ...SETTINGS, ...s, key: 'main' };
}

async function saveSettingsToDb() {
  await dbPut('settings', { ...SETTINGS, key: 'main' });
}

/* ---------- Build / apply a full backup payload ---------- */

async function buildBackupData() {
  const words = await dbGetAll('words');
  const lessons = await dbGetAll('lessons');
  return {
    words: await Promise.all(words.map(async (w) => ({
      key: w.key, word: w.word, meaning: w.meaning, updatedAt: w.updatedAt,
      audio: w.audioBlob ? await blobToBase64(w.audioBlob) : null
    }))),
    lessons: await Promise.all(lessons.map(async (l) => ({
      id: l.id, title: l.title, text: l.text, tokens: l.tokens,
      timestamps: l.timestamps, createdAt: l.createdAt,
      fullAudio: l.fullAudioBlob ? await blobToBase64(l.fullAudioBlob) : null
    }))),
    settings: SETTINGS,
    exportedAt: new Date().toISOString()
  };
}

async function applyBackupData(data) {
  for (const w of (data.words || [])) {
    await dbPut('words', {
      key: w.key, word: w.word, meaning: w.meaning, updatedAt: w.updatedAt,
      audioBlob: w.audio ? await base64ToBlob(w.audio) : null
    });
  }
  for (const l of (data.lessons || [])) {
    await dbPut('lessons', {
      id: l.id, title: l.title, text: l.text, tokens: l.tokens,
      timestamps: l.timestamps, createdAt: l.createdAt,
      fullAudioBlob: l.fullAudio ? await base64ToBlob(l.fullAudio) : null
    });
  }
  if (data.settings) {
    SETTINGS = { ...SETTINGS, ...data.settings, key: 'main' };
    await saveSettingsToDb();
  }
}

/* ---------- Manual file export / import ---------- */

async function exportBackupFile() {
  const data = await buildBackupData();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'english-lesson-app-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importBackupFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!confirm('This will add all words and lessons from the backup file. Continue?')) return;
    await applyBackupData(data);
    alert('Backup restored successfully.');
    renderWordBankList();
    renderLessonsList();
  } catch (err) {
    alert('Could not read this backup file.');
  }
  e.target.value = '';
}

/* ---------- Local safety snapshots ---------- */

const LOCAL_SNAPSHOT_LIMIT = 10;

async function saveLocalSnapshot() {
  try {
    const data = await buildBackupData();
    const id = new Date().toISOString();
    await dbPut('localSnapshots', { id, data });
    const all = await dbGetAll('localSnapshots');
    all.sort((a, b) => (a.id < b.id ? 1 : -1));
    for (const snap of all.slice(LOCAL_SNAPSHOT_LIMIT)) await dbDelete('localSnapshots', snap.id);
    return true;
  } catch (e) {
    return false;
  }
}

async function getLocalSnapshots() {
  const all = await dbGetAll('localSnapshots');
  all.sort((a, b) => (a.id < b.id ? 1 : -1));
  return all;
}

async function restoreLocalSnapshot(id) {
  if (!confirm('Restore this snapshot? This adds back all words and lessons exactly as they were at that time.')) return;
  const snap = await dbGet('localSnapshots', id);
  if (!snap) { alert('That snapshot is no longer available.'); return; }
  await applyBackupData(snap.data);
  alert('Snapshot restored successfully.');
  renderWordBankList();
  renderLessonsList();
}

async function renderLocalSnapshotsList() {
  const el = document.getElementById('localSnapshotsList');
  if (!el) return;
  const snaps = await getLocalSnapshots();
  if (snaps.length === 0) {
    el.innerHTML = '<p class="hint">No local snapshots yet — one is saved automatically as you work.</p>';
    return;
  }
  el.innerHTML = snaps.map((s) => {
    const d = new Date(s.id);
    const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' · ' +
                  d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `<div class="word-row"><span>${label}</span><button class="btn ghost small" onclick="restoreLocalSnapshot('${s.id}')">↺ Restore</button></div>`;
  }).join('');
}

/* Called after every meaningful change — saves a local snapshot instantly
   (always, no setup needed) and debounces a Google Drive push if that's
   configured. */
let driveDebounceTimer = null;
function scheduleAutoBackup() {
  saveLocalSnapshot();
  if (!SETTINGS.driveClientId || !SETTINGS.driveAutoBackupEnabled) return;
  clearTimeout(driveDebounceTimer);
  driveDebounceTimer = setTimeout(runDriveBackupSilently, 4000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    saveLocalSnapshot();
    runDriveBackupSilently();
  }
});
window.addEventListener('pagehide', () => {
  saveLocalSnapshot();
  runDriveBackupSilently();
});

/* ---------- Google Drive ---------- */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const DRIVE_FOLDER_NAME = 'English Lesson App Backups';
const DRIVE_KEEP_COUNT = 5; // audio makes files bigger, so keep a small rolling window

let driveTokenClient = null;
let driveAccessToken = null;

function initDriveTokenClient() {
  if (!window.google || !SETTINGS.driveClientId) return;
  try {
    driveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: SETTINGS.driveClientId,
      scope: DRIVE_SCOPE,
      hint: SETTINGS.driveAccountEmail || undefined,
      callback: () => {}
    });
  } catch (e) {
    driveTokenClient = null;
  }
}

function requestDriveToken(interactive) {
  return new Promise((resolve, reject) => {
    if (!driveTokenClient) { reject(new Error('Drive not set up')); return; }
    driveTokenClient.callback = async (resp) => {
      if (resp && resp.access_token) {
        driveAccessToken = resp.access_token;
        await rememberDriveAccountEmail();
        resolve(resp.access_token);
      } else {
        reject(new Error('No token'));
      }
    };
    driveTokenClient.error_callback = (err) => reject(err);
    driveTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

async function rememberDriveAccountEmail() {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + driveAccessToken }
    });
    const info = await res.json();
    if (info.email) {
      SETTINGS.driveAccountEmail = info.email;
      await saveSettingsToDb();
    }
  } catch (e) {}
}

async function driveApiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: 'Bearer ' + driveAccessToken }
  });
}

async function findOrCreateBackupFolder() {
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await driveApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  const createRes = await driveApiFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  });
  const created = await createRes.json();
  return created.id;
}

async function uploadBackupToDrive(folderId) {
  const data = await buildBackupData();
  const filename = 'lesson-app-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  const boundary = '-------englishlessonbackup';
  const metadata = { name: filename, parents: [folderId] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;

  await driveApiFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
}

async function deleteOldBackupsFromDrive(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc`);
  const data = await res.json();
  const files = data.files || [];
  for (const f of files.slice(DRIVE_KEEP_COUNT)) {
    await driveApiFetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' });
  }
}

async function runDriveBackupNow() {
  const statusEl = document.getElementById('driveStatus');
  try {
    if (!driveTokenClient) initDriveTokenClient();
    await requestDriveToken(true);
    if (statusEl) statusEl.textContent = 'Backing up…';
    const folderId = await findOrCreateBackupFolder();
    await uploadBackupToDrive(folderId);
    await deleteOldBackupsFromDrive(folderId);
    SETTINGS.driveLastBackupDate = new Date().toISOString();
    await saveSettingsToDb();
    updateDriveStatusUI();
  } catch (e) {
    if (statusEl) statusEl.textContent = '⚠️ Backup failed — try Connect again.';
  }
}

async function runDriveBackupSilently() {
  if (!SETTINGS.driveClientId || !SETTINGS.driveAutoBackupEnabled) return;
  if (!window.google) return;
  if (!driveTokenClient) initDriveTokenClient();
  try {
    await requestDriveToken(false); // silent only — never interrupts the user
    const folderId = await findOrCreateBackupFolder();
    await uploadBackupToDrive(folderId);
    await deleteOldBackupsFromDrive(folderId);
    SETTINGS.driveLastBackupDate = new Date().toISOString();
    await saveSettingsToDb();
    updateDriveStatusUI();
  } catch (e) {
    // silent failure is fine — the next change or app-close will try again
  }
}

async function runAutoBackupIfNeeded() {
  if (!SETTINGS.driveClientId || !SETTINGS.driveAutoBackupEnabled) return;
  if (!window.google) return;
  await runDriveBackupSilently();
}

async function connectGoogleDrive() {
  if (!SETTINGS.driveClientId) { alert('Enter your Google OAuth Client ID first.'); return; }
  initDriveTokenClient();
  await runDriveBackupNow();
}

async function disconnectGoogleDrive() {
  if (!confirm('Disconnect Google Drive? Automatic backups will stop until you reconnect.')) return;
  SETTINGS.driveAutoBackupEnabled = false;
  SETTINGS.driveAccountEmail = '';
  driveAccessToken = null;
  await saveSettingsToDb();
  updateDriveStatusUI();
}

async function saveDriveClientId() {
  SETTINGS.driveClientId = document.getElementById('driveClientId').value.trim();
  await saveSettingsToDb();
  initDriveTokenClient();
  updateDriveStatusUI();
  alert('Client ID saved.');
}

async function toggleDriveAutoBackup() {
  SETTINGS.driveAutoBackupEnabled = document.getElementById('driveAutoBackupToggle').checked;
  await saveSettingsToDb();
}

function updateDriveStatusUI() {
  const statusEl = document.getElementById('driveStatus');
  const connectBtn = document.getElementById('driveConnectBtn');
  const backupNowBtn = document.getElementById('driveBackupNowBtn');
  const disconnectBtn = document.getElementById('driveDisconnectBtn');
  const autoToggle = document.getElementById('driveAutoBackupToggle');
  if (!statusEl) return;

  autoToggle.checked = !!SETTINGS.driveAutoBackupEnabled;
  const lastBackupLabel = SETTINGS.driveLastBackupDate
    ? new Date(SETTINGS.driveLastBackupDate).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'never yet';

  if (SETTINGS.driveAccountEmail) {
    statusEl.textContent = '✓ Connected (' + SETTINGS.driveAccountEmail + ') · Last backup: ' + lastBackupLabel;
    connectBtn.style.display = 'none';
    backupNowBtn.style.display = 'inline-flex';
    disconnectBtn.style.display = 'inline-flex';
  } else {
    statusEl.textContent = SETTINGS.driveLastBackupDate
      ? 'Last backup: ' + lastBackupLabel + ' · Tap Connect to reconnect.'
      : 'Not connected yet.';
    connectBtn.style.display = SETTINGS.driveClientId ? 'inline-flex' : 'none';
    backupNowBtn.style.display = 'none';
    disconnectBtn.style.display = 'none';
  }
}
