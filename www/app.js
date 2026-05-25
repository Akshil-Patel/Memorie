const CONFIG = {
  // ⚠️ INSERT YOUR CREDENTIALS HERE AFTER CREATING THEM IN GOOGLE CLOUD CONSOLE
  // See: google_cloud_setup.md in your artifact directory for detailed instructions
  CLIENT_ID: '935498935333-io5ecdvh88rk7v64bb8v3fj5l2mbtvl3.apps.googleusercontent.com',
  API_KEY: 'AIzaSyAiAVyRLwcbUHuN3dxUf7HeEe6IFPfc8HI',
  SCOPES: 'https://www.googleapis.com/auth/drive.file',
  FOLDER_NAME: 'Mémoire',
  HIGHLIGHTS_FOLDER: 'Highlights',
};

// ── NATIVE PLATFORM HELPER ───────────
function isNativePlatform() {
  return window.Capacitor && window.Capacitor.isNativePlatform();
}

// ── FILTER MAP (canvas ctx.filter equivalents) ──
const FILTER_MAP = {
  none: 'none',
  retro: 'sepia(0.55) contrast(1.15) brightness(0.95) saturate(1.1)',
  noir: 'grayscale(1) contrast(1.3) brightness(0.9)',
  vivid: 'saturate(1.5) contrast(1.1)',
  cyberpunk: 'hue-rotate(140deg) saturate(1.35) contrast(1.1)',
};

// ── STATE ──────────────────────────────
const state = {
  user: null,
  accessToken: null,
  folderId: null,
  highlightsFolderId: null,
  clips: [],          // { id, blob, url, name, duration, timestamp, size }
  memories: [],       // { id, name, date, driveId, url, size, thumbnailLink }
  isRecording: false,
  mediaRecorder: null,
  recordChunks: [],
  recordStartTime: null,
  recInterval: null,
  recSecs: 0,
  stream: null,
  facingMode: 'user',
  selectedHighlightIds: [],
  sidebarOpen: true,
  lastRecordToggleTime: 0,
  selectedFilter: 'none',
  streakCount: 0,
  sharedFolderId: '',
  activeVaultMode: 'personal',
  // Zoom state
  zoomLevel: 1,
  minZoom: 1,
  maxZoom: 5,
  supportsHardwareZoom: false,
  // Canvas recording
  canvasLoopId: null,
  canvasCtx: null,
  // Pinch zoom tracking
  pinchStartDist: 0,
  pinchStartZoom: 1,
  // Drag zoom tracking
  dragZoomStartY: 0,
  dragZoomStartZoom: 1,
  isDragZooming: false,
};

// ── INDEXEDDB LOCAL STORAGE WRAPPER ────
const DB = {
  db: null,
  init() {
    return new Promise((resolve) => {
      const request = indexedDB.open('memoire_db', 1);
      request.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('memories')) db.createObjectStore('memories', { keyPath: 'id' });
      };
      request.onsuccess = e => {
        this.db = e.target.result;
        resolve();
      };
      request.onerror = () => resolve();
    });
  },
  async getStore(storeName) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
  },
  async put(storeName, item) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  },
  async delete(storeName, id) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  },
  async clearStore(storeName) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  }
};

// ── INIT ───────────────────────────────
window.onload = async () => {
  setDate();

  // Load user's Vault Settings
  state.activeVaultMode = localStorage.getItem('memoire_vault_mode') || 'personal';
  state.sharedFolderId = localStorage.getItem('memoire_shared_folder_id') || '';

  // Register Service Worker for PWA offline caching (skip if native Android app)
  if (!isNativePlatform() && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('[Service Worker] Registered with scope:', reg.scope))
      .catch(err => console.warn('[Service Worker] Registration failed:', err));
  }

  // Initialize IndexedDB and retrieve cached data
  await initIndexedDBData();

  // Hide sidebar on mobile screen loads by default
  if (window.innerWidth <= 700) {
    state.sidebarOpen = false;
    document.getElementById('sidebar').classList.add('hidden');
  }

  // Handle Offline detection
  updateOfflineUI();
  window.addEventListener('online', updateOfflineUI);
  window.addEventListener('offline', updateOfflineUI);

  // Load external Google APIs
  loadGoogleAPI();
};

function setDate() {
  const d = new Date();
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  document.getElementById('topbar-date').textContent = d.toLocaleDateString('en-US', opts);
}

async function initIndexedDBData() {
  try {
    await DB.init();
    const savedClips = await DB.getStore('clips');
    state.clips = savedClips.map(c => {
      c.url = URL.createObjectURL(c.blob);
      c.timestamp = new Date(c.timestamp);
      return c;
    });

    if (state.clips.length > 0) {
      renderClips();
      updateRecordStats();
    }
  } catch (e) {
    console.warn('Failed to load IndexedDB data:', e);
  }
}

function updateOfflineUI() {
  const isOnline = navigator.onLine;
  const demoBtn = document.getElementById('btn-demo');
  const googleBtn = document.querySelector('.btn-google');

  if (demoBtn) {
    if (!isOnline) {
      demoBtn.textContent = 'Continue in Offline Demo Mode';
      demoBtn.style.borderColor = 'var(--green)';
      demoBtn.style.color = 'var(--green)';
      if (googleBtn) googleBtn.style.display = 'none';
    } else {
      demoBtn.textContent = 'Try Demo Mode (Local Storage)';
      demoBtn.style.borderColor = 'var(--border)';
      demoBtn.style.color = 'var(--text-muted)';
      if (googleBtn) googleBtn.style.display = 'inline-flex';
    }
  }
}

// ── GOOGLE API ─────────────────────────
function loadGoogleAPI() {
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onerror = () => handleGAPIError();
  document.head.appendChild(script);

  const gapiScript = document.createElement('script');
  gapiScript.src = 'https://apis.google.com/js/api.js';
  gapiScript.onerror = () => handleGAPIError();
  gapiScript.onload = () => {
    if (typeof gapi !== 'undefined') {
      gapi.load('client', initGAPIClient);
    } else {
      handleGAPIError();
    }
  };
  document.head.appendChild(gapiScript);
}

function handleGAPIError() {
  console.warn('Google GAPI/Identity script failed to load. Graceful offline capabilities enabled.');
}

async function initGAPIClient() {
  try {
    await gapi.client.init({
      apiKey: CONFIG.API_KEY,
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    });
    checkExistingSession();
  } catch (e) {
    console.warn('GAPI init failed — running in demo mode fallback');
  }
}

