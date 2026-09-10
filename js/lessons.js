/* =========================================================
   LESSON BUILDER
   Paste text -> make sure every word has a Word Bank recording
   -> record the full lesson in the teacher's natural rhythm,
   tapping each word as it's spoken to sync it -> optionally
   trim/cut the recording or re-record any word/sentence/part of
   it -> generate a single standalone HTML file with everything
   embedded.
   ========================================================= */

let currentTokens = [];       // full token list (words + separators), in reading order
let currentWordTokens = [];   // just the word tokens, in order (parallel to timestamps)
let fullRecorder = null;
let fullAudioBlob = null;
let fullAudioBuffer = null;   // decoded, kept in sync with fullAudioBlob after any edit
let lessonWaveform = null;
let fullTimestamps = [];      // ms offset per word token, or null if not tapped
let fullRecordingActive = false;

// Word/sentence "punch-in" re-record state
let editWordsMode = false;
let selAnchor = null;
let selRange = null;          // {start, end} word indices, inclusive
let punchInState = null;

/** Splits raw text into alternating word / separator tokens, keeping
 *  every character so the original text can always be reconstructed
 *  exactly (spacing, punctuation, line breaks — all preserved). */
function tokenizeText(text) {
  const parts = text.match(/[A-Za-z0-9']+|[^A-Za-z0-9']+/g) || [];
  const tokens = [];
  let wordIndex = 0;
  for (const part of parts) {
    if (/[A-Za-z0-9]/.test(part)) {
      tokens.push({ type: 'word', text: part, key: normalizeWordKey(part), index: wordIndex });
      wordIndex++;
    } else {
      tokens.push({ type: 'sep', text: part });
    }
  }
  return tokens;
}

async function analyzeLessonText() {
  const text = document.getElementById('lessonTextInput').value;
  if (!text.trim()) { alert('Paste the lesson text first.'); return; }

  currentTokens = tokenizeText(text);
  currentWordTokens = currentTokens.filter((t) => t.type === 'word');
  fullTimestamps = new Array(currentWordTokens.length).fill(null);
  fullAudioBlob = null;
  fullAudioBuffer = null;
  resetSelection();

  const uniqueKeys = [...new Set(currentWordTokens.map((t) => t.key))];
  const wordBank = await getAllWords();
  const bankMap = new Map(wordBank.map((w) => [w.key, w]));
  const missing = uniqueKeys.filter((k) => !bankMap.has(k) || !bankMap.get(k).audioBlob);

  document.getElementById('lessonStep2').style.display = 'block';
  document.getElementById('lessonStep3').style.display = 'block';
  renderMissingWordsChecklist(missing, currentWordTokens);
  renderFullTextTokens();
  resetFullRecordingUI();
}

/* ---------- Step: make sure every word is in the Word Bank ---------- */

function renderMissingWordsChecklist(missingKeys, wordTokens) {
  const el = document.getElementById('missingWordsList');
  const summary = document.getElementById('missingWordsSummary');
  if (missingKeys.length === 0) {
    summary.textContent = '✓ Every word in this text already has a Word Bank recording.';
    el.innerHTML = '';
    return;
  }
  summary.textContent = `${missingKeys.length} word(s) below don't have a recording yet. Recording them here also saves them to your Word Bank for future lessons.`;
  const displayWord = {};
  wordTokens.forEach((t) => { if (!displayWord[t.key]) displayWord[t.key] = t.text; });

  el.innerHTML = missingKeys.map((key) => `
    <div class="word-row" id="missing-row-${key}">
      <div class="word-row-text"><div class="word-row-word">${escapeHtml(displayWord[key])}</div></div>
      <button class="btn brass small" onclick='openWordEditorNew(${JSON.stringify(displayWord[key])}, onMissingWordSaved)'>🎤 Record</button>
    </div>
  `).join('');
}

function onMissingWordSaved(key) {
  const row = document.getElementById('missing-row-' + key);
  if (row) row.innerHTML = `<div class="word-row-text"><div class="word-row-word">✓ ${escapeHtml(row.textContent.trim())} — saved</div></div>`;
}

/* ---------- Step: record the full lesson, tap-to-sync ---------- */

function renderFullTextTokens() {
  const el = document.getElementById('fullTextDisplay');
  el.innerHTML = currentTokens.map((t) => {
    if (t.type === 'sep') return escapeHtml(t.text);
    return `<span class="tap-word" id="full-word-${t.index}" onclick="onFullTextWordClick(${t.index})">${escapeHtml(t.text)}</span>`;
  }).join('');
}

