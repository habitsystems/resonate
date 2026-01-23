// Resonate — Harp Grid
// Creates a full-viewport grid of equal-sized squares (min 20px). Each square is mapped
// to one of 47 harp-like notes with distinct colors. Pointer/touch plays its note.

const MIN_CELL_PX = 20;
const NOTE_COUNT = 47;

const gridEl = document.getElementById('grid');
const legendEl = document.getElementById('legend');

// Build 47 distinct hues, evenly spaced around the circle.
const hues = Array.from({ length: NOTE_COUNT }, (_, i) => Math.round((360 * i) / NOTE_COUNT));
const colors = hues.map(h => `hsl(${h} 80% 55%)`);

// Frequencies for 47 equal-tempered semitones, starting at C2 (65.406 Hz) as a pleasant low base.
const BASE_FREQ = 65.406; // C2
const SEMITONE = Math.pow(2, 1 / 12);
const freqs = Array.from({ length: NOTE_COUNT }, (_, i) => +(BASE_FREQ * Math.pow(SEMITONE, i)).toFixed(3));

// Audio setup
let audioCtx = null;
let masterGain = null;
let reverb = null;
let reverbWet = null;

function lazyInitAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.9;

  // Convolution reverb with short gentle tail to resemble a harp body
  reverb = audioCtx.createConvolver();
  reverb.buffer = generateImpulseResponse(audioCtx, 2.2, 2.5); // duration, decay
  reverbWet = audioCtx.createGain();
  reverbWet.gain.value = 0.18;

  const dry = audioCtx.createGain();
  dry.gain.value = 1.0;

  // master routing: each voice connects to dry and reverbWet, both into master
  reverb.connect(masterGain);
  dry.connect(masterGain);
  masterGain.connect(audioCtx.destination);

  // Store for voice creation
  lazyInitAudio.dry = dry;
}

// Karplus-Strong style lite using filtered noise burst + resonant filter + decay envelope
function playHarpPluck(freq, velocity = 1.0) {
  lazyInitAudio();
  const ctx = audioCtx;
  const t0 = ctx.currentTime + 0.0005;

  // Noise burst exciter
  const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.02), ctx.sampleRate); // 20ms
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = false;

  // Resonant bandpass around the target frequency to simulate string body resonance
  const body = ctx.createBiquadFilter();
  body.type = 'bandpass';
  body.frequency.value = freq;
  body.Q.value = 12;

  // Gentle lowpass to mellow brightness
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(6000, freq * 20);
  lp.Q.value = 0.0001;

  // Amplitude envelope
  const amp = ctx.createGain();
  const maxGain = 0.4 * velocity;
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(maxGain, t0 + 0.005); // super fast attack
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8); // long decay

  // Subtle pitch component using a damped triangle oscillator blended in, adds tonality
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  // slight initial detune that settles quickly for a realistic pluck start
  osc.detune.setValueAtTime(8, t0);
  osc.detune.linearRampToValueAtTime(0, t0 + 0.08);

  // Filter envelope for brightness decay
  const startCut = Math.min(9000, freq * 28);
  const endCut = Math.max(1200, freq * 3);
  lp.frequency.setValueAtTime(startCut, t0);
  lp.frequency.exponentialRampToValueAtTime(endCut, t0 + 1.2);

  // Connect graph
  // Noise excites the body, mixed with a pitched osc, into lowpass, then to dry+reverb
  noise.connect(body);
  body.connect(lp);
  osc.connect(lp);

  const dryTap = audioCtx.createGain(); dryTap.gain.value = 1.0;
  const wetTap = audioCtx.createGain(); wetTap.gain.value = 1.0;
  lp.connect(amp);
  amp.connect(dryTap);
  amp.connect(wetTap);
  dryTap.connect(lazyInitAudio.dry);
  wetTap.connect(reverb);

  noise.start(t0);
  noise.stop(t0 + 0.03);
  osc.start(t0);
  osc.stop(t0 + 2.0);
}

// Generate a stereo impulse response with exponential decay
function generateImpulseResponse(ctx, duration = 2.0, decay = 2.0) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // soft start, exponential tail, slight randomization
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.6;
    }
  }
  return impulse;
}

