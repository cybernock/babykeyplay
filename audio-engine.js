/**
 * BabyKeyPlay — Generative Music Engine
 * Produces evolving ambient music with melodic, harmonic, and rhythmic layers
 */

const AudioEngine = (() => {
  'use strict';

  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let reverbNode = null;
  let compressor = null;

  let musicEnabled = true;
  let sfxEnabled = true;
  let initialized = false;

  // ── Music state ──
  let musicPlaying = false;
  let bpm = 72;
  let beatInterval = 60 / bpm;
  let nextBeatTime = 0;
  let beatCount = 0;

  // ── Scale & Harmony ──
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    pentatonic: [0, 2, 4, 7, 9],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10]
  };

  const CHORD_PROGRESSIONS = [
    [0, 4, 5, 3],     // I V vi IV
    [0, 3, 4, 4],     // I IV V V
    [0, 5, 3, 4],     // I vi IV V
    [0, 2, 3, 4],     // I iii IV V
    [0, 3, 0, 4]      // I IV I V
  ];

  let currentScale = SCALES.pentatonic;
  let rootMidi = 60; // C4
  let currentProgression = CHORD_PROGRESSIONS[0];
  let chordIndex = 0;
  let melodyHistory = [];
  let lastMelodyNote = 72;
  let patternPhase = 0;

  // ── Pad state ──
  let padOscillators = [];
  let padFilterNode = null;

  // ── Arpeggio state ──
  let arpStep = 0;
  let arpPattern = [0, 2, 4, 2]; // Degree indices

  // ── Noise buffer ──
  let noiseBuffer = null;

  function init() {
    if (initialized) return true;

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return false;

    ctx = new AudioCtor();

    // Master chain: compressor → master gain → destination
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, ctx.currentTime);
    compressor.knee.setValueAtTime(12, ctx.currentTime);
    compressor.ratio.setValueAtTime(4, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.7, ctx.currentTime);

    musicGain = ctx.createGain();
    musicGain.gain.setValueAtTime(0.5, ctx.currentTime);

    sfxGain = ctx.createGain();
    sfxGain.gain.setValueAtTime(0.8, ctx.currentTime);

    // Convolution reverb
    reverbNode = createReverb();

    musicGain.connect(reverbNode);
    musicGain.connect(compressor);
    sfxGain.connect(compressor);
    reverbNode.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    createNoiseBuffer();
    initialized = true;
    return true;
  }

  function createReverb() {
    const convolver = ctx.createConvolver();
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * 2.5);
    const impulse = ctx.createBuffer(2, length, rate);

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        // Exponential decay with early reflections
        const decay = Math.exp(-t * 2.8);
        const earlyRef = t < 0.08 ? Math.exp(-t * 15) * 0.3 : 0;
        data[i] = (Math.random() * 2 - 1) * (decay + earlyRef) * 0.35;
      }
    }

    convolver.buffer = impulse;
    return convolver;
  }

  function createNoiseBuffer() {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * 0.5);
    noiseBuffer = ctx.createBuffer(1, length, rate);
    const data = noiseBuffer.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      prev = prev * 0.93 + white * 0.07;
      data[i] = (white * 0.3 + prev * 0.7) * 0.5;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  // ── Generative Music Scheduler ──

  function startMusic() {
    if (!initialized || musicPlaying) return;
    musicPlaying = true;
    nextBeatTime = ctx.currentTime + 0.1;
    scheduleBeat();
  }

  function stopMusic() {
    musicPlaying = false;
    killPad();
  }

  function scheduleBeat() {
    if (!musicPlaying || !musicEnabled) return;

    const now = ctx.currentTime;
    const lookAhead = 0.15;

    while (nextBeatTime < now + lookAhead) {
      processBar(nextBeatTime);
      beatCount++;
      nextBeatTime += beatInterval;
    }

    setTimeout(scheduleBeat, 50);
  }

  function processBar(time) {
    const barPosition = beatCount % 16;
    const chordBeat = Math.floor(barPosition / 4);

    // Chord change every 4 beats
    if (barPosition % 4 === 0) {
      chordIndex = chordBeat % currentProgression.length;
      updatePad(time);

      // Every 16 beats, possibly change scale or progression
      if (barPosition === 0) {
        patternPhase++;
        if (patternPhase % 4 === 0) {
          evolveHarmony();
        }
      }
    }

    // Bass on beats 0 and 2
    if (barPosition % 4 === 0 || barPosition % 4 === 2) {
      playBassNote(time);
    }

    // Melody: probabilistic per beat
    if (Math.random() < 0.6) {
      playMelodyNote(time);
    }

    // Arpeggio on every beat
    playArpNote(time);

    // Percussion hits
    if (barPosition % 4 === 0) {
      playPercussion(time, 'kick');
    }
    if (barPosition % 4 === 2) {
      playPercussion(time, 'hat');
    }
    if (barPosition % 8 === 4 && Math.random() < 0.4) {
      playPercussion(time, 'shaker');
    }
  }

  function evolveHarmony() {
    // Slowly shift musical parameters
    const progressionIndex = Math.floor(Math.random() * CHORD_PROGRESSIONS.length);
    currentProgression = CHORD_PROGRESSIONS[progressionIndex];

    const scaleNames = Object.keys(SCALES);
    const scaleIndex = Math.floor(Math.random() * scaleNames.length);
    currentScale = SCALES[scaleNames[scaleIndex]];

    // Shift root up or down by a 5th or 4th
    const shifts = [-7, -5, 0, 5, 7];
    rootMidi = 48 + ((rootMidi - 48 + shifts[Math.floor(Math.random() * shifts.length)]) % 24 + 24) % 24;
    rootMidi = Math.max(48, Math.min(72, rootMidi));

    // Tempo micro-variation
    bpm = 68 + Math.floor(Math.random() * 12);
    beatInterval = 60 / bpm;
  }

  function getChordMidi() {
    const degree = currentProgression[chordIndex];
    const scaleLen = currentScale.length;
    return rootMidi + currentScale[degree % scaleLen] + Math.floor(degree / scaleLen) * 12;
  }

  // ── Instruments ──

  function updatePad(time) {
    killPad();

    const baseMidi = getChordMidi();
    const chordMidis = [baseMidi, baseMidi + 4, baseMidi + 7, baseMidi + 12];
    // Add 9th sometimes
    if (Math.random() < 0.35) chordMidis.push(baseMidi + 14);

    padFilterNode = ctx.createBiquadFilter();
    padFilterNode.type = 'lowpass';
    padFilterNode.frequency.setValueAtTime(800, time);
    padFilterNode.frequency.linearRampToValueAtTime(2200, time + beatInterval * 3);
    padFilterNode.Q.setValueAtTime(0.7, time);
    padFilterNode.connect(musicGain);

    for (const midi of chordMidis) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(midiToFreq(midi), time);
      osc.detune.setValueAtTime((Math.random() - 0.5) * 12, time);

      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.018, time + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.012, time + beatInterval * 3.5);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + beatInterval * 4.2);

      osc.connect(gain);
      gain.connect(padFilterNode);
      osc.start(time);
      osc.stop(time + beatInterval * 4.5);

      padOscillators.push({ osc, gain });
    }
  }

  function killPad() {
    const now = ctx ? ctx.currentTime : 0;
    for (const p of padOscillators) {
      try {
        p.gain.gain.setTargetAtTime(0.0001, now, 0.05);
        p.osc.stop(now + 0.1);
      } catch (e) {
        // Already stopped
      }
    }
    padOscillators = [];
  }

  function playBassNote(time) {
    const midi = getChordMidi() - 12;
    const freq = midiToFreq(Math.max(36, midi));

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.99, time + 0.3);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, time);
    filter.Q.setValueAtTime(1.2, time);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.06, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.035, time + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + beatInterval * 1.5);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(musicGain);
    osc.start(time);
    osc.stop(time + beatInterval * 2);
  }

  function playMelodyNote(time) {
    // Constrained random walk on the current scale
    const scaleLen = currentScale.length;
    const lastDegree = melodyHistory.length > 0 ? melodyHistory[melodyHistory.length - 1] : 2;

    // Weighted step selection
    const steps = [-2, -1, 0, 1, 2];
    const weights = [0.15, 0.3, 0.1, 0.3, 0.15];
    let nextDegree = lastDegree + weightedChoice(steps, weights);
    nextDegree = Math.max(0, Math.min(scaleLen * 2 - 1, nextDegree));

    const octave = Math.floor(nextDegree / scaleLen);
    const degreeInScale = nextDegree % scaleLen;
    const midi = rootMidi + 12 + currentScale[degreeInScale] + octave * 12;
    const clampedMidi = Math.max(60, Math.min(96, midi));

    melodyHistory.push(nextDegree);
    if (melodyHistory.length > 8) melodyHistory.shift();

    const freq = midiToFreq(clampedMidi);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = Math.random() < 0.5 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.detune.setValueAtTime((Math.random() - 0.5) * 8, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000 + Math.random() * 2000, time);
    filter.frequency.exponentialRampToValueAtTime(800, time + 0.6);

    const volume = 0.025 + Math.random() * 0.02;
    const duration = beatInterval * (0.5 + Math.random() * 1.5);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(volume * 0.5, time + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(musicGain);
    osc.start(time);
    osc.stop(time + duration + 0.02);

    lastMelodyNote = clampedMidi;
  }

  function playArpNote(time) {
    const degree = arpPattern[arpStep % arpPattern.length];
    arpStep++;

    const scaleLen = currentScale.length;
    const chordRoot = getChordMidi();
    const midi = chordRoot + currentScale[degree % scaleLen] + Math.floor(degree / scaleLen) * 12;
    const arpMidi = Math.max(60, Math.min(96, midi));

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(midiToFreq(arpMidi), time);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.012, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + beatInterval * 0.7);

    osc.connect(gain);
    gain.connect(musicGain);
    osc.start(time);
    osc.stop(time + beatInterval);

    // Change arp pattern occasionally
    if (arpStep % 16 === 0 && Math.random() < 0.3) {
      const patterns = [
        [0, 2, 4, 2],
        [0, 1, 2, 4],
        [4, 2, 0, 2],
        [0, 2, 4, 7],
        [0, 4, 2, 4]
      ];
      arpPattern = patterns[Math.floor(Math.random() * patterns.length)];
    }
  }

  function playPercussion(time, type) {
    if (type === 'kick') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, time);
      osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.04, time + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      osc.connect(gain);
      gain.connect(musicGain);
      osc.start(time);
      osc.stop(time + 0.25);
    } else if (type === 'hat') {
      if (!noiseBuffer) return;
      const noise = ctx.createBufferSource();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      noise.buffer = noiseBuffer;
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(6000, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.015, time + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(musicGain);
      noise.start(time);
      noise.stop(time + 0.08);
    } else if (type === 'shaker') {
      if (!noiseBuffer) return;
      const noise = ctx.createBufferSource();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      noise.buffer = noiseBuffer;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(4000, time);
      filter.Q.setValueAtTime(2, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.008, time + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(musicGain);
      noise.start(time);
      noise.stop(time + 0.15);
    }
  }

  // ── SFX for interactions ──

  function playBurstSfx(x, y, width, height) {
    if (!sfxEnabled || !initialized) return;

    const pitch = 200 + (1 - y / height) * 600;
    const pan = (x / width) * 2 - 1;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, ctx.currentTime + 0.04);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.5, ctx.currentTime + 0.3);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.4);

    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(sfxGain);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);

    // Harmonic layer
    const harm = ctx.createOscillator();
    const harmGain = ctx.createGain();
    harm.type = 'triangle';
    harm.frequency.setValueAtTime(pitch * 2, ctx.currentTime);
    harmGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    harmGain.gain.exponentialRampToValueAtTime(0.025, ctx.currentTime + 0.003);
    harmGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    harm.connect(harmGain);
    harmGain.connect(panner);
    harm.start(ctx.currentTime);
    harm.stop(ctx.currentTime + 0.25);
  }

  function playKeySfx(key) {
    if (!sfxEnabled || !initialized) return;

    // Map key to a pleasant note
    const isEmoji = !/^[a-z0-9]$/i.test(key);
    const baseMidi = isEmoji
      ? 72 + Math.floor(Math.random() * 12)
      : 60 + (key.charCodeAt(0) % 24);

    const freq = midiToFreq(baseMidi);
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc2.frequency.setValueAtTime(freq * 2.01, ctx.currentTime);
    osc.detune.setValueAtTime((Math.random() - 0.5) * 10, ctx.currentTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.5);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);

    const harmGain = ctx.createGain();
    harmGain.gain.setValueAtTime(0.3, ctx.currentTime);

    osc.connect(gain);
    osc2.connect(harmGain);
    harmGain.connect(gain);
    gain.connect(filter);
    filter.connect(sfxGain);

    osc.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
    osc2.stop(ctx.currentTime + 0.5);
  }

  // ── Helpers ──

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function weightedChoice(items, weights) {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function setMusicEnabled(enabled) {
    musicEnabled = enabled;
    if (enabled && !musicPlaying && initialized) {
      startMusic();
    } else if (!enabled) {
      stopMusic();
    }
  }

  function setSfxEnabled(enabled) {
    sfxEnabled = enabled;
  }

  function isInitialized() {
    return initialized;
  }

  return {
    init,
    resume,
    startMusic,
    stopMusic,
    playBurstSfx,
    playKeySfx,
    setMusicEnabled,
    setSfxEnabled,
    isInitialized
  };
})();
