/* =========================================================
   LESSON FILE GENERATOR
   Builds ONE standalone .html file with everything embedded —
   the lesson text, every word's Word Bank pronunciation, the
   full rhythm recording, and the tap-timing data. No internet,
   no app install, and no external files needed to open it —
   just double-tap it (or open via WhatsApp) and it runs in any
   phone browser.
   ========================================================= */

async function buildLessonHtml(lesson) {
  const wordKeys = [...new Set(lesson.tokens.filter((t) => t.type === 'word').map((t) => t.key))];
  const words = {};
  for (const key of wordKeys) {
    const w = await dbGet('words', key);
    if (w) {
      words[key] = {
        meaning: w.meaning || '',
        audio: w.audioBlob ? await blobToBase64(w.audioBlob) : null
      };
    }
  }
  const fullAudio = await blobToBase64(lesson.fullAudioBlob);

  const lessonData = {
    title: lesson.title,
    tokens: lesson.tokens.map((t) =>
      t.type === 'word' ? { t: 'w', x: t.text, k: t.key, i: t.index } : { t: 's', x: t.text }
    ),
    timestamps: lesson.timestamps,
    fullAudio,
    words
  };

  // Safe to embed inside a <script> tag: escapes characters that could
  // otherwise prematurely close the tag or break older JS parsers.
  const jsonStr = JSON.stringify(lessonData)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return LESSON_HTML_TEMPLATE.replace('__LESSON_TITLE__', escapeHtml(lesson.title))
    .replace('__LESSON_DATA_JSON__', jsonStr);
}

async function downloadLessonFile(lesson) {
  const html = await buildLessonHtml(lesson);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const safeName = lesson.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'lesson';
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName + '.html';
  a.click();
  URL.revokeObjectURL(url);
}

