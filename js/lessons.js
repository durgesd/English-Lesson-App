/* =========================================================
   LESSON BUILDER
   Paste text -> make sure every word has a Word Bank recording
   -> record the full lesson in the teacher's natural rhythm,
   tapping each word as it's spoken to sync it -> generate a
   single standalone HTML file with everything embedded.
   ========================================================= */

let currentTokens = [];       // full token list (words + separators), in reading order
let currentWordTokens = [];   // just the word tokens, in order (parallel to timestamps)
let fullRecorder = null;
let fullAudioBlob = null;
let fullTimestamps = [];      // ms offset per word token, or null if not tapped
let fullRecordingActive = false;
let pendingWordAudio = {};    // key -> blob, for words being recorded inline during lesson creation
let activeMiniRecorderKey = null;

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
  pendingWordAudio = {};

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
  // Use the first original-cased spelling found in the text for each key.
  const displayWord = {};
  wordTokens.forEach((t) => { if (!displayWord[t.key]) displayWord[t.key] = t.text; });

  el.innerHTML = missingKeys.map((key) => `
    <div class="word-row" id="missing-row-${key}">
      <button class="btn brass small" id="rec-btn-${key}" onclick="toggleMiniRecord('${key}')">🎤 Record</button>
      <div class="word-row-text">
        <div class="word-row-word">${escapeHtml(displayWord[key])}</div>
        <input type="text" placeholder="Meaning (optional)" id="meaning-${key}" style="margin-top:4px;">
      </div>
      <button class="btn ghost small" id="preview-btn-${key}" onclick="previewMiniRecord('${key}')" disabled>▶</button>
      <button class="btn primary small" id="save-btn-${key}" onclick="saveMiniRecord('${key}', ${JSON.stringify(displayWord[key])})" disabled>💾</button>
    </div>
  `).join('');
}

async function toggleMiniRecord(key) {
  const btn = document.getElementById('rec-btn-' + key);
  if (activeMiniRecorderKey && activeMiniRecorderKey !== key) {
    alert('Finish (Stop) the current word recording first.');
    return;
  }
  if (!activeMiniRecorderKey) {
    try {
      fullRecorder = fullRecorder; // no-op, keep linter happy
      window._miniRecorder = new AudioRecorder();
      await window._miniRecorder.start();
      activeMiniRecorderKey = key;
      btn.textContent = '⏹ Stop';
      btn.classList.add('recording-pulse');
    } catch (e) {
      alert('Could not access the microphone.');
    }
  } else {
    const blob = await window._miniRecorder.stop();
    pendingWordAudio[key] = blob;
    activeMiniRecorderKey = null;
    btn.textContent = '🎤 Re-record';
    btn.classList.remove('recording-pulse');
    document.getElementById('preview-btn-' + key).disabled = false;
    document.getElementById('save-btn-' + key).disabled = false;
  }
}

function previewMiniRecord(key) {
  if (pendingWordAudio[key]) playAudioBlob(pendingWordAudio[key]);
}

async function saveMiniRecord(key, displayWord) {
  const meaning = document.getElementById('meaning-' + key).value.trim();
  const blob = pendingWordAudio[key] || null;
  if (!blob && !meaning) { alert('Record audio or add a meaning first.'); return; }
  await saveWord(key, displayWord, meaning, blob);
  const row = document.getElementById('missing-row-' + key);
  if (row) row.innerHTML = `<div class="word-row-text"><div class="word-row-word">✓ ${escapeHtml(displayWord)} — saved</div></div>`;
}

/* ---------- Step: record the full lesson, tap-to-sync ---------- */

function renderFullTextTokens() {
  const el = document.getElementById('fullTextDisplay');
  el.innerHTML = currentTokens.map((t) => {
    if (t.type === 'sep') return escapeHtml(t.text);
    return `<span class="tap-word" id="full-word-${t.index}" onclick="markWordTimestamp(${t.index})">${escapeHtml(t.text)}</span>`;
  }).join('');
}

function resetFullRecordingUI() {
  document.getElementById('startFullRecBtn').style.display = 'inline-flex';
  document.getElementById('stopFullRecBtn').style.display = 'none';
  document.getElementById('fullRecStatus').textContent = '';
  document.getElementById('fullRecPreviewBtn').disabled = true;
  document.getElementById('generateLessonBtn').disabled = true;
  document.querySelectorAll('.tap-word').forEach((s) => s.classList.remove('tapped'));
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
  interpolateTimestamps(durationSec * 1000);

  const syncedCount = fullTimestamps.filter((t) => t !== null).length;
  document.getElementById('startFullRecBtn').style.display = 'inline-flex';
  document.getElementById('startFullRecBtn').textContent = '🎙 Re-record Full Lesson';
  document.getElementById('stopFullRecBtn').style.display = 'none';
  document.getElementById('fullRecStatus').textContent =
    `✓ Recorded (${durationSec.toFixed(0)}s). ${syncedCount}/${currentWordTokens.length} words tapped precisely — the rest were estimated automatically.`;
  document.getElementById('fullRecPreviewBtn').disabled = false;
  document.getElementById('generateLessonBtn').disabled = false;
}

/** Fills in any word that wasn't tapped during recording by interpolating
 *  between its nearest tapped neighbours (or spacing evenly across the
 *  whole recording if nothing at all was tapped), so tap-to-jump always
 *  works for every word, even an untapped one. */
function interpolateTimestamps(totalDurationMs) {
  const n = fullTimestamps.length;
  if (n === 0) return;
  const known = [];
  fullTimestamps.forEach((t, i) => { if (t !== null) known.push(i); });

  if (known.length === 0) {
    // Nothing was tapped at all — spread words evenly across the recording.
    for (let i = 0; i < n; i++) fullTimestamps[i] = Math.round((i / n) * totalDurationMs);
    return;
  }
  // Before the first tapped word: assume even spacing back from it.
  const first = known[0];
  for (let i = 0; i < first; i++) {
    fullTimestamps[i] = Math.round((fullTimestamps[first] * i) / (first + 1));
  }
  // Between tapped words: linear interpolation.
  for (let k = 0; k < known.length - 1; k++) {
    const a = known[k], b = known[k + 1];
    for (let i = a + 1; i < b; i++) {
      const frac = (i - a) / (b - a);
      fullTimestamps[i] = Math.round(fullTimestamps[a] + frac * (fullTimestamps[b] - fullTimestamps[a]));
    }
  }
  // After the last tapped word: spread remaining words evenly to the end.
  const last = known[known.length - 1];
  for (let i = last + 1; i < n; i++) {
    const frac = (i - last) / (n - last);
    fullTimestamps[i] = Math.round(fullTimestamps[last] + frac * (totalDurationMs - fullTimestamps[last]));
  }
}

function previewFullRecording() {
  if (fullAudioBlob) playAudioBlob(fullAudioBlob);
}

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