function onFullTextWordClick(index) {
  if (fullRecordingActive) { markWordTimestamp(index); return; }
  if (editWordsMode) { handleRangeSelectClick(index); return; }
}

function resetFullRecordingUI() {
  document.getElementById('startFullRecBtn').style.display = 'inline-flex';
  document.getElementById('startFullRecBtn').textContent = '🎙 Start Recording';
  document.getElementById('stopFullRecBtn').style.display = 'none';
  document.getElementById('fullRecStatus').textContent = '';
  document.getElementById('generateLessonBtn').disabled = true;
  document.getElementById('lessonEditPanel').style.display = 'none';
  document.querySelectorAll('.tap-word').forEach((s) => s.classList.remove('tapped'));
  resetSelection();
}

async function startFullRecording() {
  try {
    fullRecorder = new AudioRecorder();
    await fullRecorder.start();
    fullRecordingActive = true;
    fullTimestamps = new Array(currentWordTokens.length).fill(null);
    document.querySelectorAll('.tap-word').forEach((s) => s.classList.remove('tapped'));
    document.getElementById('startFullRecBtn').style.display = 'none';
    document.getElementById('stopFullRecBtn').style.display = 'inline-flex';
    document.getElementById('fullRecStatus').textContent = '🔴 Recording… read naturally, and tap each word as you say it.';
    document.getElementById('lessonEditPanel').style.display = 'none';
  } catch (e) {
    alert('Could not access the microphone. Please allow microphone permission for this app.');
  }
}

function markWordTimestamp(index) {
  if (!fullRecordingActive) return;
  fullTimestamps[index] = Math.round(fullRecorder.elapsedMs());
  const span = document.getElementById('full-word-' + index);
  if (span) span.classList.add('tapped');
}

async function stopFullRecording() {
  fullRecordingActive = false;
  fullAudioBlob = await fullRecorder.stop();
  const durationSec = await getAudioDuration(fullAudioBlob);
  interpolateTimestamps(fullTimestamps, durationSec * 1000);
  await finishFullRecordingSetup(durationSec);
}

async function finishFullRecordingSetup(durationSec) {
  const syncedCount = fullTimestamps.filter((t) => t !== null).length;
  document.getElementById('startFullRecBtn').style.display = 'inline-flex';
  document.getElementById('startFullRecBtn').textContent = '🎙 Re-record Everything';
  document.getElementById('stopFullRecBtn').style.display = 'none';
  document.getElementById('fullRecStatus').textContent =
    `✓ Recorded (${durationSec.toFixed(0)}s). ${syncedCount}/${currentWordTokens.length} words tapped precisely — the rest were estimated automatically.`;
  document.getElementById('generateLessonBtn').disabled = false;

  try {
    fullAudioBuffer = await blobToAudioBuffer(fullAudioBlob);
    document.getElementById('lessonEditPanel').style.display = 'block';
    lessonWaveform = createWaveformEditor(document.getElementById('lessonWaveform'), fullAudioBuffer);
  } catch (e) {
    document.getElementById('lessonEditPanel').style.display = 'none';
  }
}

/** Fills in any word that wasn't tapped during recording by interpolating
 *  between its nearest tapped neighbours (or spacing evenly across the
 *  whole clip if nothing at all was tapped), so tap-to-jump / punch-in
 *  splicing always has a timestamp to work with for every word. */
function interpolateTimestamps(timestamps, totalDurationMs) {
  const n = timestamps.length;
  if (n === 0) return;
  const known = [];
  timestamps.forEach((t, i) => { if (t !== null) known.push(i); });

  if (known.length === 0) {
    for (let i = 0; i < n; i++) timestamps[i] = Math.round((i / n) * totalDurationMs);
    return;
  }
  const first = known[0];
  for (let i = 0; i < first; i++) timestamps[i] = Math.round((timestamps[first] * i) / (first + 1));

  for (let k = 0; k < known.length - 1; k++) {
    const a = known[k], b = known[k + 1];
    for (let i = a + 1; i < b; i++) {
      const frac = (i - a) / (b - a);
      timestamps[i] = Math.round(timestamps[a] + frac * (timestamps[b] - timestamps[a]));
    }
  }
  const last = known[known.length - 1];
  for (let i = last + 1; i < n; i++) {
    const frac = (i - last) / (n - last);
    timestamps[i] = Math.round(timestamps[last] + frac * (totalDurationMs - timestamps[last]));
  }
}

/* =========================================================
   EDIT PANEL — waveform trim/cut + word/sentence punch-in
   ========================================================= */

