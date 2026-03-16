/**
 * BabyKeyPlay — Main Application Controller
 * Orchestrates GPU particles, audio, neon trails, UI, and multiplayer
 */

(() => {
  'use strict';

  // ── DOM Refs ──
  const gpuCanvas = document.getElementById('gpu-canvas');
  const trailCanvas = document.getElementById('trail-canvas');
  const uiCanvas = document.getElementById('ui-canvas');
  const welcomeOverlay = document.getElementById('welcome-overlay');
  const startBtn = document.getElementById('start-btn');
  const parentPanel = document.getElementById('parent-panel');
  const fpsCounter = document.getElementById('fps-counter');
  const fpsValue = document.getElementById('fps-value');
  const particleCountEl = document.getElementById('particle-count');
  const comboDisplay = document.getElementById('combo-display');
  const comboNumber = document.getElementById('combo-number');
  const multiplayerHud = document.getElementById('multiplayer-hud');
  const hudRoomCode = document.getElementById('hud-room-code');
  const hudPlayerCount = document.getElementById('hud-player-count');
  const hudCombo = document.getElementById('hud-combo');
  const installPrompt = document.getElementById('install-prompt');
  const installBtn = document.getElementById('install-btn');
  const multiSetup = document.getElementById('multi-setup');
  const multiStatus = document.getElementById('multi-status');

  if (!gpuCanvas || !trailCanvas || !uiCanvas) return;

  const trailCtx = trailCanvas.getContext('2d', { alpha: true });
  const uiCtx = uiCanvas.getContext('2d', { alpha: true });
  if (!trailCtx || !uiCtx) return;

  // ── State ──
  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    theme: 'cyber',
    running: false,
    welcomeVisible: true,
    panelOpen: false,
    pointerDown: false,
    pointerId: null,
    lastTrailPoint: null,
    trailCooldownUntil: 0,
    lastInputAt: performance.now(),
    lastIdleAt: performance.now(),
    lastFrameTime: performance.now(),
    fpsSamples: [],
    lastFpsCheck: performance.now(),
    showFps: false,

    // Settings
    musicEnabled: true,
    sfxEnabled: true,
    trailsEnabled: true,
    reduceMotion: false,
    emojiMode: false,
    density: 'high',
    idleDemo: true,

    // Long press
    longPressTimer: null,
    longPressStart: null,

    // Glyphs
    glyphs: [],
    emojiBag: [],
    lastEmoji: null,

    // Neon trails
    trails: [],
    trailFadeTimer: 0,

    // Combo
    comboCount: 0,
    comboShowUntil: 0,

    // Key buffer
    keyBuffer: [],

    // Multiplayer
    multiMode: false,

    // PWA
    deferredInstallPrompt: null
  };

  const LONG_PRESS_MS = 2000;
  const LONG_PRESS_CORNER = 64;
  const IDLE_START_MS = 3000;
  const IDLE_EMIT_MS = 800;

  const EMOJI_POOL = [
    '🚀', '⭐', '🌈', '🦋', '🎈', '🪐', '🎸', '🦄', '🐬', '🌸',
    '🎪', '💎', '🔥', '❄️', '🌙', '🎯', '🏆', '🎵', '🍭', '🎨'
  ];

  const BLOCKED_KEYS = new Set([
    'Tab', 'Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
    'F7', 'F8', 'F9', 'F10', 'F12'
  ]);

  const GLYPH_COLORS = {
    cyber: ['#0ff', '#f0f', '#ff0', '#0f6', '#88f'],
    aurora: ['#0f6', '#06f', '#0fa', '#5f8', '#08f'],
    lava: ['#f80', '#f20', '#fa0', '#f44', '#f62'],
    cosmic: ['#a0f', '#f60', '#48f', '#f28', '#ff4'],
    ocean: ['#0af', '#0fa', '#4cf', '#0e7', '#6af'],
    candy: ['#f48', '#fa2', '#84f', '#f6a', '#4e6']
  };

  // ── Initialization ──
  initApp();

  function initApp() {
    resize();

    // Init GPU particle system
    const gpuReady = GPUParticles.init(gpuCanvas, {
      theme: state.theme,
      density: state.density
    });

    if (gpuReady) {
      GPUParticles.resize(state.width, state.height, state.dpr);
    }

    bindEvents();
    bindPanelEvents();
    bindWelcomeEvents();
    bindPWA();

    requestAnimationFrame(tick);
  }

  function bindEvents() {
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('orientationchange', resize, { passive: true });

    uiCanvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    uiCanvas.addEventListener('pointermove', onPointerMove, { passive: false });
    uiCanvas.addEventListener('pointerup', onPointerUp, { passive: false });
    uiCanvas.addEventListener('pointercancel', onPointerUp, { passive: false });
    uiCanvas.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('keydown', onKeyDown, { passive: false });

    document.addEventListener('visibilitychange', () => {
      state.lastFrameTime = performance.now();
      state.lastInputAt = performance.now();
    });

    // Prevent pointer capture issues
    window.addEventListener('pointerup', endPointer, { passive: true });
    window.addEventListener('pointercancel', endPointer, { passive: true });
  }

  function bindPanelEvents() {
    const musicToggle = document.getElementById('music-toggle');
    const sfxToggle = document.getElementById('sfx-toggle');
    const trailsToggle = document.getElementById('trails-toggle');
    const themeSelect = document.getElementById('theme-select');
    const densitySelect = document.getElementById('density-select');
    const motionToggle = document.getElementById('motion-toggle');
    const emojiToggle = document.getElementById('emoji-toggle');
    const fpsToggle = document.getElementById('fps-toggle');
    const exitFsBtn = document.getElementById('exit-fs-btn');
    const closePanelBtn = document.getElementById('close-panel-btn');

    const stopProp = e => e.stopPropagation();
    parentPanel.addEventListener('pointerdown', stopProp);

    if (musicToggle) {
      musicToggle.checked = state.musicEnabled;
      musicToggle.addEventListener('change', () => {
        state.musicEnabled = musicToggle.checked;
        AudioEngine.setMusicEnabled(state.musicEnabled);
      });
    }

    if (sfxToggle) {
      sfxToggle.checked = state.sfxEnabled;
      sfxToggle.addEventListener('change', () => {
        state.sfxEnabled = sfxToggle.checked;
        AudioEngine.setSfxEnabled(state.sfxEnabled);
      });
    }

    if (trailsToggle) {
      trailsToggle.checked = state.trailsEnabled;
      trailsToggle.addEventListener('change', () => {
        state.trailsEnabled = trailsToggle.checked;
      });
    }

    if (themeSelect) {
      themeSelect.value = state.theme;
      themeSelect.addEventListener('change', () => {
        setTheme(themeSelect.value);
      });
    }

    if (densitySelect) {
      densitySelect.value = state.density;
      densitySelect.addEventListener('change', () => {
        state.density = densitySelect.value;
        GPUParticles.setDensity(state.density);
      });
    }

    if (motionToggle) {
      motionToggle.addEventListener('change', () => {
        state.reduceMotion = motionToggle.checked;
        GPUParticles.setReduceMotion(state.reduceMotion);
      });
    }

    if (emojiToggle) {
      emojiToggle.addEventListener('change', () => {
        state.emojiMode = emojiToggle.checked;
      });
    }

    if (fpsToggle) {
      fpsToggle.addEventListener('change', () => {
        state.showFps = fpsToggle.checked;
        fpsCounter.classList.toggle('visible', state.showFps);
      });
    }

    if (exitFsBtn) {
      exitFsBtn.addEventListener('click', () => {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) {
          try { exit.call(document); } catch (e) {}
        }
      });
    }

    if (closePanelBtn) {
      closePanelBtn.addEventListener('click', closePanel);
    }
  }

  function bindWelcomeEvents() {
    if (startBtn) {
      startBtn.addEventListener('click', e => {
        e.preventDefault();
        startGame();
      });
    }

    // Mode selection
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const mode = btn.dataset.mode;
        state.multiMode = mode === 'multi';
        if (multiSetup) multiSetup.hidden = !state.multiMode;
      });
    });

    // Theme previews
    document.querySelectorAll('.theme-preview').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.theme-preview').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setTheme(btn.dataset.theme);
      });
    });

    // Multiplayer buttons
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const roomCodeInput = document.getElementById('room-code-input');

    if (createRoomBtn) {
      createRoomBtn.addEventListener('click', e => {
        e.stopPropagation();
        const code = Multiplayer.createRoom({
          onRemoteEvent: handleRemoteEvent,
          onComboUpdate: updateCombo
        });
        setMultiStatus(`Room created: ${code}. Share this code!`);
      });
    }

    if (joinRoomBtn && roomCodeInput) {
      joinRoomBtn.addEventListener('click', e => {
        e.stopPropagation();
        const code = roomCodeInput.value.trim();
        if (code.length < 3) {
          setMultiStatus('Enter a valid room code');
          return;
        }
        Multiplayer.joinRoom(code, {
          onRemoteEvent: handleRemoteEvent,
          onComboUpdate: updateCombo
        });
        setMultiStatus(`Joining room ${code}...`);
      });
    }

    // Welcome overlay click to start
    if (welcomeOverlay) {
      welcomeOverlay.addEventListener('click', e => {
        if (e.target.closest('[data-no-start], button, input, select, a')) return;
        startGame();
      });
    }
  }

  function bindPWA() {
    // Service Worker registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Install prompt
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      if (installPrompt) installPrompt.hidden = false;
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!state.deferredInstallPrompt) return;
        state.deferredInstallPrompt.prompt();
        const result = await state.deferredInstallPrompt.userChoice;
        state.deferredInstallPrompt = null;
        if (installPrompt) installPrompt.hidden = true;
      });
    }
  }

  // ── Game Control ──

  function startGame() {
    dismissWelcome();
    tryFullscreen();

    if (AudioEngine.init()) {
      AudioEngine.resume();
      if (state.musicEnabled) {
        AudioEngine.startMusic();
      }
    }

    state.running = true;
    markInput();

    // Initial burst
    spawnBurst(state.width / 2, state.height / 2, 1.0);
  }

  function dismissWelcome() {
    if (!state.welcomeVisible || !welcomeOverlay) return;
    state.welcomeVisible = false;
    welcomeOverlay.hidden = true;
    welcomeOverlay.setAttribute('aria-hidden', 'true');

    if (Multiplayer.isActive()) {
      if (multiplayerHud) {
        multiplayerHud.hidden = false;
        multiplayerHud.setAttribute('aria-hidden', 'false');
        updateHud();
      }
    }
  }

  function tryFullscreen() {
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request || document.fullscreenElement) return;
    try {
      const result = request.call(root);
      if (result && result.catch) result.catch(() => {});
    } catch (e) {}
  }

  function openPanel() {
    if (state.panelOpen) return;
    state.panelOpen = true;
    parentPanel.hidden = false;
    parentPanel.setAttribute('aria-hidden', 'false');
    state.pointerDown = false;
  }

  function closePanel() {
    if (!state.panelOpen) return;
    state.panelOpen = false;
    parentPanel.hidden = true;
    parentPanel.setAttribute('aria-hidden', 'true');
    markInput();
  }

  function setTheme(newTheme) {
    if (!GPUParticles.THEMES[newTheme]) return;
    state.theme = newTheme;
    GPUParticles.setTheme(newTheme);

    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.value = newTheme;
  }

  function setMultiStatus(message) {
    if (multiStatus) multiStatus.textContent = message;
  }

  // ── Input Handlers ──

  function onPointerDown(event) {
    if (event.button && event.button !== 0) return;
    event.preventDefault();

    if (!state.running) {
      startGame();
    }

    state.pointerDown = true;
    state.pointerId = event.pointerId;
    markInput();

    maybeStartLongPress(event.clientX, event.clientY, event.pointerId);

    const x = event.clientX;
    const y = event.clientY;
    spawnBurst(x, y, 1.0);
  }

  function onPointerMove(event) {
    if (state.panelOpen) return;

    const isDrag = state.pointerDown && event.pointerId === state.pointerId;
    const isHover = !state.pointerDown && event.pointerType === 'mouse';
    if (!isDrag && !isHover) return;

    if (isDrag) {
      event.preventDefault();
      checkLongPressMove(event.clientX, event.clientY);
    }

    const now = performance.now();
    if (now < state.trailCooldownUntil) return;

    const x = event.clientX;
    const y = event.clientY;
    markInput();

    const prev = state.lastTrailPoint;
    const dx = prev ? x - prev.x : 0;
    const dy = prev ? y - prev.y : 0;
    state.lastTrailPoint = { x, y };

    // GPU trail particles
    GPUParticles.spawnTrail(x, y, dx, dy);

    // Neon canvas trail
    if (state.trailsEnabled && prev) {
      addNeonTrail(prev.x, prev.y, x, y);
    }

    if (isDrag) {
      spawnBurst(x, y, 0.3);
    }

    state.trailCooldownUntil = now + (isHover ? 30 : 45);

    // Multiplayer broadcast
    if (Multiplayer.isActive()) {
      Multiplayer.sendEvent({ type: 'trail', x, y, dx, dy });
    }
  }

  function onPointerUp(event) {
    endPointer(event);
  }

  function endPointer(event) {
    if (event && event.pointerId !== state.pointerId) return;
    state.pointerDown = false;
    state.pointerId = null;
    state.lastTrailPoint = null;
    cancelLongPress();
  }

  function onKeyDown(event) {
    if (isPanelTarget(event.target)) return;

    handleParentWord(event.key);

    if (state.panelOpen) {
      if (event.key === 'Escape') closePanel();
      return;
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!state.running) startGame();
    }

    if (shouldBlockKey(event)) {
      event.preventDefault();
    }

    markInput();

    const x = Math.random() * state.width;
    const y = Math.random() * state.height;
    spawnBurst(x, y, 0.8);

    const glyph = pickGlyph(event.key);
    if (glyph) {
      spawnGlyph(x, y, glyph);
      AudioEngine.playKeySfx(event.key);
    } else {
      AudioEngine.playBurstSfx(x, y, state.width, state.height);
    }

    // Multiplayer
    if (Multiplayer.isActive()) {
      Multiplayer.sendEvent({ type: 'key', x, y, key: event.key });
    }
  }

  function isPanelTarget(target) {
    return parentPanel && parentPanel.contains(target);
  }

  function shouldBlockKey(event) {
    if (event.key === 'F11') return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return true;
    return BLOCKED_KEYS.has(event.key);
  }

  // ── Long Press ──

  function maybeStartLongPress(clientX, clientY, pointerId) {
    if (state.panelOpen || clientX > LONG_PRESS_CORNER || clientY > LONG_PRESS_CORNER) return;

    state.longPressStart = { x: clientX, y: clientY, pointerId };
    state.longPressTimer = setTimeout(() => {
      state.longPressTimer = null;
      if (state.pointerDown && state.longPressStart) {
        openPanel();
      }
    }, LONG_PRESS_MS);
  }

  function checkLongPressMove(x, y) {
    if (!state.longPressStart) return;
    const dx = x - state.longPressStart.x;
    const dy = y - state.longPressStart.y;
    if (dx * dx + dy * dy > 196) cancelLongPress();
  }

  function cancelLongPress() {
    state.longPressStart = null;
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
  }

  function handleParentWord(key) {
    if (typeof key !== 'string' || key.length !== 1 || !/[a-z]/i.test(key)) return;
    const now = performance.now();
    state.keyBuffer.push({ key: key.toLowerCase(), time: now });
    state.keyBuffer = state.keyBuffer.filter(e => now - e.time < 4000);
    if (state.keyBuffer.map(e => e.key).join('').endsWith('parent')) {
      openPanel();
      state.keyBuffer = [];
    }
  }

  // ── Spawning ──

  function spawnBurst(x, y, strength, isIdle) {
    GPUParticles.spawnBurst(x, y, strength, { idle: Boolean(isIdle) });

    if (!isIdle) {
      AudioEngine.playBurstSfx(x, y, state.width, state.height);
    }

    // Screen flash on neon canvas
    if (strength > 0.7 && !state.reduceMotion) {
      flashScreen(x, y);
    }
  }

  function spawnGlyph(x, y, glyph) {
    const colors = GLYPH_COLORS[state.theme] || GLYPH_COLORS.cyber;
    const size = 60 + Math.random() * 100;
    const isEmoji = !/^[A-Z0-9]$/.test(glyph);

    state.glyphs.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 50,
      vy: -40 - Math.random() * 50,
      text: glyph,
      size,
      age: 0,
      life: 1.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      isEmoji,
      sprite: isEmoji ? createEmojiSprite(glyph, size) : null
    });

    if (state.glyphs.length > 40) {
      state.glyphs.splice(0, state.glyphs.length - 40);
    }
  }

  function createEmojiSprite(text, size) {
    const side = Math.round(size * 1.8);
    const c = document.createElement('canvas');
    c.width = side;
    c.height = side;
    const sctx = c.getContext('2d');
    if (!sctx) return null;
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    sctx.fillText(text, side / 2, side / 2);
    return c;
  }

  function pickGlyph(key) {
    if (state.emojiMode) return pickEmoji();
    if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
    return pickEmoji();
  }

  function pickEmoji() {
    if (!state.emojiBag.length) {
      state.emojiBag = shuffle(EMOJI_POOL.slice());
    }
    const e = state.emojiBag.pop();
    state.lastEmoji = e;
    return e;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── Neon Trail Rendering ──

  function addNeonTrail(x1, y1, x2, y2) {
    const colors = GLYPH_COLORS[state.theme] || GLYPH_COLORS.cyber;
    state.trails.push({
      x1, y1, x2, y2,
      color: colors[Math.floor(Math.random() * colors.length)],
      age: 0,
      life: 0.6,
      width: 2 + Math.random() * 4
    });

    if (state.trails.length > 200) {
      state.trails.splice(0, state.trails.length - 200);
    }
  }

  function flashScreen(x, y) {
    const colors = GLYPH_COLORS[state.theme] || GLYPH_COLORS.cyber;
    const color = colors[Math.floor(Math.random() * colors.length)];

    trailCtx.save();
    trailCtx.globalAlpha = 0.08;
    trailCtx.fillStyle = color;
    trailCtx.beginPath();
    trailCtx.arc(x, y, Math.max(state.width, state.height) * 0.5, 0, Math.PI * 2);
    trailCtx.fill();
    trailCtx.restore();
  }

  // ── Multiplayer Handlers ──

  function handleRemoteEvent(event) {
    if (!event) return;

    if (event.type === 'trail') {
      GPUParticles.spawnTrail(event.x, event.y, event.dx, event.dy);
      if (state.trailsEnabled) {
        const prev = { x: event.x - event.dx, y: event.y - event.dy };
        addNeonTrail(prev.x, prev.y, event.x, event.y);
      }
    } else if (event.type === 'key') {
      GPUParticles.spawnBurst(event.x, event.y, 0.6);
      const glyph = pickGlyph(event.key);
      if (glyph) spawnGlyph(event.x, event.y, glyph);
    }
  }

  function updateCombo(count) {
    state.comboCount = count;

    if (count > 0) {
      state.comboShowUntil = performance.now() + 2500;
      if (comboNumber) comboNumber.textContent = count;
      if (comboDisplay) comboDisplay.classList.add('active');
      comboDisplay.hidden = false;
    }
  }

  function updateHud() {
    if (hudRoomCode) hudRoomCode.textContent = Multiplayer.getRoomCode();
    if (hudPlayerCount) hudPlayerCount.textContent = Multiplayer.getPlayerCount();
    if (hudCombo) hudCombo.textContent = state.comboCount;
  }

  // ── Main Loop ──

  function tick(timestamp) {
    const dt = Math.min(0.05, Math.max(0.001, (timestamp - state.lastFrameTime) / 1000));
    state.lastFrameTime = timestamp;

    // FPS tracking
    trackFps(dt, timestamp);

    // Idle demo
    if (state.running && state.idleDemo && !state.panelOpen) {
      const idleElapsed = timestamp - state.lastInputAt;
      if (idleElapsed > IDLE_START_MS && timestamp - state.lastIdleAt > IDLE_EMIT_MS) {
        const x = Math.random() * state.width;
        const y = Math.random() * state.height;
        spawnBurst(x, y, 0.3, true);
        state.lastIdleAt = timestamp;
      }
    }

    // Multiplayer combo decay
    if (Multiplayer.isActive()) {
      Multiplayer.updateCombo();
      updateHud();
    }

    // Combo display timeout
    if (comboDisplay && timestamp > state.comboShowUntil) {
      comboDisplay.classList.remove('active');
    }

    // GPU particles
    GPUParticles.update(dt);
    GPUParticles.render();

    // Trail canvas
    drawTrails(dt);

    // UI canvas (glyphs)
    drawUI(dt);

    requestAnimationFrame(tick);
  }

  function trackFps(dt, timestamp) {
    state.fpsSamples.push(1 / dt);
    if (state.fpsSamples.length > 60) state.fpsSamples.shift();

    if (timestamp - state.lastFpsCheck > 500) {
      const avg = state.fpsSamples.reduce((a, b) => a + b, 0) / state.fpsSamples.length;
      if (fpsValue) fpsValue.textContent = Math.round(avg);
      if (particleCountEl) particleCountEl.textContent = formatNumber(GPUParticles.getActiveCount());
      state.lastFpsCheck = timestamp;
    }
  }

  function drawTrails(dt) {
    // Fade existing trails
    trailCtx.save();
    trailCtx.globalCompositeOperation = 'destination-out';
    const fadeRate = state.reduceMotion ? 0.15 : 0.06;
    trailCtx.fillStyle = `rgba(0, 0, 0, ${fadeRate})`;
    trailCtx.fillRect(0, 0, state.width, state.height);
    trailCtx.restore();

    // Draw active trails
    for (let i = state.trails.length - 1; i >= 0; i--) {
      const trail = state.trails[i];
      trail.age += dt;

      if (trail.age >= trail.life) {
        state.trails.splice(i, 1);
        continue;
      }

      const alpha = 1 - trail.age / trail.life;

      // Outer glow
      trailCtx.save();
      trailCtx.globalCompositeOperation = 'lighter';
      trailCtx.strokeStyle = trail.color;
      trailCtx.lineWidth = trail.width * 3;
      trailCtx.globalAlpha = alpha * 0.2;
      trailCtx.shadowColor = trail.color;
      trailCtx.shadowBlur = 20;
      trailCtx.beginPath();
      trailCtx.moveTo(trail.x1, trail.y1);
      trailCtx.lineTo(trail.x2, trail.y2);
      trailCtx.stroke();

      // Core
      trailCtx.lineWidth = trail.width;
      trailCtx.globalAlpha = alpha * 0.8;
      trailCtx.shadowBlur = 10;
      trailCtx.stroke();

      // Bright center
      trailCtx.lineWidth = Math.max(1, trail.width * 0.3);
      trailCtx.globalAlpha = alpha;
      trailCtx.strokeStyle = '#fff';
      trailCtx.shadowBlur = 5;
      trailCtx.stroke();

      trailCtx.restore();
    }
  }

  function drawUI(dt) {
    uiCtx.clearRect(0, 0, state.width, state.height);

    // Draw glyphs
    for (let i = state.glyphs.length - 1; i >= 0; i--) {
      const g = state.glyphs[i];
      g.age += dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.vy += 10 * dt;
      g.vx *= 0.995;

      if (g.age >= g.life) {
        state.glyphs.splice(i, 1);
        continue;
      }

      const alpha = Math.max(0, 1 - g.age / g.life);
      const scale = 0.9 + alpha * 0.1;
      const size = g.size * scale;

      uiCtx.save();
      uiCtx.globalAlpha = alpha;

      if (g.isEmoji && g.sprite) {
        const side = size * 1.8;
        uiCtx.drawImage(g.sprite, g.x - side / 2, g.y - side / 2, side, side);
      } else {
        // Neon text rendering
        uiCtx.font = `900 ${Math.round(size)}px "Segoe UI",system-ui,sans-serif`;
        uiCtx.textAlign = 'center';
        uiCtx.textBaseline = 'middle';

        // Outer glow
        uiCtx.shadowColor = g.color;
        uiCtx.shadowBlur = state.reduceMotion ? 0 : 25;
        uiCtx.strokeStyle = 'rgba(0,0,0,0.9)';
        uiCtx.lineWidth = Math.max(3, size * 0.08);
        uiCtx.strokeText(g.text, g.x, g.y);

        // Fill with neon color
        uiCtx.fillStyle = g.color;
        uiCtx.fillText(g.text, g.x, g.y);

        // White hot center
        uiCtx.shadowBlur = 0;
        uiCtx.globalAlpha = alpha * 0.5;
        uiCtx.fillStyle = '#fff';
        uiCtx.fillText(g.text, g.x, g.y);
      }

      uiCtx.restore();
    }
  }

  function markInput() {
    const now = performance.now();
    state.lastInputAt = now;
    state.lastIdleAt = now;
  }

  function resize() {
    state.width = Math.max(1, window.innerWidth);
    state.height = Math.max(1, window.innerHeight);
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Trail and UI canvases at 1x DPR for performance
    trailCanvas.width = state.width;
    trailCanvas.height = state.height;
    trailCanvas.style.width = state.width + 'px';
    trailCanvas.style.height = state.height + 'px';

    uiCanvas.width = state.width;
    uiCanvas.height = state.height;
    uiCanvas.style.width = state.width + 'px';
    uiCanvas.style.height = state.height + 'px';

    trailCtx.lineCap = 'round';
    trailCtx.lineJoin = 'round';
    uiCtx.textAlign = 'center';
    uiCtx.textBaseline = 'middle';

    // GPU canvas at device DPR
    GPUParticles.resize(state.width, state.height, state.dpr);
  }

  function formatNumber(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
})();
