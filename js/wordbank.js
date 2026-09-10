/* =========================================================
   WORD BANK
   Individual words, each with its own short pronunciation
   recording and a typed meaning, reused across every lesson.
   All recording now goes through one shared editor modal that
   supports trimming the clip before saving — used both from the
   Word Bank tab and from the "missing words" step while building
   a lesson.
   ========================================================= */

function normalizeWordKey(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9']/g, '');
}

async function getAllWords() {
  const words = await dbGetAll('words');
  words.sort((a, b) => a.word.localeCompare(b.word));
  return words;
}

async function saveWord(key, word, meaning, audioBlob) {
  const existing = await dbGet('words', key);
  const entry = {
    key,
    word,
    meaning: meaning || (existing ? existing.meaning : ''),
    audioBlob: audioBlob !== undefined ? audioBlob : (existing ? existing.audioBlob : null),
    updatedAt: new Date().toISOString()
  };
  await dbPut('words', entry);
  scheduleAutoBackup();
  return entry;
}

async function deleteWord(key) {
  if (!confirm('Delete this word from the Word Bank? Lessons already generated with it keep working, but new lessons will need it re-recorded.')) return;
  await dbDelete('words', key);
  scheduleAutoBackup();
  renderWordBankList();
}

function playAudioBlob(blob) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play();
  audio.onended = () => URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Word Bank list UI ---------- */

async function renderWordBankList(filter) {
  const listEl = document.getElementById('wordBankList');
  if (!listEl) return;
  let words = await getAllWords();
  if (filter) {
    const f = filter.toLowerCase();
    words = words.filter((w) => w.word.toLowerCase().includes(f));
  }
  if (words.length === 0) {
    listEl.innerHTML = '<p class="hint">No words yet — tap "Record a Word" above.</p>';
    return;
  }
  listEl.innerHTML = words.map((w) => `
    <div class="word-row">
      <button class="btn ghost small" onclick='playWordFromBank(${JSON.stringify(w.key)})' ${w.audioBlob ? '' : 'disabled'}>🔊</button>
      <div class="word-row-text">
        <div class="word-row-word">${escapeHtml(w.word)}</div>
        <div class="word-row-meaning">${escapeHtml(w.meaning || 'No meaning added')}</div>
      </div>
      <button class="btn ghost small" onclick='openWordEditorExisting(${JSON.stringify(w.key)})'>✂ Edit</button>
      <button class="btn rust small" onclick='deleteWord(${JSON.stringify(w.key)})'>🗑</button>
    </div>
  `).join('');
}

async function playWordFromBank(key) {
  const w = await dbGet('words', key);
  if (w && w.audioBlob) playAudioBlob(w.audioBlob);
}

/* =========================================================
   WORD EDITOR MODAL — shared by "Record a New Word" (Word Bank
   tab) and "record this missing word" (Create Lesson tab).
   Supports: record, preview, trim (via waveform), and re-record.
   ========================================================= */

let weState = {
  mode: 'new',        // 'new' | 'edit'
  key: null,
  audioBlob: null,
  audioBuffer: null,
  waveform: null,
  recorder: null,
  onSaved: null
};

function openWordEditorNew(prefillWord, onSaved) {
  weState = { mode: 'new', key: null, audioBlob: null, audioBuffer: null, waveform: null, recorder: null, onSaved: onSaved || null };
  document.getElementById('weTitle').textContent = 'Record a Word';
  document.getElementById('weWordInput').value = prefillWord || '';
  document.getElementById('weWordInput').disabled = false;
  document.getElementById('weMeaningInput').value = '';
  weResetPanel();
  document.getElementById('wordEditorModal').classList.add('open');
}

