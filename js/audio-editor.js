/* =========================================================
   AUDIO EDITOR (core engine)
   Real, sample-accurate audio editing entirely in the browser —
   trim, cut out a middle section, or splice a freshly-recorded
   replacement into an exact position. Everything is decoded to
   raw audio once, edited as raw samples, then re-encoded as WAV
   (plays on every phone/browser, unlike the original recording
   codec which can vary by device).

   All edits go through ONE shared AudioContext so every decoded
   buffer ends up at the same sample rate — required before they
   can be sliced and concatenated together correctly.
   ========================================================= */
const editorAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

async function blobToAudioBuffer(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  return editorAudioCtx.decodeAudioData(arrayBuffer);
}

function bufferDuration(buffer) {
  return buffer.length / buffer.sampleRate;
}

/** Mixes down to mono and returns the raw samples for a buffer. */
function monoSamples(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const a = buffer.getChannelData(0);
  const b = buffer.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
  return out;
}

/** Extracts [startSec, endSec) from a buffer as a new mono buffer. */
function sliceBuffer(buffer, startSec, endSec) {
  const sr = buffer.sampleRate;
  const data = monoSamples(buffer);
  const startSample = Math.max(0, Math.min(data.length, Math.round(startSec * sr)));
  const endSample = Math.max(startSample, Math.min(data.length, Math.round(endSec * sr)));
  const length = Math.max(1, endSample - startSample);
  const out = editorAudioCtx.createBuffer(1, length, sr);
  out.getChannelData(0).set(data.subarray(startSample, endSample));
  return out;
}

/** Joins several mono buffers (same sample rate) end-to-end. */
function concatBuffers(buffers) {
  const usable = buffers.filter((b) => b && b.length > 0);
  if (usable.length === 0) return editorAudioCtx.createBuffer(1, 1, editorAudioCtx.sampleRate);
  const sr = usable[0].sampleRate;
  const totalLength = usable.reduce((sum, b) => sum + b.length, 0);
  const out = editorAudioCtx.createBuffer(1, totalLength, sr);
  const outData = out.getChannelData(0);
  let offset = 0;
  for (const b of usable) {
    outData.set(monoSamples(b), offset);
    offset += b.length;
  }
  return out;
}

/** Encodes a mono AudioBuffer as a standard 16-bit PCM WAV Blob —
 *  the most universally-playable audio format across phones/browsers. */
function bufferToWavBlob(buffer) {
  const samples = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const dataSize = samples.length * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, 1, true);   // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);   // block align
  view.setUint16(34, 16, true);  // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function playBufferRange(buffer, startSec, endSec, onEnded) {
  const source = editorAudioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(editorAudioCtx.destination);
  const s = Math.max(0, startSec || 0);
  const dur = Math.max(0, (endSec != null ? endSec : bufferDuration(buffer)) - s);
  if (editorAudioCtx.state === 'suspended') editorAudioCtx.resume();
  source.start(0, s, dur);
  if (onEnded) source.onended = onEnded;
  return source;
}