function playLessonSelection() {
  if (!fullAudioBuffer || !lessonWaveform) return;
  const sel = lessonWaveform.getSelection();
  playBufferRange(fullAudioBuffer, sel.start, sel.end);
}

function playLessonAll() {
  if (!fullAudioBuffer) return;
  playBufferRange(fullAudioBuffer, 0, bufferDuration(fullAudioBuffer));
}

/** Keeps only the selected time range — for trimming dead air off the
 *  start/end (select the good middle part, then Trim). */
async function trimLessonToSelection() {
  if (!fullAudioBuffer || !lessonWaveform) return;
  const sel = lessonWaveform.getSelection();
  if (sel.end - sel.start < 0.1) { alert('Select a wider range first.'); return; }
  if (!confirm('Keep only the selected part and remove everything outside it?')) return;

  const startMs = sel.start * 1000, endMs = sel.end * 1000;
  fullAudioBuffer = sliceBuffer(fullAudioBuffer, sel.start, sel.end);
  const newDurationMs = bufferDuration(fullAudioBuffer) * 1000;
  fullTimestamps = fullTimestamps.map((t) => Math.max(0, Math.min(newDurationMs, t - startMs)));
  await finishLessonEdit();
}

/** Removes just the selected time range (e.g. a cough, mistake, or long
 *  pause in the middle) and joins the rest back together seamlessly. */
async function removeLessonSelection() {
  if (!fullAudioBuffer || !lessonWaveform) return;
  const sel = lessonWaveform.getSelection();
  if (sel.end - sel.start < 0.05) { alert('Select the part you want to remove first.'); return; }
  if (!confirm('Remove the selected part of the recording? The rest will be joined together.')) return;

  const startMs = sel.start * 1000, endMs = sel.end * 1000, cutMs = endMs - startMs;
  const before = sliceBuffer(fullAudioBuffer, 0, sel.start);
  const after = sliceBuffer(fullAudioBuffer, sel.end, bufferDuration(fullAudioBuffer));
  fullAudioBuffer = concatBuffers([before, after]);
  fullTimestamps = fullTimestamps.map((t) => {
    if (t < startMs) return t;
    if (t <= endMs) return startMs;
    return t - cutMs;
  });
  await finishLessonEdit();
}

async function finishLessonEdit() {
  fullAudioBlob = bufferToWavBlob(fullAudioBuffer);
  lessonWaveform = createWaveformEditor(document.getElementById('lessonWaveform'), fullAudioBuffer);
  renderFullTextTokens();
  document.getElementById('fullRecStatus').textContent = '✓ Edited — remember to Generate the lesson file again to update it.';
  resetSelection();
  scheduleAutoBackup();
}

/* ---------- Selecting a word/sentence range to re-record ---------- */

function toggleEditWordsMode() {
  editWordsMode = !editWordsMode;
  document.getElementById('editWordsBtn').textContent = editWordsMode ? '✓ Done Selecting' : '✏️ Select Words to Re-record';
  document.getElementById('editWordsHint').style.display = editWordsMode ? 'block' : 'none';
  if (!editWordsMode) resetSelection();
}

function resetSelection() {
  selAnchor = null;
  selRange = null;
  document.querySelectorAll('.tap-word').forEach((s) => s.classList.remove('sel-range', 'sel-edge'));
  const toolbar = document.getElementById('selectionToolbar');
  if (toolbar) toolbar.style.display = 'none';
  const panel = document.getElementById('punchInPanel');
  if (panel) panel.style.display = 'none';
}

function handleRangeSelectClick(index) {
  if (selAnchor === null) selAnchor = index;
  selRange = { start: Math.min(selAnchor, index), end: Math.max(selAnchor, index) };
  document.querySelectorAll('.tap-word').forEach((s) => s.classList.remove('sel-range', 'sel-edge'));
  for (let i = selRange.start; i <= selRange.end; i++) {
    const span = document.getElementById('full-word-' + i);
    if (span) span.classList.add(i === selRange.start || i === selRange.end ? 'sel-edge' : 'sel-range');
  }
  const count = selRange.end - selRange.start + 1;
  const words = currentWordTokens.slice(selRange.start, selRange.end + 1).map((t) => t.text).join(' ');
  document.getElementById('selectionSummary').textContent = `${count} word(s) selected: "${words}"`;
  document.getElementById('selectionToolbar').style.display = 'block';
}

/* ---------- Punch-in: re-record just the selected words ---------- */