// UI: build grid of equal squares filling the viewport
let currentCells = 0;
let noteOrder = [];

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function computeGrid() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cols = Math.max(1, Math.floor(vw / MIN_CELL_PX));
  let cellSize = Math.floor(vw / cols);
  if (cellSize < MIN_CELL_PX) {
    cols = Math.max(1, Math.floor(vw / MIN_CELL_PX));
    cellSize = Math.max(MIN_CELL_PX, Math.floor(vw / cols));
  }
  const rows = Math.max(1, Math.ceil(vh / cellSize));
  document.documentElement.style.setProperty('--cols', String(cols));
  document.documentElement.style.setProperty('--rows', String(rows));
  document.documentElement.style.setProperty('--cell-size', `${cellSize}px`);
  return { cols, rows, cellSize };
}

function buildCells() {
  const { cols, rows } = computeGrid();
  const need = cols * rows;
  if (need === currentCells) return;
  currentCells = need;

  // Prepare mapping: repeat the 47-note cycle to cover all cells, then shuffle for random arrangement.
  noteOrder = Array.from({ length: need }, (_, i) => i % NOTE_COUNT);
  shuffleInPlace(noteOrder);

  // Build DOM
  const frag = document.createDocumentFragment();
  gridEl.innerHTML = '';
  for (let i = 0; i < need; i++) {
    const idx = noteOrder[i];
    const div = document.createElement('button');
    div.className = 'cell';
    div.style.backgroundColor = colors[idx];
    div.setAttribute('data-note', String(idx));
    div.setAttribute('aria-label', `Note ${idx + 1}`);
    div.tabIndex = 0;

    // Pointer/touch handled via event delegation on the grid for swipe/drag play
    // Keyboard accessibility
    div.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        const n = Number(div.getAttribute('data-note')) || 0;
        playCell(div, n, 1.0);
      }
    });

    frag.appendChild(div);
  }
  gridEl.appendChild(frag);

  // Build legend once per rebuild
  renderLegend();
}

function renderLegend() {
  const parts = [];
  for (let i = 0; i < NOTE_COUNT; i++) {
    parts.push(`<span class="swatch" style="background:${colors[i]}"></span><span>${i + 1}</span>`);
  }
  legendEl.innerHTML = parts.join(' · ');
}

function playCell(el, noteIndex, velocity = 1.0) {
  el.classList.add('playing');
  const freq = freqs[noteIndex % NOTE_COUNT];
  playHarpPluck(freq, velocity);
  // remove highlight shortly after
  setTimeout(() => el.classList.remove('playing'), 150);
}

// Initialize
buildCells();

// Pointer drag-to-play support (mouse, touch, pen)
const activePointers = new Map(); // pointerId -> { lastEl: HTMLElement | null }

function velocityFromEvent(e) {
  const p = (e && typeof e.pressure === 'number') ? e.pressure : 1;
  return Math.max(0.4, Math.min(1, p || 1));
}

function cellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.classList && el.classList.contains('cell')) return el;
  return el.closest ? el.closest('.cell') : null;
}

function handlePlayIfNew(pointerId, cellEl, e) {
  if (!cellEl) return;
  const state = activePointers.get(pointerId) || { lastEl: null };
  if (state.lastEl !== cellEl) {
    const n = Number(cellEl.getAttribute('data-note')) || 0;
    playCell(cellEl, n, velocityFromEvent(e));
    state.lastEl = cellEl;
    activePointers.set(pointerId, state);
  }
}

gridEl.addEventListener('pointerdown', (e) => {
  // Initialize audio on first interaction
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (!audioCtx) lazyInitAudio();

  e.preventDefault();
  try { gridEl.setPointerCapture(e.pointerId); } catch {}
  activePointers.set(e.pointerId, { lastEl: null });
  const cellEl = (e.target && e.target.classList && e.target.classList.contains('cell')) ? e.target : cellFromPoint(e.clientX, e.clientY);
  handlePlayIfNew(e.pointerId, cellEl, e);
});

gridEl.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  const cellEl = cellFromPoint(e.clientX, e.clientY);
  handlePlayIfNew(e.pointerId, cellEl, e);
});

function endPointer(e) {
  if (activePointers.has(e.pointerId)) {
    activePointers.delete(e.pointerId);
  }
  try { gridEl.releasePointerCapture(e.pointerId); } catch {}
}

gridEl.addEventListener('pointerup', endPointer);

gridEl.addEventListener('pointercancel', endPointer);

gridEl.addEventListener('lostpointercapture', endPointer);

// Ensure AudioContext resumes on first interaction on some browsers
gridEl.addEventListener('pointerdown', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (!audioCtx) lazyInitAudio();
}, { once: true });

window.addEventListener('resize', () => {
  // Debounce resize rebuild
  clearTimeout(buildCells._t);
  buildCells._t = setTimeout(buildCells, 80);
});