function checkExistingSession() {
  const savedToken = sessionStorage.getItem('memoire_token');
  const savedUser = sessionStorage.getItem('memoire_user');
  if (savedToken && savedUser) {
    state.accessToken = savedToken;
    state.user = JSON.parse(savedUser);
    if (savedToken !== 'demo' && typeof gapi !== 'undefined' && gapi.client) {
      gapi.client.setToken({ access_token: savedToken });
    }
    enterApp();
  }
}

function signIn() {
  if (!navigator.onLine) {
    toast('You are offline. Entering offline Demo Mode.');
    enterDemoMode();
    return;
  }

  // If no credentials or scripts are blocked/unavailable, enter demo mode
  if (CONFIG.CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com' || typeof google === 'undefined') {
    toast('Google Cloud credentials not configured. Running in Demo Mode.');
    enterDemoMode();
    return;
  }

  try {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: async (response) => {
        if (response.error) { toast('Sign in failed'); return; }
        state.accessToken = response.access_token;
        gapi.client.setToken({ access_token: response.access_token });
        sessionStorage.setItem('memoire_token', response.access_token);
        await fetchUserInfo();
        enterApp();
      },
    });
    tokenClient.requestAccessToken();
  } catch (e) {
    console.warn('OAuth initialization failed. Triggering demo fallback.', e);
    enterDemoMode();
  }
}

function enterDemoMode() {
  state.user = { name: 'Demo User', email: 'demo@memoire.app', picture: null };
  state.accessToken = 'demo';
  sessionStorage.setItem('memoire_token', 'demo');
  sessionStorage.setItem('memoire_user', JSON.stringify(state.user));
  toast('Running in Demo Mode — Local persistence active!');
  enterApp();
}