function openPunchInPanel() {
  if (!selRange) return;
  punchInState = { recorder: null, blob: null, buffer: null, waveform: null, timestamps: new Array(selRange.end - selRange.start + 1).fill(null) };
  const words = currentWordTokens.slice(selRange.start, selRange.end + 1);
  document.getElementById('punchInText').innerHTML = words.map((t) =>
    `<span class="tap-word" id="punch-word-${t.index - selRange.start}" onclick="markPunchInTimestamp(${t.index - selRange.start})">${escapeHtml(t.text)}</span>`
  ).join(' ');
  document.getElementById('punchInStartBtn').style.display = 'inline-flex';
  document.getElementById('punchInStopBtn').style.display = 'none';
  document.getElementById('punchInStatus').textContent = 'Tap Start, say just this part, tapping each word as you go.';
  document.getElementById('punchInWaveformWrap').style.display = 'none';
  document.getElementById('punchInInsertBtn').disabled = true;
  document.getElementById('punchInPanel').style.display = 'block';
}

async function startPunchInRecording() {
  try {
    punchInState.recorder = new AudioRecorder();
    await punchInState.recorder.start();
    punchInState.timestamps = new Array(selRange.end - selRange.start + 1).fill(null);
    document.querySelectorAll('#punchInText .tap-word').forEach((s) => s.classList.remove('tapped'));
    document.getElementById('punchInStartBtn').style.display = 'none';
    document.getElementById('punchInStopBtn').style.display = 'inline-flex';
    document.getElementById('punchInStatus').textContent = '🔴 Recording this part…';
  } catch (e) {
    alert('Could not access the microphone.');
  }
}

function markPunchInTimestamp(relIndex) {
  if (!punchInState.recorder) return;
  punchInState.timestamps[relIndex] = Math.round(punchInState.recorder.elapsedMs());
  const span = document.getElementById('punch-word-' + relIndex);
  if (span) span.classList.add('tapped');
}

async function stopPunchInRecording() {
  punchInState.blob = await punchInState.recorder.stop();
  const durationSec = await getAudioDuration(punchInState.blob);
  interpolateTimestamps(punchInState.timestamps, durationSec * 1000);
  punchInState.buffer = await blobToAudioBuffer(punchInState.blob);

  document.getElementById('punchInStartBtn').style.display = 'inline-flex';
  document.getElementById('punchInStartBtn').textContent = '🎙 Re-record This Part Again';
  document.getElementById('punchInStopBtn').style.display = 'none';
  document.getElementById('punchInStatus').textContent = `✓ Recorded (${durationSec.toFixed(1)}s). Trim if needed, then Insert.`;
  document.getElementById('punchInWaveformWrap').style.display = 'block';
  punchInState.waveform = createWaveformEditor(document.getElementById('punchInWaveform'), punchInState.buffer);
  document.getElementById('punchInInsertBtn').disabled = false;
}

function previewPunchIn() {
  if (!punchInState.buffer) return;
  const sel = punchInState.waveform ? punchInState.waveform.getSelection() : { start: 0, end: bufferDuration(punchInState.buffer) };
  playBufferRange(punchInState.buffer, sel.start, sel.end);
}

function trimPunchIn() {
  if (!punchInState.buffer || !punchInState.waveform) return;
  const sel = punchInState.waveform.getSelection();
  if (sel.end - sel.start < 0.05) { alert('Selection too short.'); return; }
  const oldDurationMs = bufferDuration(punchInState.buffer) * 1000;
  punchInState.buffer = sliceBuffer(punchInState.buffer, sel.start, sel.end);
  const newDurationMs = bufferDuration(punchInState.buffer) * 1000;
  const startMs = sel.start * 1000;
  punchInState.timestamps = punchInState.timestamps.map((t) => Math.max(0, Math.min(newDurationMs, t - startMs)));
  punchInState.waveform = createWaveformEditor(document.getElementById('punchInWaveform'), punchInState.buffer);
}

function cancelPunchIn() {
  if (punchInState && punchInState.recorder) { try { punchInState.recorder.cancel(); } catch (e) {} }
  document.getElementById('punchInPanel').style.display = 'none';
}

/** Splices the punch-in recording into the full lesson audio at exactly
 *  the position of the selected words, and shifts every timestamp after
 *  it to account for the new segment possibly being a different length. */
