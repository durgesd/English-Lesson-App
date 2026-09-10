/* =========================================================
   WORD BANK
   Individual words, each with its own short pronunciation
   recording and a typed meaning. Reused across every lesson —
   record a word once, and any future lesson containing that
   word can use it automatically.
   ========================================================= */

/** Normalizes a word for lookup: lowercase, strips anything that
 *  isn't a letter/number/apostrophe (so "Word," "word." "word" all
 *  map to the same word-bank entry). */
function normalizeWordKey(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9']/g, '');
}

let wordBankRecorder = null;
let wordBankRecordedBlob = null;

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
    audioBlob: audioBlob || (existing ? existing.audioBlob : null),
    updatedAt: new Date().toISOString()
  };
  await dbPut('words', entry);
  scheduleAutoBackup();
  return entry;
}

async function deleteWord(key) {
  if (!confirm('Delete this word from the Word Bank? Any lesson already generated with it keeps working, but new lessons will need it re-recorded.')) return;
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

/* ---------- Word Bank UI ---------- */

async function renderWordBankList(filter) {
  const listEl = document.getElementById('wordBankList');
  if (!listEl) return;
  let words = await getAllWords();
  if (filter) {
    const f = filter.toLowerCase();
    words = words.filter((w) => w.word.toLowerCase().includes(f));
  }
  if (words.length === 0) {
    listEl.innerHTML = '<p class="hint">No words yet — record your first word above.</p>';
    return;
  }
  listEl.innerHTML = words.map((w) => `
    <div class="word-row">
      <button class="btn ghost small play-btn" onclick='playWordFromBank(${JSON.stringify(w.key)})' ${w.audioBlob ? '' : 'disabled'}>🔊</button>
      <div class="word-row-text">
        <div class="word-row-word">${escapeHtml(w.word)}</div>
        <div class="word-row-meaning">${escapeHtml(w.meaning || 'No meaning added')}</div>
      </div>
      <button class="btn ghost small" onclick='editWordPrompt(${JSON.stringify(w.key)})'>✏️</button>
      <button class="btn rust small" onclick='deleteWord(${JSON.stringify(w.key)})'>🗑</button>
    </div>
  `).join('');
}

async function playWordFromBank(key) {
  const w = await dbGet('words', key);
  if (w && w.audioBlob) playAudioBlob(w.audioBlob);
}

async function editWordPrompt(key) {
  const w = await dbGet('words', key);
  if (!w) return;
  const meaning = prompt('Meaning for "' + w.word + '":', w.meaning || '');
  if (meaning === null) return;
  await saveWord(key, w.word, meaning, w.audioBlob);
  renderWordBankList(document.getElementById('wordBankSearch').value);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Record New Word Widget ---------- */

async function startWordRecording() {
  try {
    wordBankRecorder = new AudioRecorder();
    await wordBankRecorder.start();
    document.getElementById('wordRecordBtn').style.display = 'none';
    document.getElementById('wordStopBtn').style.display = 'inline-flex';
    document.getElementById('wordRecordStatus').textContent = '🔴 Recording… say the word clearly, then tap Stop.';
  } catch (e) {
    alert('Could not access the microphone. Please allow microphone permission for this app.');
  }
}

async function stopWordRecording() {
  const blob = await wordBankRecorder.stop();
  wordBankRecordedBlob = blob;
  document.getElementById('wordRecordBtn').style.display = 'inline-flex';
  document.getElementById('wordStopBtn').style.display = 'none';
  document.getElementById('wordRecordStatus').textContent = '✓ Recorded — tap ▶ to check, then Save.';
  document.getElementById('wordPreviewBtn').disabled = false;
  document.getElementById('wordSaveBtn').disabled = false;
}

function previewWordRecording() {
  if (wordBankRecordedBlob) playAudioBlob(wordBankRecordedBlob);
}

async function saveNewWord() {
  const input = document.getElementById('newWordText');
  const meaningInput = document.getElementById('newWordMeaning');
  const raw = input.value.trim();
  if (!raw) { alert('Type the word first.'); return; }
  if (!wordBankRecordedBlob) { alert('Record the pronunciation first.'); return; }
  const key = normalizeWordKey(raw);
  if (!key) { alert('Please enter a valid word.'); return; }
  await saveWord(key, raw, meaningInput.value.trim(), wordBankRecordedBlob);
  input.value = '';
  meaningInput.value = '';
  wordBankRecordedBlob = null;
  document.getElementById('wordPreviewBtn').disabled = true;
  document.getElementById('wordSaveBtn').disabled = true;
  document.getElementById('wordRecordStatus').textContent = '';
  renderWordBankList();
}