async function openWordEditorExisting(key) {
  const w = await dbGet('words', key);
  if (!w) return;
  weState = { mode: 'edit', key, audioBlob: w.audioBlob || null, audioBuffer: null, waveform: null, recorder: null, onSaved: null };
  document.getElementById('weTitle').textContent = 'Edit Word';
  document.getElementById('weWordInput').value = w.word;
  document.getElementById('weWordInput').disabled = true;
  document.getElementById('weMeaningInput').value = w.meaning || '';
  weResetPanel();
  if (weState.audioBlob) await weLoadWaveformFromBlob(weState.audioBlob);
  document.getElementById('wordEditorModal').classList.add('open');
}

function closeWordEditor() {
  if (weState.recorder) { try { weState.recorder.cancel(); } catch (e) {} }
  document.getElementById('wordEditorModal').classList.remove('open');
}

function weResetPanel() {
  document.getElementById('weRecordBtn').style.display = 'inline-flex';
  document.getElementById('weStopBtn').style.display = 'none';
  document.getElementById('weStatus').textContent = '';
  document.getElementById('weWaveformWrap').style.display = 'none';
  document.getElementById('weWaveform').innerHTML = '';
}

async function weStartRecord() {
  try {
    weState.recorder = new AudioRecorder();
    await weState.recorder.start();
    document.getElementById('weRecordBtn').style.display = 'none';
    document.getElementById('weStopBtn').style.display = 'inline-flex';
    document.getElementById('weStatus').textContent = '🔴 Recording…';
  } catch (e) {
    alert('Could not access the microphone.');
  }
}

async function weStopRecord() {
  const blob = await weState.recorder.stop();
  weState.audioBlob = blob;
  document.getElementById('weRecordBtn').style.display = 'inline-flex';
  document.getElementById('weRecordBtn').textContent = '🎤 Re-record';
  document.getElementById('weStopBtn').style.display = 'none';
  document.getElementById('weStatus').textContent = '✓ Recorded — trim if needed, then Save.';
  await weLoadWaveformFromBlob(blob);
}

async function weLoadWaveformFromBlob(blob) {
  try {
    weState.audioBuffer = await blobToAudioBuffer(blob);
  } catch (e) {
    document.getElementById('weStatus').textContent = '✓ Recorded (preview/trim unavailable for this format).';
    return;
  }
  document.getElementById('weWaveformWrap').style.display = 'block';
  const container = document.getElementById('weWaveform');
  weState.waveform = createWaveformEditor(container, weState.audioBuffer);
}

function wePreviewSelection() {
  if (!weState.audioBuffer) { playAudioBlob(weState.audioBlob); return; }
  const sel = weState.waveform ? weState.waveform.getSelection() : { start: 0, end: bufferDuration(weState.audioBuffer) };
  playBufferRange(weState.audioBuffer, sel.start, sel.end);
}

function weApplyTrim() {
  if (!weState.waveform || !weState.audioBuffer) return;
  const sel = weState.waveform.getSelection();
  if (sel.end - sel.start < 0.05) { alert('Selection is too short.'); return; }
  weState.audioBuffer = sliceBuffer(weState.audioBuffer, sel.start, sel.end);
  const container = document.getElementById('weWaveform');
  weState.waveform = createWaveformEditor(container, weState.audioBuffer);
  document.getElementById('weStatus').textContent = '✓ Trimmed — Save to keep this, or trim again.';
}

async function weSave() {
  const word = document.getElementById('weWordInput').value.trim();
  const meaning = document.getElementById('weMeaningInput').value.trim();
  if (!word) { alert('Type the word first.'); return; }
  if (!weState.audioBlob && !meaning) { alert('Record audio or add a meaning first.'); return; }

  let finalBlob = weState.audioBlob;
  if (weState.audioBuffer) finalBlob = bufferToWavBlob(weState.audioBuffer); // trimmed (or loaded) buffer is authoritative

  const key = weState.mode === 'edit' ? weState.key : normalizeWordKey(word);
  if (!key) { alert('Please enter a valid word.'); return; }

  await saveWord(key, word, meaning, finalBlob);
  closeWordEditor();
  renderWordBankList(document.getElementById('wordBankSearch') ? document.getElementById('wordBankSearch').value : '');
  if (weState.onSaved) weState.onSaved(key);
}
