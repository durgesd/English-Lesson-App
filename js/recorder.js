/* =========================================================
   AUDIO RECORDER
   Thin wrapper around MediaRecorder so the rest of the app just
   deals with "start/stop -> blob". Picks whichever audio format
   the current browser records best, so it works on both Android
   (records webm/opus) and iPhone (records mp4/aac) without any
   extra setup.
   ========================================================= */
const PREFERRED_MIME_TYPES = [
  'audio/mp4',
  'audio/aac',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus'
];

function pickSupportedMimeType() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.stream = null;
    this.chunks = [];
    this.mimeType = '';
    this.startedAt = 0;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mimeType = pickSupportedMimeType();
    this.mediaRecorder = this.mimeType
      ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
      : new MediaRecorder(this.stream);
    this.chunks = [];
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.startedAt = performance.now();
    this.mediaRecorder.start(100); // gather small chunks so nothing is lost
  }

  /** Elapsed milliseconds since start() was called — used to timestamp
   *  which word is being spoken at which moment (for sync). */
  elapsedMs() {
    return performance.now() - this.startedAt;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) { resolve(null); return; }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType || this.mimeType || 'audio/webm' });
        this.stream.getTracks().forEach((t) => t.stop());
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  cancel() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (e) {}
    }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
  }
}

/** Reads a Blob's real playback duration in seconds, using a throwaway
 *  <audio> element (Blob.duration isn't directly available otherwise). */
function getAudioDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audioEl = new Audio();
    audioEl.preload = 'metadata';
    audioEl.onloadedmetadata = () => {
      // Some browsers report Infinity for streamed/opus blobs until a seek
      // forces duration calculation — this workaround fixes that.
      if (audioEl.duration === Infinity || isNaN(audioEl.duration)) {
        audioEl.currentTime = 1e101;
        audioEl.ontimeupdate = () => {
          audioEl.ontimeupdate = null;
          URL.revokeObjectURL(url);
          resolve(audioEl.duration || 0);
        };
      } else {
        URL.revokeObjectURL(url);
        resolve(audioEl.duration || 0);
      }
    };
    audioEl.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    audioEl.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // data:<mime>;base64,....
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl) {
  return fetch(dataUrl).then((r) => r.blob());
}