async function fetchUserInfo() {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${state.accessToken}` }
    });
    const info = await res.json();
    state.user = { name: info.name, email: info.email, picture: info.picture };
    sessionStorage.setItem('memoire_user', JSON.stringify(state.user));
  } catch (e) {
    state.user = { name: 'User', email: '', picture: null };
  }
}

function signOut() {
  sessionStorage.clear();
  state.user = null;
  state.accessToken = null;

  // Revoke object URLs to clear resources
  state.clips.forEach(c => URL.revokeObjectURL(c.url));
  state.memories.forEach(m => { if (m.url) URL.revokeObjectURL(m.url); });

  state.clips = [];
  state.memories = [];

  // Clear local DB cache upon user sign-out
  DB.clearStore('clips');
  DB.clearStore('memories');

  stopStream();
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-auth').classList.add('active');

  // Reset grids to empty states
  renderClips();
  renderVault();
  updateRecordStats();

  toast('Signed out');
}

async function enterApp() {
  document.getElementById('screen-auth').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  populateUser();
  await initCamera();
  if (state.accessToken !== 'demo') {
    await ensureDriveFolder();
    await loadMemories();
  } else {
    await loadDemoMemories();
  }

  // Handle PWA shortcut URL params (e.g., ?tab=vault)
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get('tab');
  if (tabParam && ['record', 'today', 'vault'].includes(tabParam)) {
    switchTab(tabParam);
  }
}

function populateUser() {
  const u = state.user;
  document.getElementById('user-name').textContent = u.name || 'User';
  document.getElementById('user-email').textContent = u.email || '';
  
  // Mobile user info dropdown
  const dropdownName = document.getElementById('dropdown-user-name');
  const dropdownEmail = document.getElementById('dropdown-user-email');
  if (dropdownName) dropdownName.textContent = u.name || 'User';
  if (dropdownEmail) dropdownEmail.textContent = u.email || '';

  const av = document.getElementById('user-avatar');
  if (u.picture) {
    av.innerHTML = `<img src="${u.picture}" alt="${u.name}">`;
  } else {
    av.textContent = (u.name || 'U')[0].toUpperCase();
  }

  // Mobile topbar avatar
  const avTop = document.getElementById('user-avatar-top');
  if (avTop) {
    if (u.picture) {
      avTop.innerHTML = `<img src="${u.picture}" alt="${u.name}">`;
    } else {
      avTop.textContent = (u.name || 'U')[0].toUpperCase();
    }
  }
}

// ── CAMERA ─────────────────────────────
async function initCamera() {
  const vid = document.getElementById('video-preview');
  const idle = document.getElementById('camera-idle');

  const isMobile = window.innerWidth <= 700;
  const constraints = {
    video: { 
      facingMode: state.facingMode, 
      width: { ideal: isMobile ? 480 : 1280 }, 
      height: { ideal: isMobile ? 640 : 720 } 
    },
    audio: true,
  };

  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    console.warn('Audio camera stream failed. Falling back to video-only.', e);
    try {
      constraints.audio = false;
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (videoError) {
      toast('Camera not accessible — check permissions');
      idle.querySelector('p').textContent = 'Camera Blocked';
      return;
    }
  }

  vid.srcObject = state.stream;
  vid.style.display = 'block';
  vid.classList.toggle('mirrored', state.facingMode === 'user');
  
  // Apply current filter to camera preview
  applyFilterToPreview();

  // Detect hardware zoom support
  detectZoomCapabilities();
  // Reset zoom level on camera init
  state.zoomLevel = 1;
  updateZoomIndicator();

  if (idle.querySelector('p')) {
    idle.querySelector('p').textContent = 'Camera ready';
  }
  idle.style.opacity = '0';

  // Setup zoom gesture listeners (once)
  setupZoomGestures();
}

function setFilter(filterName) {
  state.selectedFilter = filterName;
  
  // Update filter selector UI cards active state
  document.querySelectorAll('.filter-card').forEach(card => {
    card.classList.toggle('active', card.dataset.filter === filterName);
  });
  
  applyFilterToPreview();
}

function applyFilterToPreview() {
  const vid = document.getElementById('video-preview');
  if (!vid) return;
  
  // Remove existing filter classes
  vid.classList.remove('filter-retro', 'filter-noir', 'filter-vivid', 'filter-cyberpunk');
  if (state.selectedFilter !== 'none') {
    vid.classList.add(`filter-${state.selectedFilter}`);
  }
}

// ── ZOOM ───────────────────────────────
function detectZoomCapabilities() {
  if (!state.stream) return;
  const videoTrack = state.stream.getVideoTracks()[0];
  if (!videoTrack) return;

  try {
    const capabilities = videoTrack.getCapabilities();
    if (capabilities.zoom) {
      state.supportsHardwareZoom = true;
      state.minZoom = capabilities.zoom.min || 1;
      state.maxZoom = Math.min(capabilities.zoom.max || 5, 10);
    } else {
      state.supportsHardwareZoom = false;
      state.minZoom = 1;
      state.maxZoom = 4; // Digital zoom max
    }
  } catch (e) {
    state.supportsHardwareZoom = false;
    state.minZoom = 1;
    state.maxZoom = 4;
  }
}

function applyZoom(level) {
  state.zoomLevel = Math.max(state.minZoom, Math.min(state.maxZoom, level));

  if (state.supportsHardwareZoom && state.stream) {
    const videoTrack = state.stream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        videoTrack.applyConstraints({ advanced: [{ zoom: state.zoomLevel }] });
      } catch (e) {
        console.warn('Hardware zoom failed:', e);
      }
    }
  }
  // For digital zoom fallback, the canvas loop handles it via drawImage crop
  updateZoomIndicator();
}

function updateZoomIndicator() {
  const indicator = document.getElementById('zoom-indicator');
  const levelEl = document.getElementById('zoom-level');
  const barFill = document.getElementById('zoom-bar-fill');
  if (!indicator || !levelEl || !barFill) return;

  if (state.zoomLevel > 1.05) {
    indicator.classList.add('visible');
    levelEl.textContent = `${state.zoomLevel.toFixed(1)}×`;
    const pct = ((state.zoomLevel - state.minZoom) / (state.maxZoom - state.minZoom)) * 100;
    barFill.style.height = `${pct}%`;
  } else {
    indicator.classList.remove('visible');
  }
}

let _zoomGesturesSetup = false;
function setupZoomGestures() {
  if (_zoomGesturesSetup) return;
  _zoomGesturesSetup = true;

  const cameraWrap = document.getElementById('camera-wrap');
  const recordRing = document.getElementById('record-ring');

  // ── Pinch-to-Zoom on camera preview ──
  cameraWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      state.pinchStartDist = getPinchDistance(e.touches);
      state.pinchStartZoom = state.zoomLevel;
    }
  }, { passive: false });

  cameraWrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = getPinchDistance(e.touches);
      const scale = dist / state.pinchStartDist;
      applyZoom(state.pinchStartZoom * scale);
    }
  }, { passive: false });

  // ── Drag-to-Zoom on record button ──
  recordRing.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      state.dragZoomStartY = e.touches[0].clientY;
      state.dragZoomStartZoom = state.zoomLevel;
      state.isDragZooming = false;
    }
  }, { passive: true });

  recordRing.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      const deltaY = state.dragZoomStartY - e.touches[0].clientY; // Positive = dragged up
      if (Math.abs(deltaY) > 10) {
        state.isDragZooming = true;
        // 200px drag = full zoom range
        const zoomDelta = (deltaY / 200) * (state.maxZoom - state.minZoom);
        applyZoom(state.dragZoomStartZoom + zoomDelta);
        e.preventDefault();
      }
    }
  }, { passive: false });

  recordRing.addEventListener('touchend', (e) => {
    if (state.isDragZooming) {
      state.isDragZooming = false;
      // Don't trigger record toggle when drag-zooming
    }
  }, { passive: true });
}

function getPinchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── CANVAS RECORDING PIPELINE ──────────
function startCanvasLoop() {
  const vid = document.getElementById('video-preview');
  const canvas = document.getElementById('video-canvas');
  if (!vid || !canvas) return;

  // Match canvas to video dimensions
  const track = state.stream.getVideoTracks()[0];
  const settings = track.getSettings();
  canvas.width = settings.width || 640;
  canvas.height = settings.height || 480;

  const ctx = canvas.getContext('2d');
  state.canvasCtx = ctx;

  function drawFrame() {
    if (!state.isRecording) return;

    // Apply filter
    const filterStr = FILTER_MAP[state.selectedFilter] || 'none';
    ctx.filter = filterStr;

    // Handle zoom (digital zoom if not using hardware zoom, or always for visual consistency)
    const zoom = state.zoomLevel;
    const sw = canvas.width / zoom;
    const sh = canvas.height / zoom;
    const sx = (canvas.width - sw) / 2;
    const sy = (canvas.height - sh) / 2;

    if (!state.supportsHardwareZoom && zoom > 1.01) {
      // Digital zoom: draw cropped region at full canvas size
      ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    }

    state.canvasLoopId = requestAnimationFrame(drawFrame);
  }

  state.canvasLoopId = requestAnimationFrame(drawFrame);
}

function stopCanvasLoop() {
  if (state.canvasLoopId) {
    cancelAnimationFrame(state.canvasLoopId);
    state.canvasLoopId = null;
  }
  state.canvasCtx = null;
}

async function flipCamera() {
  if (state.isRecording) return; // Prevent flipping camera during capture
  state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
  stopStream();
  await initCamera();
}

function stopStream() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  const vid = document.getElementById('video-preview');
  if (vid) vid.srcObject = null;
}

// ── RECORDING ──────────────────────────
function toggleRecord() {
  // Don't trigger recording if user was drag-zooming
  if (state.isDragZooming) return;

  const now = Date.now();
  if (now - state.lastRecordToggleTime < 500) return; // Debounce rapid clicking
  state.lastRecordToggleTime = now;

  state.isRecording ? stopRecord() : startRecord();
}

function startRecord() {
  if (!state.stream) { toast('Camera not ready'); return; }

  state.isRecording = true; // Set early so canvas loop runs
  state.recordChunks = [];

  // Start canvas rendering loop for filter baking
  startCanvasLoop();

  // Build the recording stream: canvas video + original audio
  const canvas = document.getElementById('video-canvas');
  const canvasStream = canvas.captureStream(30); // 30 fps

  // Mix in audio tracks from the camera stream
  const audioTracks = state.stream.getAudioTracks();
  const mixedStream = new MediaStream();
  canvasStream.getVideoTracks().forEach(t => mixedStream.addTrack(t));
  audioTracks.forEach(t => mixedStream.addTrack(t));

  const mimeOptions = getSupportedMimeType();
  const options = {
    ...mimeOptions,
    videoBitsPerSecond: 1200000, // 1.2 Mbps (super compressed yet crisp for mobile/web screens)
    audioBitsPerSecond: 64000    // 64 Kbps mono audio
  };
  state.mediaRecorder = new MediaRecorder(mixedStream, options);

  state.mediaRecorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) state.recordChunks.push(e.data);
  };

  state.mediaRecorder.onstop = () => finalizeClip();
  state.mediaRecorder.start(100);

  state.recordStartTime = Date.now();
  state.recSecs = 0;

  // UI Updates
  document.getElementById('record-ring').classList.add('recording');
  document.getElementById('record-label').textContent = 'Tap to stop';
  document.getElementById('rec-badge').classList.add('visible');
  document.getElementById('camera-timer').classList.add('visible');
  document.getElementById('btn-flip').disabled = true;

  state.recInterval = setInterval(() => {
    state.recSecs = Math.round((Date.now() - state.recordStartTime) / 1000);
    document.getElementById('camera-timer').textContent = formatDuration(state.recSecs);
  }, 1000);
}

function stopRecord() {
  if (!state.mediaRecorder) return;
  state.mediaRecorder.stop();
  state.isRecording = false;
  clearInterval(state.recInterval);

  // Stop the canvas rendering loop
  stopCanvasLoop();

  // UI Updates
  document.getElementById('record-ring').classList.remove('recording');
  document.getElementById('record-label').textContent = 'Tap to record';
  document.getElementById('rec-badge').classList.remove('visible');
  document.getElementById('camera-timer').classList.remove('visible');
  document.getElementById('btn-flip').disabled = false;
}

function getSupportedMimeType() {
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return { mimeType: t };
  }
  return {};
}

async function finalizeClip() {
  if (state.recSecs < 1) {
    toast('Clip too short — keep recording for at least 1 second');
    return;
  }

  const mimeType = state.mediaRecorder?.mimeType || getSupportedMimeType().mimeType || 'video/webm';
  const blob = new Blob(state.recordChunks, { type: mimeType });
  const url = URL.createObjectURL(blob);

  let ext = 'webm';
  if (mimeType.includes('mp4')) {
    ext = 'mp4';
  } else if (mimeType.includes('quicktime')) {
    ext = 'mp4';
  }

  const now = new Date();
  const clip = {
    id: Date.now(),
    blob,
    url,
    name: `Clip ${state.clips.length + 1}`,
    duration: state.recSecs,
    timestamp: now,
    size: blob.size,
    ext,
    filter: state.selectedFilter,
  };

  state.clips.push(clip);

  // Persist clip to local database
  await DB.put('clips', clip);

  renderClips();
  updateRecordStats();
  toast(`Clip ${clip.name} saved — ${formatDuration(clip.duration)}`);
  switchTab('today');
}

// ── RENDER CLIPS ───────────────────────
function renderClips() {
  const grid = document.getElementById('clips-grid');
  const empty = document.getElementById('clips-empty');
  const btn = document.getElementById('btn-save-highlight');
  const sub = document.getElementById('today-sub');

  if (state.clips.length === 0) {
    grid.querySelectorAll('.clip-card').forEach(card => card.remove());
    if (empty) empty.style.display = 'flex';
    btn.style.display = 'none';
    sub.textContent = 'Review and pick your highlight';
    updateNavBadge();
    return;
  }

  if (empty) empty.style.display = 'none';
  btn.style.display = 'inline-flex';
  sub.textContent = `${state.clips.length} clip${state.clips.length !== 1 ? 's' : ''} recorded today`;

  // Rebuild clip cards
  grid.querySelectorAll('.clip-card').forEach(card => card.remove());
  state.clips.forEach((clip, i) => {
    const card = buildClipCard(clip, i);
    grid.appendChild(card);
  });

  updateNavBadge();
}

function buildClipCard(clip, index) {
  const card = document.createElement('div');
  card.className = 'clip-card';
  card.dataset.id = clip.id;
  card.style.animationDelay = `${index * 40}ms`;

  const filterClass = clip.filter && clip.filter !== 'none' ? `filter-${clip.filter}` : '';
  card.innerHTML = `
    <div class="clip-thumb">
      <video src="${clip.url}" class="${filterClass}" muted preload="metadata" playsinline></video>
      <div class="clip-thumb-overlay">
        <div class="play-icon">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="13" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.6)" stroke-width="1"/>
            <path d="M11 9.5l8 4.5-8 4.5V9.5z" fill="white"/>
          </svg>
        </div>
      </div>
      <div class="clip-duration-badge">${formatDuration(clip.duration)}</div>
    </div>
    <div class="clip-body">
      <div>
        <p class="clip-name">${clip.name}</p>
        <p class="clip-time">${clip.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${formatSize(clip.size)}</p>
      </div>
      <div class="clip-actions">
        <button class="icon-btn" onclick="playClip(${clip.id})" title="Play" aria-label="Play ${clip.name}">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 1.5l10 5-10 5V1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        </button>
        <button class="icon-btn danger" onclick="deleteClip(${clip.id})" title="Delete" aria-label="Delete ${clip.name}">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3.5h9M5 3.5V2h3v1.5M5.5 6v4M7.5 6v4M3 3.5l.5 7.5h6L10 3.5H3z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  `;

  card.querySelector('.clip-thumb').addEventListener('click', () => playClip(clip.id));

  const videoEl = card.querySelector('.clip-thumb video');
  if (videoEl) {
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.currentTime = 0.1; // Seek to 0.1s to force frame decode
    });
  }
  return card;
}

async function deleteClip(id) {
  const idx = state.clips.findIndex(c => c.id === id);
  if (idx === -1) return;
  URL.revokeObjectURL(state.clips[idx].url);
  state.clips.splice(idx, 1);
  await DB.delete('clips', id);

  const card = document.querySelector(`.clip-card[data-id="${id}"]`);
  if (card) {
    card.style.transition = 'all 0.3s ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.9)';
    setTimeout(() => { card.remove(); renderClips(); updateRecordStats(); }, 300);
  }
  toast('Clip deleted');
}

function playClip(id) {
  const clip = state.clips.find(c => c.id === id);
  if (!clip) return;
  openPlayback(clip.url, clip.name, `${formatDuration(clip.duration)} · ${formatSize(clip.size)}`, clip.filter);
}

function updateRecordStats() {
  document.getElementById('clip-count-display').textContent = state.clips.length;
  const total = state.clips.reduce((s, c) => s + c.duration, 0);
  document.getElementById('total-duration-display').textContent = total > 0 ? formatDuration(total) : '0s';
  updateNavBadge();
}

function updateNavBadge() {
  const badge = document.getElementById('nav-clip-count');
  const mobileBadge = document.getElementById('mobile-clip-count');
  
  if (state.clips.length > 0) {
    if (badge) {
      badge.textContent = state.clips.length;
      badge.style.display = 'inline-block';
    }
    if (mobileBadge) {
      mobileBadge.textContent = state.clips.length;
      mobileBadge.style.display = 'inline-block';
    }
  } else {
    if (badge) badge.style.display = 'none';
    if (mobileBadge) mobileBadge.style.display = 'none';
  }
}

// ── HIGHLIGHT PICKER ───────────────────
function openHighlightPicker() {
  if (state.clips.length === 0) { toast('No clips to pick from'); return; }
  state.selectedHighlightIds = [];
  const btnConfirm = document.getElementById('btn-confirm-highlight');
  btnConfirm.disabled = true;
  btnConfirm.textContent = 'Save to Drive';

  const list = document.getElementById('modal-clips-list');
  list.innerHTML = '';
  state.clips.forEach(clip => {
    const item = document.createElement('div');
    item.className = 'modal-clip-item';
    item.dataset.id = clip.id;
    item.innerHTML = `
      <div class="modal-clip-thumb">
        <video src="${clip.url}" muted preload="metadata" playsinline></video>
        <div class="modal-clip-thumb-play" title="Preview clip">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="white"><path d="M4 2.5l9 5.5-9 5.5V2.5z"/></svg>
        </div>
      </div>
      <div class="modal-clip-info">
        <p class="modal-clip-name">${clip.name}</p>
        <p class="modal-clip-meta">${formatDuration(clip.duration)} · ${clip.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${formatSize(clip.size)}</p>
      </div>
      <div class="check-circle" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    `;

    // Selecting item on container click
    item.addEventListener('click', () => selectHighlight(clip.id));

    // Play preview on thumbnail click (avoiding selection toggle)
    const playOverlay = item.querySelector('.modal-clip-thumb-play');
    if (playOverlay) {
      playOverlay.addEventListener('click', (e) => {
        e.stopPropagation();
        playClip(clip.id);
      });
    }

    // Force frame thumbnail seek
    const videoEl = item.querySelector('.modal-clip-thumb video');
    if (videoEl) {
      videoEl.addEventListener('loadedmetadata', () => {
        videoEl.currentTime = 0.1;
      });
    }

    list.appendChild(item);
  });

  document.getElementById('modal-highlight').classList.add('open');
}

function selectHighlight(id) {
  const idx = state.selectedHighlightIds.indexOf(id);
  if (idx > -1) {
    state.selectedHighlightIds.splice(idx, 1);
  } else {
    state.selectedHighlightIds.push(id);
  }

  document.querySelectorAll('.modal-clip-item').forEach(el => {
    const cardId = parseInt(el.dataset.id);
    el.classList.toggle('selected', state.selectedHighlightIds.includes(cardId));
  });

  const btnConfirm = document.getElementById('btn-confirm-highlight');
  const count = state.selectedHighlightIds.length;
  if (count > 0) {
    btnConfirm.disabled = false;
    btnConfirm.textContent = `Save ${count} clip${count !== 1 ? 's' : ''} to Drive`;
  } else {
    btnConfirm.disabled = true;
    btnConfirm.textContent = 'Save to Drive';
  }
}

function closeHighlightPicker() {
  document.getElementById('modal-highlight').classList.remove('open');
  state.selectedHighlightIds = [];
}

async function saveHighlight() {
  if (state.selectedHighlightIds.length === 0) return;

  if (state.accessToken !== 'demo' && !navigator.onLine) {
    toast('You are offline. Please reconnect to save highlights to Google Drive.');
    return;
  }

  const selectedClips = state.clips.filter(c => state.selectedHighlightIds.includes(c.id));
  closeHighlightPicker();
  showUploadModal();

  try {
    const savedMemories = [];
    const totalClips = selectedClips.length;

    for (let i = 0; i < totalClips; i++) {
      const clip = selectedClips[i];
      const currentNum = i + 1;

      let driveId = null;
      if (state.accessToken !== 'demo') {
        driveId = await uploadToDrive(clip, currentNum, totalClips);
      } else {
        await simulateUpload(currentNum, totalClips);
      }

      const memory = {
        id: driveId || `demo_${Date.now()}_${i}`,
        name: clip.name,
        date: new Date(),
        driveId,
        url: clip.url,  // keep blob URL locally for immediate play
        blob: state.accessToken === 'demo' ? clip.blob : null, // save blob in demo mode for local persistence
        size: clip.size,
        duration: clip.duration,
      };
      savedMemories.push(memory);
    }

    // Discard other unselected clips
    state.clips.forEach(c => {
      if (!state.selectedHighlightIds.includes(c.id)) {
        URL.revokeObjectURL(c.url);
      }
    });

    // Save memories
    for (const memory of savedMemories) {
      state.memories.unshift(memory);
      if (state.accessToken === 'demo') {
        await DB.put('memories', memory);
      }
    }

    // Clean up current clips from state & database
    state.clips = [];
    await DB.clearStore('clips');

    hideUploadModal();
    renderClips();
    renderVault();
    updateRecordStats();
    toast(`${totalClips} memory clip${totalClips !== 1 ? 's' : ''} saved successfully ✓`);
    switchTab('vault');

  } catch (e) {
    hideUploadModal();
    toast('Upload failed — ' + (e.message || 'unknown error'));
  }
}

async function uploadToDrive(clip, currentNum = 1, totalClips = 1) {
  await ensureDriveFolder();

  const filterSuffix = clip.filter && clip.filter !== 'none' ? `_${clip.filter}` : '';
  const filename = `${formatDateForFile(clip.timestamp)}_highlight_${currentNum}${filterSuffix}.${clip.ext}`;
  setUploadProgress(10, `[${currentNum}/${totalClips}] Preparing ${clip.name}…`);

  const metadata = {
    name: filename,
    parents: [state.highlightsFolderId],
    description: `Daily highlight — ${clip.timestamp.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', clip.blob, filename);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id');
    xhr.setRequestHeader('Authorization', `Bearer ${state.accessToken}`);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 90) + 10;
        setUploadProgress(pct, `[${currentNum}/${totalClips}] Uploading: ${pct}%`);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const res = JSON.parse(xhr.responseText);
        setUploadProgress(100, `[${currentNum}/${totalClips}] Saved!`);
        resolve(res.id);
      } else {
        if (xhr.status === 401) {
          handleAuthError({ status: 401 });
          reject(new Error('Session expired. Please sign in again.'));
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(form);
  });
}

