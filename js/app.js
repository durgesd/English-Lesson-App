/* =========================================================
   APP SHELL
   ========================================================= */
const APP_BUILD_VERSION = '2026-09-10-1';

function showTab(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');

  if (name === 'wordbank') renderWordBankList();
  if (name === 'mylessons') renderLessonsList();
  if (name === 'settings') { updateDriveStatusUI(); renderLocalSnapshotsList(); }
}

(async function init() {
  db = await openDB();
  await loadSettings();
  requestPersistentStorage();

  document.getElementById('driveClientId').value = SETTINGS.driveClientId || '';
  if (SETTINGS.driveClientId && window.google) initDriveTokenClient();
  updateDriveStatusUI();
  setTimeout(runAutoBackupIfNeeded, 1500); // small delay so Google's script has time to load
  saveLocalSnapshot(); // baseline snapshot as soon as the app opens

  renderWordBankList();

  if ('serviceWorker' in navigator) {
    const hadControllerAtLoad = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('service-worker.js?v=' + APP_BUILD_VERSION).then((registration) => {
      registration.update();
    }).catch(() => {});
    let notifiedOnce = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (notifiedOnce || !hadControllerAtLoad) return;
      notifiedOnce = true;
      document.getElementById('updateBanner').style.display = 'block';
    });
  }
})();

async function safeReloadForUpdate() {
  const banner = document.getElementById('updateBanner');
  if (banner) {
    banner.onclick = null;
    banner.style.cursor = 'default';
    banner.textContent = '🔄 Backing up your data, then refreshing…';
  }
  try { await saveLocalSnapshot(); } catch (e) {}
  try {
    if (SETTINGS.driveClientId && SETTINGS.driveAutoBackupEnabled) {
      await Promise.race([runDriveBackupSilently(), new Promise((r) => setTimeout(r, 4000))]);
    }
  } catch (e) {}
  window.location.reload();
}