const LESSON_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>__LESSON_TITLE__</title>
<style>
  :root{
    --ink:#2b2620; --ink-soft:#7a7266; --paper:#fdfaf4; --card:#ffffff;
    --brass:#b8925a; --sage:#6f9b7d; --sage-bg:#eaf3ec; --line:#ece6da;
    --highlight:#ffe9a8;
  }
  *{box-sizing:border-box;}
  body{
    margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:var(--paper); color:var(--ink); padding-bottom:110px;
  }
  header{
    background:var(--brass); color:#fff; padding:18px 16px 14px; text-align:center;
    position:sticky; top:0; z-index:5;
  }
  header h1{ margin:0; font-size:19px; font-weight:700; }
  header p{ margin:4px 0 0; font-size:12.5px; opacity:.9; }
  main{ padding:18px 16px 20px; max-width:640px; margin:0 auto; }
  .lesson-text{
    background:var(--card); border-radius:16px; padding:20px 18px; font-size:22px;
    line-height:2.1; box-shadow:0 2px 10px rgba(0,0,0,.06);
  }
  .tap-word{
    cursor:pointer; border-radius:6px; padding:1px 3px; transition:background .15s;
  }
  .tap-word:active{ background:var(--highlight); }
  .tap-word.speaking{ background:var(--sage); color:#fff; }
  .meaning-box{
    margin-top:14px; min-height:44px; background:var(--sage-bg); border-radius:12px;
    padding:12px 14px; font-size:15px; color:#3c5a49; display:none;
  }
  .meaning-box.show{ display:block; }
  .meaning-box b{ display:block; font-size:16.5px; margin-bottom:2px; color:#2c4638; }
  .controls{
    position:fixed; bottom:0; left:0; right:0; background:#fff;
    border-top:1px solid #eee; padding:10px 14px 14px; box-shadow:0 -4px 14px rgba(0,0,0,.06);
  }
  .progress-row{ display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .progress-row input[type=range]{ flex:1; }
  .time-label{ font-size:11px; color:var(--ink-soft); min-width:34px; text-align:center; }
  .btn-row{ display:flex; gap:8px; }
  button{
    font-family:inherit; border:none; border-radius:12px; padding:12px 14px;
    font-size:14.5px; font-weight:700; cursor:pointer;
  }
  .btn-primary{ background:var(--sage); color:#fff; flex:1; }
  .btn-ghost{ background:#f1ede4; color:var(--ink); }
  .mode-note{ text-align:center; font-size:12px; color:var(--ink-soft); margin-top:8px; }
</style>
</head>
<body>
<header>
  <h1>__LESSON_TITLE__</h1>
  <p id="modeHint">🔤 Tap any word to hear it</p>
</header>
<main>
  <div class="lesson-text" id="lessonText"></div>
  <div class="meaning-box" id="meaningBox"><b id="meaningWord"></b><span id="meaningText"></span></div>
</main>
<div class="controls">
  <div class="progress-row" id="progressRow" style="display:none;">
    <span class="time-label" id="curTime">0:00</span>
    <input type="range" id="seekBar" min="0" max="1000" value="0">
    <span class="time-label" id="durTime">0:00</span>
  </div>
  <div class="btn-row">
    <button class="btn-primary" id="playFullBtn">▶ Play Full Lesson</button>
    <button class="btn-ghost" id="wordModeBtn" style="display:none;">🔤 Word Mode</button>
  </div>
  <div class="mode-note" id="modeNote">In Full Lesson mode, tap any word to jump straight there.</div>
</div>

<script>
const LESSON_DATA = __LESSON_DATA_JSON__;

let mode = 'word'; // 'word' | 'full'
const wordAudio = new Audio();
const fullAudio = new Audio(LESSON_DATA.fullAudio);
let rafId = null;

function fmtTime(sec){
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec/60), s = Math.floor(sec%60);
  return m + ':' + String(s).padStart(2,'0');
}

function renderText(){
  const el = document.getElementById('lessonText');
  el.innerHTML = LESSON_DATA.tokens.map(t => {
    if (t.t === 's') return escapeHtml(t.x);
    return '<span class="tap-word" data-index="' + t.i + '" data-key="' + t.k + '">' + escapeHtml(t.x) + '</span>';
  }).join('');
  el.querySelectorAll('.tap-word').forEach(span => {
    span.addEventListener('click', () => onWordTap(span));
  });
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function onWordTap(span){
  const index = parseInt(span.dataset.index, 10);
  const key = span.dataset.key;
  if (mode === 'word'){
    playWordSound(key);
  } else {
    seekFullTo(index);
  }
}

function playWordSound(key){
  const w = LESSON_DATA.words[key];
  const meaningBox = document.getElementById('meaningBox');
  if (!w){
    meaningBox.classList.remove('show');
    return;
  }
  if (w.audio){
    wordAudio.src = w.audio;
    wordAudio.currentTime = 0;
    wordAudio.play().catch(()=>{});
  }
  if (w.meaning){
    document.getElementById('meaningWord').textContent = key;
    document.getElementById('meaningText').textContent = w.meaning;
    meaningBox.classList.add('show');
  } else {
    meaningBox.classList.remove('show');
  }
}

function seekFullTo(index){
  const ms = LESSON_DATA.timestamps[index] || 0;
  fullAudio.currentTime = ms / 1000;
  fullAudio.play().catch(()=>{});
}

function enterFullMode(){
  mode = 'full';
  document.getElementById('modeHint').textContent = '▶️ Full Lesson — tap any word to jump there';
  document.getElementById('wordModeBtn').style.display = 'inline-block';
  document.getElementById('playFullBtn').textContent = '⏸ Pause';
  document.getElementById('progressRow').style.display = 'flex';
  document.getElementById('modeNote').style.display = 'block';
  document.getElementById('meaningBox').classList.remove('show');
  fullAudio.play().catch(()=>{});
  startHighlightLoop();
}

function exitFullMode(){
  mode = 'word';
  fullAudio.pause();
  cancelAnimationFrame(rafId);
  document.getElementById('modeHint').textContent = '🔤 Tap any word to hear it';
  document.getElementById('wordModeBtn').style.display = 'none';
  document.getElementById('playFullBtn').textContent = '▶ Play Full Lesson';
  document.getElementById('progressRow').style.display = 'none';
  document.getElementById('modeNote').style.display = 'none';
  clearHighlight();
}

let currentSpeakingIndex = -1;
function clearHighlight(){
  if (currentSpeakingIndex >= 0){
    const el = document.querySelector('.tap-word[data-index="' + currentSpeakingIndex + '"]');
    if (el) el.classList.remove('speaking');
  }
  currentSpeakingIndex = -1;
}

function startHighlightLoop(){
  function tick(){
    const curMs = fullAudio.currentTime * 1000;
    let idx = -1;
    for (let i = 0; i < LESSON_DATA.timestamps.length; i++){
      if (LESSON_DATA.timestamps[i] !== null && LESSON_DATA.timestamps[i] <= curMs) idx = i; else break;
    }
    if (idx !== currentSpeakingIndex){
      clearHighlight();
      currentSpeakingIndex = idx;
      const el = document.querySelector('.tap-word[data-index="' + idx + '"]');
      if (el){
        el.classList.add('speaking');
        el.scrollIntoView({ block:'center', behavior:'smooth' });
      }
    }
    document.getElementById('curTime').textContent = fmtTime(fullAudio.currentTime);
    if (fullAudio.duration){
      document.getElementById('seekBar').value = Math.round((fullAudio.currentTime / fullAudio.duration) * 1000);
    }
    if (!fullAudio.paused) rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

document.getElementById('playFullBtn').addEventListener('click', () => {
  if (mode !== 'full'){ enterFullMode(); return; }
  if (fullAudio.paused){ fullAudio.play(); startHighlightLoop(); document.getElementById('playFullBtn').textContent = '⏸ Pause'; }
  else { fullAudio.pause(); cancelAnimationFrame(rafId); document.getElementById('playFullBtn').textContent = '▶ Resume'; }
});
document.getElementById('wordModeBtn').addEventListener('click', exitFullMode);
document.getElementById('seekBar').addEventListener('input', (e) => {
  if (!fullAudio.duration) return;
  fullAudio.currentTime = (e.target.value / 1000) * fullAudio.duration;
});
fullAudio.addEventListener('loadedmetadata', () => {
  document.getElementById('durTime').textContent = fmtTime(fullAudio.duration);
});
fullAudio.addEventListener('ended', () => {
  document.getElementById('playFullBtn').textContent = '▶ Play Again';
  cancelAnimationFrame(rafId);
});

renderText();
</script>
</body>
</html>`;
