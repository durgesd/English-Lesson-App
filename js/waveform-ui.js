/* =========================================================
   WAVEFORM EDITOR (UI component)
   Draws a waveform and lets the teacher drag out a selection —
   dragging the two handles fine-tunes the start/end. Used for
   trimming a single word, and for trimming/cutting the full
   lesson recording. Reused wherever a piece of audio needs
   visual, precise editing.
   ========================================================= */
function createWaveformEditor(container, buffer) {
  const duration = bufferDuration(buffer);
  container.innerHTML = '';
  container.classList.add('wf-container');

  const canvas = document.createElement('canvas');
  const width = Math.max(200, container.clientWidth || 300);
  const height = 72;
  canvas.width = width * 2; // draw at 2x for crisp lines, scale down via CSS
  canvas.height = height * 2;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  container.appendChild(canvas);

  const selectionEl = document.createElement('div');
  selectionEl.className = 'wf-selection';
  container.appendChild(selectionEl);
  const startHandle = document.createElement('div');
  startHandle.className = 'wf-handle wf-handle-start';
  container.appendChild(startHandle);
  const endHandle = document.createElement('div');
  endHandle.className = 'wf-handle wf-handle-end';
  container.appendChild(endHandle);
  const playhead = document.createElement('div');
  playhead.className = 'wf-playhead';
  playhead.style.display = 'none';
  container.appendChild(playhead);

  let selStart = 0;
  let selEnd = duration;
  let onChangeCb = null;

  function drawWaveform() {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height, mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#b8c9bf';
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.ceil(data.length / w));
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const base = x * step;
      for (let i = 0; i < step; i++) {
        const idx = base + i;
        if (idx >= data.length) break;
        const v = data[idx];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min > max) { min = 0; max = 0; }
      const y1 = mid + min * mid * 0.9;
      const y2 = mid + max * mid * 0.9;
      ctx.fillRect(x, Math.min(y1, y2), 1, Math.max(2, Math.abs(y2 - y1)));
    }
  }

  const timeToPct = (t) => (duration > 0 ? (t / duration) * 100 : 0);
  const pxToTime = (x) => Math.max(0, Math.min(duration, (x / width) * duration));

  function updateHandles() {
    const sPct = timeToPct(selStart), ePct = timeToPct(selEnd);
    selectionEl.style.left = sPct + '%';
    selectionEl.style.width = Math.max(0.3, ePct - sPct) + '%';
    startHandle.style.left = 'calc(' + sPct + '% - 9px)';
    endHandle.style.left = 'calc(' + ePct + '% - 9px)';
  }

  function dragHandle(handle, isStart) {
    let active = false;
    const move = (clientX) => {
      const rect = container.getBoundingClientRect();
      const t = pxToTime(clientX - rect.left);
      if (isStart) selStart = Math.min(t, selEnd - 0.03);
      else selEnd = Math.max(t, selStart + 0.03);
      updateHandles();
    };
    handle.addEventListener('pointerdown', (e) => { active = true; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
    handle.addEventListener('pointermove', (e) => { if (active) move(e.clientX); });
    handle.addEventListener('pointerup', () => { if (active && onChangeCb) onChangeCb({ start: selStart, end: selEnd }); active = false; });
  }
  dragHandle(startHandle, true);
  dragHandle(endHandle, false);

  let creating = false, createStartX = 0;
  canvas.addEventListener('pointerdown', (e) => {
    const rect = container.getBoundingClientRect();
    createStartX = e.clientX - rect.left;
    creating = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!creating) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    selStart = pxToTime(Math.min(createStartX, x));
    selEnd = pxToTime(Math.max(createStartX, x));
    updateHandles();
  });
  window.addEventListener('pointerup', () => {
    if (creating) { creating = false; if (onChangeCb) onChangeCb({ start: selStart, end: selEnd }); }
  });

  drawWaveform();
  updateHandles();

  return {
    getSelection: () => ({ start: selStart, end: selEnd }),
    setSelection: (s, e) => { selStart = s; selEnd = e; updateHandles(); },
    selectAll: () => { selStart = 0; selEnd = duration; updateHandles(); },
    onChange: (cb) => { onChangeCb = cb; },
    showPlayhead: (t) => { playhead.style.display = 'block'; playhead.style.left = timeToPct(t) + '%'; },
    hidePlayhead: () => { playhead.style.display = 'none'; },
    duration
  };
}
