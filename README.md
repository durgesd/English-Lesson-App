# English Lesson Builder

A teacher tool: paste a lesson, record it in your own voice, build a
Word Bank of individual words with meanings, and generate one
self-contained interactive HTML lesson file that you can send directly
over WhatsApp. Children tap any word to hear it (from the Word Bank),
or press Play to hear the whole lesson in your natural rhythm — and
can tap any word mid-recording to jump straight to that point.

Everything is stored on the device (IndexedDB) — no server, no
account needed to use the app itself. Google Drive backup is optional.

---

## 1. Hosting (required — the microphone needs this)

Browsers only allow microphone access on a **secure origin**: an
`https://` website, or `http://localhost` for testing. It will **not**
work if you just double-click `index.html` from your file manager.

Easiest free options:
- **GitHub Pages** — upload this folder to a GitHub repo, turn on
  Pages in Settings, get a `https://yourname.github.io/...` URL.
- **Netlify / Vercel** — drag-and-drop this folder in their web
  dashboard, get an instant `https://...` URL.

Once hosted, open that URL on the teacher's phone and use
**"Add to Home Screen"** in the browser menu so it behaves like a
proper app.

To test locally on a laptop first:
```
cd english-lesson-app
python3 -m http.server 8000
```
then open `http://localhost:8000` in a browser.

---

## 2. Using the app

**Word Bank tab** — record individual words once, with a meaning, and
trim the clip precisely on a waveform before saving. These get reused
automatically in every future lesson; tap "✂ Edit" on any word to
re-trim or re-record it later.

**Create tab** —
1. Paste the lesson text and give it a title, tap **Check Words & Continue**.
2. Any word not already in the Word Bank is listed — record it right
   there (it's saved to the Word Bank automatically for next time).
3. Record the full lesson in your natural voice. While recording, tap
   each word on screen as you say it — this is what lets a child later
   touch any word in the full recording and jump straight to that
   point. If you don't manage to tap every word, the app fills the
   gaps automatically by estimating even spacing, so tap-to-jump still
   works everywhere — just less precisely for the un-tapped words.
4. After stopping, an editing panel appears with a waveform of your
   recording:
   - **Trim**: drag to select the part you want to keep, tap "Keep
     Only Selection" — everything outside it is removed. Good for
     cutting dead air at the start/end.
   - **Remove**: drag to select an unwanted part in the middle (a
     cough, mistake, long pause), tap "Remove Selection" — that part
     is deleted and the rest is joined back together seamlessly.
   - **Re-record part of it**: tap "Select Words to Re-record", tap a
     word (or tap a second word to select everything between them —
     one word, a sentence, or the whole passage), then "Re-record
     Selected". Record just that part again; it's spliced into the
     exact position, and the timing for every word after it adjusts
     automatically.
5. Tap **Generate Lesson File** — this saves the lesson in the app
   and downloads one `.html` file. Share that file directly from your
   phone's Downloads/Files app to WhatsApp.

**My Lessons tab** — every lesson you've built. Re-download or
preview any of them anytime (useful if you update a word's recording
later — regenerating picks up the latest Word Bank audio).

**The generated lesson file** — opens in any phone's browser, no app
needed, works fully offline once downloaded, and never needs the
teacher's app installed. Two modes:
- **Word Mode** (default): tap any word → hear it, see its meaning.
- **Full Lesson**: press ▶ to hear the whole recording with the
  current word highlighted as it's spoken; tap any word to jump
  straight to that point and keep playing from there.

---

## 3. Google Drive backup (optional, one-time setup)

Local backups (on-device snapshots + manual export file) work with
**no setup at all**. Google Drive is an extra off-device copy.

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or use an existing one).
3. **APIs & Services → Library** → enable the **Google Drive API**.
4. **APIs & Services → OAuth consent screen** → set it up as
   "External", add your own Google account as a test user (unless you
   verify the app).
5. **APIs & Services → Credentials → Create Credentials → OAuth
   client ID** → Application type: **Web application**.
6. Under **Authorized JavaScript origins**, add the exact URL you're
   hosting the app at (e.g. `https://yourname.github.io`).
7. Copy the generated **Client ID** (ends in
   `.apps.googleusercontent.com`).
8. In the app: **Settings tab → paste it into "Google OAuth Client
   ID" → Save → Connect Google Drive** and approve access.
9. Turn on **"Auto-backup after changes & on close"** if you want it
   automatic every time; otherwise use **Backup Now** whenever you like.

Backups are saved as JSON files (with audio embedded) inside a
"English Lesson App Backups" folder in the connected Google Drive
account. The oldest backups beyond the latest 5 are deleted
automatically to save space (audio makes each backup file sizeable).

---

## 4. Good to know / honest limitations

- **Audio format**: recordings use whichever format the recording
  phone's browser supports best (Android records `webm/opus`, iPhone
  records `mp4/aac`). Playback works well in the same ecosystem the
  recording was made in; very old browsers may have trouble with
  `webm` audio. If you find a specific phone that won't play a
  generated lesson, that's the thing to fix next.
- **Trimming/cutting/re-recording** re-encodes the edited audio as
  WAV (uncompressed) so it always plays correctly after being edited
  — this makes an edited lesson's audio noticeably larger than an
  unedited one, which is a deliberate trade-off for reliability over
  file size.
- **Tap-to-sync accuracy**: precision for "tap anywhere to jump there"
  depends on how many words the teacher tapped while recording — fully
  tapping every word gives frame-accurate jumps; skipped words are
  estimated by spacing evenly between the nearest tapped words.
- **Microphone permission**: the browser will ask for microphone
  access the first time you record — this has to be allowed for the
  app to work.
- **Nothing is uploaded anywhere** unless you explicitly set up and
  connect Google Drive.