async function insertPunchIn() {
  const oldStartMs = selRange.start === 0 ? 0 : fullTimestamps[selRange.start];
  const oldEndMs = selRange.end === currentWordTokens.length - 1
    ? bufferDuration(fullAudioBuffer) * 1000
    : fullTimestamps[selRange.end + 1];

  const before = sliceBuffer(fullAudioBuffer, 0, oldStartMs / 1000);
  const after = sliceBuffer(fullAudioBuffer, oldEndMs / 1000, bufferDuration(fullAudioBuffer));
  const middle = punchInState.buffer;
  fullAudioBuffer = concatBuffers([before, middle, after]);

  const newMiddleDurationMs = bufferDuration(middle) * 1000;
  const deltaMs = newMiddleDurationMs - (oldEndMs - oldStartMs);

  const newTimestamps = fullTimestamps.slice();
  for (let i = selRange.start; i <= selRange.end; i++) {
    newTimestamps[i] = Math.round(oldStartMs + punchInState.timestamps[i - selRange.start]);
  }
  for (let i = selRange.end + 1; i < newTimestamps.length; i++) {
    newTimestamps[i] = Math.round(newTimestamps[i] + deltaMs);
  }
  fullTimestamps = newTimestamps;
  fullAudioBlob = bufferToWavBlob(fullAudioBuffer);

  document.getElementById('punchInPanel').style.display = 'none';
  editWordsMode = false;
  document.getElementById('editWordsBtn').textContent = '✏️ Select Words to Re-record';
  document.getElementById('editWordsHint').style.display = 'none';
  resetSelection();
  lessonWaveform = createWaveformEditor(document.getElementById('lessonWaveform'), fullAudioBuffer);
  renderFullTextTokens();
  document.getElementById('fullRecStatus').textContent = '✓ That part was re-recorded and spliced in. Generate the lesson file again to update it.';
  scheduleAutoBackup();
}

function previewFullRecording() { playLessonAll(); }

/* ---------- Save lesson + generate the standalone file ---------- */

async function generateLesson() {
  if (!fullAudioBlob) { alert('Record the full lesson audio first.'); return; }
  const text = document.getElementById('lessonTextInput').value;
  let title = document.getElementById('lessonTitleInput').value.trim();
  if (!title) title = 'Lesson - ' + new Date().toLocaleDateString('en-IN');

  const lesson = {
    id: uid(),
    title,
    text,
    tokens: currentTokens,
    timestamps: fullTimestamps,
    fullAudioBlob,
    createdAt: new Date().toISOString()
  };
  await dbPut('lessons', lesson);
  scheduleAutoBackup();

  document.getElementById('generateLessonBtn').disabled = true;
  document.getElementById('generateLessonBtn').textContent = 'Building file…';
  try {
    await downloadLessonFile(lesson);
  } finally {
    document.getElementById('generateLessonBtn').disabled = false;
    document.getElementById('generateLessonBtn').textContent = '📦 Generate Lesson File';
  }

  renderLessonsList();
  alert('Lesson saved and file downloaded! Share it via WhatsApp from your Downloads/Files app.');
}

/* ---------- My Lessons tab ---------- */

async function getAllLessons() {
  const lessons = await dbGetAll('lessons');
  lessons.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return lessons;
}

async function renderLessonsList() {
  const el = document.getElementById('lessonsList');
  if (!el) return;
  const lessons = await getAllLessons();
  if (lessons.length === 0) {
    el.innerHTML = '<p class="hint">No lessons yet — create one in the "Create Lesson" tab.</p>';
    return;
  }
  el.innerHTML = lessons.map((l) => {
    const wordCount = l.tokens.filter((t) => t.type === 'word').length;
    const dateStr = new Date(l.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return `
      <div class="card lesson-card">
        <h4>${escapeHtml(l.title)}</h4>
        <p class="hint">${dateStr} · ${wordCount} words</p>
        <div class="btn-row">
          <button class="btn brass small" onclick="redownloadLesson('${l.id}')">⬇ Download File</button>
          <button class="btn ghost small" onclick="previewLesson('${l.id}')">👁 Preview</button>
          <button class="btn rust small" onclick="deleteLesson('${l.id}')">🗑 Delete</button>
        </div>
      </div>`;
  }).join('');
}

async function redownloadLesson(id) {
  const lesson = await dbGet('lessons', id);
  if (lesson) await downloadLessonFile(lesson);
}

async function previewLesson(id) {
  const lesson = await dbGet('lessons', id);
  if (!lesson) return;
  const html = await buildLessonHtml(lesson);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

async function deleteLesson(id) {
  if (!confirm('Delete this lesson? This cannot be undone.')) return;
  await dbDelete('lessons', id);
  scheduleAutoBackup();
  renderLessonsList();
}