function simulateUpload(currentNum = 1, totalClips = 1) {
  return new Promise(resolve => {
    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(p + Math.random() * 20 + 5, 98);
      setUploadProgress(Math.round(p), `[${currentNum}/${totalClips}] Uploading: ${Math.round(p)}%`);
      if (p >= 98) {
        clearInterval(iv);
        setUploadProgress(100, `[${currentNum}/${totalClips}] Saved!`);
        setTimeout(resolve, 400);
      }
    }, 120);
  });
}

function setUploadProgress(pct, label) {
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
  document.getElementById('upload-sub').textContent = label;
}

function showUploadModal() {
  setUploadProgress(0, 'Preparing…');
  document.getElementById('modal-upload').classList.add('open');
  document.getElementById('modal-upload').style.pointerEvents = 'none';
}

function hideUploadModal() {
  document.getElementById('modal-upload').classList.remove('open');
}

// ── DRIVE FOLDER SETUP ─────────────────
async function ensureDriveFolder() {
  if (state.highlightsFolderId) return;

  // Use Shared Folder directly if in Shared Vault Mode
  if (state.activeVaultMode === 'shared' && state.sharedFolderId) {
    state.highlightsFolderId = state.sharedFolderId;
    return;
  }

  try {
    // Find or create root folder
    if (!state.folderId) {
      const res = await gapi.client.drive.files.list({
        q: `name='${CONFIG.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)',
      });
      if (res.result.files.length > 0) {
        state.folderId = res.result.files[0].id;
      } else {
        const created = await gapi.client.drive.files.create({
          resource: { name: CONFIG.FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
          fields: 'id',
        });
        state.folderId = created.result.id;
      }
    }

    // Find or create highlights subfolder
    const res2 = await gapi.client.drive.files.list({
      q: `name='${CONFIG.HIGHLIGHTS_FOLDER}' and '${state.folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });
    if (res2.result.files.length > 0) {
      state.highlightsFolderId = res2.result.files[0].id;
    } else {
      const created2 = await gapi.client.drive.files.create({
        resource: { name: CONFIG.HIGHLIGHTS_FOLDER, mimeType: 'application/vnd.google-apps.folder', parents: [state.folderId] },
        fields: 'id',
      });
      state.highlightsFolderId = created2.result.id;
    }
  } catch (e) {
    handleAuthError(e);
    throw e;
  }
}

async function loadMemories() {
  try {
    await ensureDriveFolder();
    const res = await gapi.client.drive.files.list({
      q: `'${state.highlightsFolderId}' in parents and trashed=false`,
      fields: 'files(id,name,createdTime,size,thumbnailLink,hasThumbnail)',
      orderBy: 'createdTime desc',
      pageSize: 100,
    });
    state.memories = res.result.files.map(f => ({
      id: f.id,
      name: f.name,
      date: new Date(f.createdTime),
      driveId: f.id,
      url: null,
      size: parseInt(f.size || 0),
      thumbnailLink: f.thumbnailLink,
      hasThumbnail: f.hasThumbnail,
      filter: parseFilterFromFilename(f.name),
    }));
    renderVault();
  } catch (e) {
    console.warn('Failed to load memories:', e);
    handleAuthError(e);
  }
}

async function loadDemoMemories() {
  try {
    const savedMemories = await DB.getStore('memories');
    if (savedMemories.length > 0) {
      state.memories = savedMemories.map(m => {
        m.date = new Date(m.date);
        if (m.blob) {
          m.url = URL.createObjectURL(m.blob);
        }
        return m;
      });
    } else {
      const dates = [5, 4, 3, 2, 1, 0].map(d => {
        const dt = new Date(); dt.setDate(dt.getDate() - d); return dt;
      });
      const filters = ['retro', 'noir', 'vivid', 'cyberpunk', 'none', 'none'];
      state.memories = dates.map((d, i) => {
        const filter = filters[i % filters.length];
        const filterSuffix = filter !== 'none' ? `_${filter}` : '';
        return {
          id: `demo_${i}`,
          name: `highlight_${formatDateForFile(d)}${filterSuffix}.webm`,
          date: d,
          driveId: null,
          url: null,
          size: Math.floor(Math.random() * 20 + 5) * 1024 * 1024,
          duration: Math.floor(Math.random() * 45 + 15),
          filter: filter
        };
      });
      for (const mem of state.memories) {
        await DB.put('memories', mem);
      }
    }
    renderVault();
  } catch (e) {
    console.warn('Failed to load mock demo memories:', e);
  }
}

// ── VAULT ──────────────────────────────
function renderVault() {
  const grid = document.getElementById('vault-grid');
  const empty = document.getElementById('vault-empty');

  // Calculate and display Daily highlight streaks
  calculateStreak();

  // Render Throwbacks & Flashbacks
  renderFlashback();

  document.getElementById('vault-count').textContent =
    state.memories.length === 0 ? '0 memories' :
      `${state.memories.length} memory${state.memories.length !== 1 ? ' entries' : ''}`;

  if (state.memories.length === 0) {
    grid.querySelectorAll('.vault-card').forEach(card => card.remove());
    if (empty) empty.style.display = 'flex';
    return;
  }

  if (empty) empty.style.display = 'none';
  grid.querySelectorAll('.vault-card').forEach(card => card.remove());

  state.memories.forEach((mem, i) => {
    const card = buildVaultCard(mem, i);
    grid.appendChild(card);
  });
}

function buildVaultCard(mem, index) {
  const card = document.createElement('div');
  card.className = 'vault-card';
  card.style.animationDelay = `${index * 50}ms`;

  const dateLabel = mem.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const durationLabel = mem.duration ? formatDuration(mem.duration) : '';

  const filterClass = mem.filter && mem.filter !== 'none' ? `filter-${mem.filter}` : '';
  let thumbContent = `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" style="opacity:0.25"><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" stroke="currentColor" stroke-width="1.5"/><path d="M20 11l6-4v14l-6-4v-6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

  if (mem.url) {
    thumbContent = `<video src="${mem.url}" class="${filterClass}" muted preload="metadata" playsinline></video>`;
  } else if (mem.thumbnailLink) {
    thumbContent = `<img src="${mem.thumbnailLink}" class="${filterClass}" alt="${dateLabel}" style="width:100%;height:100%;object-fit:cover;">`;
  }

  card.innerHTML = `
    <div class="vault-thumb">
      ${thumbContent}
      ${durationLabel ? `<div class="clip-duration-badge">${durationLabel}</div>` : ''}
    </div>
    <div class="vault-body">
      <p class="vault-date">${dateLabel}</p>
      <p class="vault-label">Daily highlight</p>
      <p class="vault-size">${formatSize(mem.size)}</p>
    </div>
  `;

  card.addEventListener('click', () => {
    if (mem.url) {
      openPlayback(mem.url, dateLabel, formatSize(mem.size), mem.filter);
    } else if (mem.driveId && state.accessToken !== 'demo') {
      fetchAndPlayDrive(mem);
    } else {
      toast('Preview not available in demo mode');
    }
  });

  const videoEl = card.querySelector('.vault-thumb video');
  if (videoEl) {
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.currentTime = 0.1;
    });
  }

  return card;
}

async function fetchAndPlayDrive(mem) {
  toast('Loading from Drive…');
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${mem.driveId}?alt=media`,
      { headers: { Authorization: `Bearer ${state.accessToken}` } }
    );
    if (!res.ok) {
      if (res.status === 401) {
        handleAuthError({ status: 401 });
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    mem.url = URL.createObjectURL(blob);
    openPlayback(mem.url, mem.date.toLocaleDateString(), formatSize(mem.size), mem.filter);
  } catch (e) {
    toast('Failed to load video — ' + e.message);
  }
}

// ── PLAYBACK ───────────────────────────
function openPlayback(url, title, meta, filter = 'none') {
  const vid = document.getElementById('playback-video');
  vid.src = url;
  
  // Clear any existing filter classes
  vid.className = '';
  if (filter && filter !== 'none') {
    vid.classList.add(`filter-${filter}`);
  }
  
  document.getElementById('playback-title').textContent = title;
  document.getElementById('playback-meta').textContent = meta;
  document.getElementById('modal-playback').classList.add('open');
}

function closePlayback() {
  const vid = document.getElementById('playback-video');
  vid.pause();
  vid.src = '';
  vid.className = ''; // Clear filter classes
  document.getElementById('modal-playback').classList.remove('open');
}

// ── NAVIGATION ─────────────────────────
async function switchTab(name) {
  if (state.isRecording) {
    toast('Cannot switch tabs while recording');
    return;
  }

  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(n => n.classList.remove('active'));
  
  document.getElementById(`tab-${name}`).classList.add('active');
  
  const desktopNavItem = document.querySelector(`.nav-item[data-tab="${name}"]`);
  if (desktopNavItem) desktopNavItem.classList.add('active');

  const mobileNavItem = document.querySelector(`.mobile-nav-item[data-tab="${name}"]`);
  if (mobileNavItem) mobileNavItem.classList.add('active');
  
  const titles = { record: 'Record', today: "Today's clips", vault: 'Memory vault' };
  document.getElementById('topbar-title').textContent = titles[name] || name;

  // Handle camera resources dynamically
  if (name === 'record') {
    await initCamera();
  } else {
    stopStream();
    const idle = document.getElementById('camera-idle');
    if (idle) {
      idle.style.opacity = '1';
      if (idle.querySelector('p')) {
        idle.querySelector('p').textContent = 'Camera ready';
      }
    }
    const vid = document.getElementById('video-preview');
    if (vid) vid.style.display = 'none';
  }

  // Auto-close sidebar on mobile
  if (window.innerWidth <= 700) {
    state.sidebarOpen = false;
    document.getElementById('sidebar').classList.add('hidden');
  }
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  document.getElementById('sidebar').classList.toggle('hidden', !state.sidebarOpen);
}

// ── MODAL HELPERS ──────────────────────
function closeModal(e) {
  if (e.target === e.currentTarget) {
    closeHighlightPicker();
    closePlayback();
  }
}

// ── TOAST ──────────────────────────────
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function handleAuthError(err) {
  if (!err) return;
  const status = err.status || (err.result && err.result.error && err.result.error.code);
  if (status === 401) {
    toast('Session expired. Please sign in again.');
    signOut();
  }
}

// ── UTILS ──────────────────────────────
function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateForFile(date) {
  return date.toISOString().split('T')[0];
}

// ── MOBILE DROPDOWN HELPERS ─────────────
function toggleUserDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('user-dropdown');
  if (dropdown) dropdown.classList.toggle('open');
}

// Close mobile dropdown when clicking outside
window.addEventListener('click', () => {
  const dropdown = document.getElementById('user-dropdown');
  if (dropdown) dropdown.classList.remove('open');
});

// ── FILENAME FILTER PARSER ──────────────
function parseFilterFromFilename(filename) {
  if (!filename) return 'none';
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
  const parts = nameWithoutExt.split('_');
  if (parts.length > 0) {
    const lastPart = parts[parts.length - 1];
    const validFilters = ['retro', 'noir', 'vivid', 'cyberpunk'];
    if (validFilters.includes(lastPart)) return lastPart;
  }
  return 'none';
}

// ── STREAK SYSTEM LOGIC ─────────────────
function calculateStreak() {
  if (state.memories.length === 0) {
    state.streakCount = 0;
    updateStreakUI();
    return;
  }

  // Get unique sorted dates in local timezone (YYYY-MM-DD)
  const uniqueDates = Array.from(new Set(state.memories.map(m => {
    const d = new Date(m.date);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }))).sort((a, b) => b.localeCompare(a)); // Descending sorted dates (newest first)

  if (uniqueDates.length === 0) {
    state.streakCount = 0;
    updateStreakUI();
    return;
  }

  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  
  // Calculate yesterday's date string
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');

  const newestDate = uniqueDates[0];
  
  // If the newest highlight is older than yesterday, the streak is broken (0)
  if (newestDate !== todayStr && newestDate !== yesterdayStr) {
    state.streakCount = 0;
    updateStreakUI();
    return;
  }

  // Count consecutive days
  let streak = 0;
  let currentDate = new Date(newestDate);

  for (let i = 0; i < uniqueDates.length; i++) {
    const dateStr = uniqueDates[i];
    const compareStr = currentDate.getFullYear() + '-' + String(currentDate.getMonth() + 1).padStart(2, '0') + '-' + String(currentDate.getDate()).padStart(2, '0');

    if (dateStr === compareStr) {
      streak++;
      // Move to yesterday for the next comparison
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      // Gap in consecutive days, streak calculation stops
      break;
    }
  }

  state.streakCount = streak;
  updateStreakUI();
}

function updateStreakUI() {
  const count = state.streakCount;
  
  // Topbar Streak
  const topStreak = document.getElementById('topbar-streak');
  const streakCountEl = document.getElementById('streak-count');
  if (count > 0) {
    if (streakCountEl) streakCountEl.textContent = count;
    if (topStreak) topStreak.style.display = 'inline-flex';
  } else {
    if (topStreak) topStreak.style.display = 'none';
  }

  // Sidebar Streak
  const sidebarStreak = document.getElementById('sidebar-streak-card');
  const sidebarCountEl = document.getElementById('sidebar-streak-count');
  if (count > 0) {
    if (sidebarCountEl) sidebarCountEl.textContent = `${count} day${count !== 1 ? 's' : ''}`;
    if (sidebarStreak) sidebarStreak.style.display = 'flex';
  } else {
    if (sidebarStreak) sidebarStreak.style.display = 'none';
  }
}

// ── VAULT SETTINGS PANEL ─────────────────
function openSettings() {
  const mode = state.activeVaultMode;
  const folderId = state.sharedFolderId;

  const folderInput = document.getElementById('input-shared-folder-id');
  if (folderInput) folderInput.value = folderId;
  
  setVaultMode(mode);

  const modal = document.getElementById('modal-settings');
  if (modal) modal.classList.add('open');
}

function closeSettings() {
  const modal = document.getElementById('modal-settings');
  if (modal) modal.classList.remove('open');
}

function setVaultMode(mode) {
  state.activeVaultMode = mode;
  
  // Toggle active classes
  const btnPersonal = document.getElementById('btn-vault-personal');
  const btnShared = document.getElementById('btn-vault-shared');
  const sharedInputGroup = document.getElementById('shared-folder-input-group');
  
  if (mode === 'personal') {
    if (btnPersonal) {
      btnPersonal.classList.add('active');
      btnPersonal.style.background = 'var(--surface3)';
      btnPersonal.style.color = 'var(--text)';
    }
    if (btnShared) {
      btnShared.classList.remove('active');
      btnShared.style.background = 'transparent';
      btnShared.style.color = 'var(--text-muted)';
    }
    if (sharedInputGroup) sharedInputGroup.style.display = 'none';
  } else {
    if (btnShared) {
      btnShared.classList.add('active');
      btnShared.style.background = 'var(--surface3)';
      btnShared.style.color = 'var(--text)';
    }
    if (btnPersonal) {
      btnPersonal.classList.remove('active');
      btnPersonal.style.background = 'transparent';
      btnPersonal.style.color = 'var(--text-muted)';
    }
    if (sharedInputGroup) sharedInputGroup.style.display = 'block';
  }
}

async function saveSettings() {
  const folderInput = document.getElementById('input-shared-folder-id');
  const folderIdInput = folderInput ? folderInput.value.trim() : '';
  
  // Extract folder ID if they pasted a link
  let extractedId = folderIdInput;
  if (folderIdInput.includes('drive.google.com') && folderIdInput.includes('folders/')) {
    const match = folderIdInput.match(/folders\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      extractedId = match[1];
    }
  }
  
  state.sharedFolderId = extractedId;
  localStorage.setItem('memoire_vault_mode', state.activeVaultMode);
  localStorage.setItem('memoire_shared_folder_id', extractedId);
  
  // Reset Drive folder cache so it re-resolves using the new settings
  state.folderId = null;
  state.highlightsFolderId = null;
  
  closeSettings();
  toast('Settings saved successfully ✓');
  
  // Reload memories to show new vault content
  if (state.accessToken && state.accessToken !== 'demo') {
    await loadMemories();
  } else if (state.accessToken === 'demo') {
    renderVault();
  }
}

// ── VAULT FLASHBACKS & THROWBACKS ────────
function renderFlashback() {
  const container = document.getElementById('flashback-container');
  if (!container) return;
  container.innerHTML = '';
  
  if (state.memories.length === 0) return;
  
  // Sort memories newest first
  const memories = [...state.memories].sort((a, b) => b.date - a.date);
  
  // Find a flashback matching our criteria
  const today = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  
  let flashbackMemory = null;
  let flashbackTag = 'Throwback';
  let flashbackSub = 'Relive this moment from your vault.';
  
  for (const mem of memories) {
    const memDate = new Date(mem.date);
    const diffMs = Math.abs(today - memDate);
    const diffDays = Math.round(diffMs / oneDayMs);
    
    // Check 1 year flashback (or exactly N years)
    const sameMonth = today.getMonth() === memDate.getMonth();
    const sameDay = today.getDate() === memDate.getDate();
    const diffYears = today.getFullYear() - memDate.getFullYear();
    
    if (sameMonth && sameDay && diffYears > 0) {
      flashbackMemory = mem;
      flashbackTag = `${diffYears} Year Flashback`;
      flashbackSub = `Exactly ${diffYears} year${diffYears > 1 ? 's' : ''} ago today: reliving this highlight!`;
      break;
    }
    
    // Check 30 days flashback
    if (diffDays === 30) {
      flashbackMemory = mem;
      flashbackTag = '1 Month Flashback';
      flashbackSub = 'Relive this highlight from exactly one month ago today.';
      break;
    }
    
    // Check 7 days flashback
    if (diffDays === 7) {
      flashbackMemory = mem;
      flashbackTag = 'Weekly Flashback';
      flashbackSub = 'Relive your highlight from exactly one week ago today.';
      break;
    }
  }
  
  // If no specific anniversary matches, pick a random memory older than 3 days as a throwback
  if (!flashbackMemory) {
    const olderMemories = memories.filter(mem => {
      const diffMs = Math.abs(today - new Date(mem.date));
      return Math.round(diffMs / oneDayMs) >= 3;
    });
    
    if (olderMemories.length > 0) {
      flashbackMemory = olderMemories[Math.floor(Math.random() * olderMemories.length)];
      flashbackTag = 'Throwback';
      const ageInDays = Math.round(Math.abs(today - new Date(flashbackMemory.date)) / oneDayMs);
      flashbackSub = `Reliving a highlight from ${ageInDays} days ago in your vault.`;
    }
  }
  
  if (!flashbackMemory) return; // No memories old enough yet
  
  const dateLabel = flashbackMemory.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  
  const card = document.createElement('div');
  card.className = 'flashback-card';
  card.innerHTML = `
    <div class="flashback-body">
      <span class="flashback-tag">${flashbackTag}</span>
      <h3 class="flashback-title">${dateLabel}</h3>
      <p class="flashback-sub">${flashbackSub}</p>
    </div>
    <div class="flashback-actions">
      <button class="btn-flashback-play" title="Play Flashback" aria-label="Play Flashback">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" style="margin-left:2px;"><path d="M4 2.5l11 6.5-11 6.5V2.5z"/></svg>
      </button>
    </div>
  `;
  
  card.querySelector('.btn-flashback-play').addEventListener('click', () => {
    if (flashbackMemory.url) {
      openPlayback(flashbackMemory.url, dateLabel, formatSize(flashbackMemory.size), flashbackMemory.filter);
    } else if (flashbackMemory.driveId && state.accessToken !== 'demo') {
      fetchAndPlayDrive(flashbackMemory);
    } else {
      toast('Preview not available');
    }
  });
  
  container.appendChild(card);
}
