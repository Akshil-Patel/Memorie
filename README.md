# Mémoire — Setup Guide

A minimal memory clip app. Record throughout your day, pick one highlight, save it forever to Google Drive.

---

## Quick Start (Demo Mode)

Just open `index.html` in a browser. It runs in demo mode without any Google credentials — you can record clips, pick highlights, and see the vault UI.

---

## Full Setup (Real Google Drive)

### Step 1 — Create a Google Cloud Project

1. Go to https://console.cloud.google.com
2. Create a new project (e.g. "Memoire")
3. Enable the **Google Drive API**
   - APIs & Services → Library → search "Google Drive API" → Enable

### Step 2 — Create OAuth Credentials

1. APIs & Services → Credentials → Create Credentials → **OAuth client ID**
2. Application type: **Web application**
3. Authorized JavaScript origins: add your domain (e.g. `http://localhost:3000` for local dev)
4. Copy the **Client ID**

### Step 3 — Create an API Key

1. APIs & Services → Credentials → Create Credentials → **API Key**
2. (Optional) Restrict it to the Drive API
3. Copy the **API Key**

### Step 4 — Add Credentials to app.js

Open `app.js` and replace:

```js
const CONFIG = {
  CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  API_KEY: 'YOUR_GOOGLE_API_KEY',
  ...
};
```

### Step 5 — Configure OAuth Consent Screen

1. APIs & Services → OAuth consent screen
2. Set app name, user support email
3. Add scope: `https://www.googleapis.com/auth/drive.file`
4. Add yourself as a test user (while in testing mode)

### Step 6 — Serve the App

The app must be served over HTTP (not opened as a file) for Google OAuth to work.

```bash
# Python
python3 -m http.server 3000

# Node
npx serve .
```

Then open http://localhost:3000

---

## How It Works

1. User signs in with Google OAuth
2. App creates a `Mémoire/Highlights/` folder in their Drive
3. Clips are recorded locally using `MediaRecorder` API
4. When a highlight is selected, it uploads to their Drive via the Drive API
5. Other clips are discarded (never uploaded)
6. The vault screen lists all uploaded highlights from Drive

**Storage**: Each user's clips go to their own Google Drive (15 GB free). Your app pays nothing.

---

## File Structure

```
memoire/
├── index.html   — App shell and all screens
├── style.css    — Full design system (dark theme)
├── app.js       — All logic: recording, Drive API, UI
└── README.md    — This file
```
