// ─── Helpers ─────────────────────────────────────────────────────────────────

// Convert a source pixel color (typically dark on white canvas) to a bright
// color suitable for display on the dark ASCII panel. Extracts hue then sets
// high lightness so the character is always legible against #0d0d0d.
function brightForDarkBg(r, g, b) {
  const nr = r / 255, ng = g / 255, nb = b / 255;
  const max = Math.max(nr, ng, nb), min = Math.min(nr, ng, nb);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    switch (max) {
      case nr: h = ((ng - nb) / d + (ng < nb ? 6 : 0)) / 6; break;
      case ng: h = ((nb - nr) / d + 2) / 6; break;
      case nb: h = ((nr - ng) / d + 4) / 6; break;
    }
  }
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(max + min - 1));
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 60)}%, 78%)`;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CHARS = "@%#*+=-:. ";
const CANVAS_W = 480;
const CANVAS_H = 360;
const CELL = 8; // canvas pixels sampled per ASCII character

const ASCII_COLS = Math.floor(CANVAS_W / CELL); // 60
const ASCII_ROWS = Math.floor(CANVAS_H / CELL); // 45

// C-pentatonic scale across 5 octaves (C2–A6), 25 notes
// Maps rows top→high pitch, bottom→low pitch
const SCALE = buildPentatonic(65.41, 5); // start from C2, 5 octaves

function buildPentatonic(baseHz, octaves) {
  const semitones = [0, 2, 4, 7, 9]; // C D E G A
  const notes = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const s of semitones) {
      notes.push(baseHz * Math.pow(2, oct + s / 12));
    }
  }
  return notes;
}

// ─── State ────────────────────────────────────────────────────────────────────
let currentTool = 'pencil';
let isDrawing = false;
let lastX = 0, lastY = 0;
let brushColor = '#000000';
let brushSize = 6;
let tempoMs = 110;

// asciiData[row][col] = { char, r, g, b, brightness, span }
let asciiData = [];
let asciiPending = false;

let isPlaying = false;
let currentCol = 0;
let prevScanCol = null;
let scanTimer = null;
let rainbowHue = 0;

// Audio nodes (created once on first play)
let audioCtx = null;
let masterGain = null;
let dryGain = null;
let reverbNode = null;
let reverbGain = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
const asciiDisplay = document.getElementById('ascii-display');
const playBtn = document.getElementById('playBtn');
const shareBtn = document.getElementById('shareBtn');
const uploadBtn = document.getElementById('uploadBtn');
const clearBtn = document.getElementById('clearBtn');
const fileInput = document.getElementById('fileInput');
const brushSizeSlider = document.getElementById('brushSize');
const colorPicker = document.getElementById('colorPicker');
const eraseBtn = document.getElementById('eraseBtn');
const tempoSlider = document.getElementById('tempoSlider');

// ─── Canvas init ──────────────────────────────────────────────────────────────
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

// ─── Tool selection ───────────────────────────────────────────────────────────
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    eraseBtn.classList.remove('active');
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
  });
});

eraseBtn.addEventListener('click', () => {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  eraseBtn.classList.add('active');
  currentTool = 'eraser';
});

// ─── Control listeners ────────────────────────────────────────────────────────
brushSizeSlider.addEventListener('input', () => { brushSize = parseInt(brushSizeSlider.value); });
colorPicker.addEventListener('input', () => { brushColor = colorPicker.value; });
tempoSlider.addEventListener('input', () => { tempoMs = parseInt(tempoSlider.value); });

// ─── Pointer position ─────────────────────────────────────────────────────────
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * (CANVAS_W / rect.width),
    y: (src.clientY - rect.top) * (CANVAS_H / rect.height),
  };
}

// ─── Drawing ──────────────────────────────────────────────────────────────────
function onPointerDown(e) {
  e.preventDefault();
  const { x, y } = getPos(e);
  isDrawing = true;
  lastX = x;
  lastY = y;
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function onPointerMove(e) {
  if (!isDrawing) return;
  e.preventDefault();

  const { x, y } = getPos(e);
  const dx = x - lastX, dy = y - lastY;
  const speed = Math.sqrt(dx * dx + dy * dy);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (currentTool === 'pencil') {
    // Slight random jitter per stroke for a grainy texture
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55 + Math.random() * 0.25;
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize * 0.7;
    ctx.beginPath();
    ctx.moveTo(lastX + (Math.random() - 0.5), lastY + (Math.random() - 0.5));
    ctx.lineTo(x + (Math.random() - 0.5), y + (Math.random() - 0.5));
    ctx.stroke();

  } else if (currentTool === 'pen') {
    // Quadratic bezier through midpoints for smooth curves
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    const mx = (lastX + x) / 2, my = (lastY + y) / 2;
    ctx.quadraticCurveTo(lastX, lastY, mx, my);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx, my);

  } else if (currentTool === 'marker') {
    // Low opacity + wide width — multiple passes build up density
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize * 4;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

  } else if (currentTool === 'brush') {
    // Width shrinks as speed increases (pressure simulation)
    const w = Math.max(1, brushSize * 2.5 * Math.pow(0.94, speed));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.88;
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = w;
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);

  } else if (currentTool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = brushSize * 4;
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over';

  lastX = x;
  lastY = y;
  scheduleAsciiUpdate();
}

function onPointerUp() {
  if (!isDrawing) return;
  isDrawing = false;
  ctx.beginPath();
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over';
  scheduleAsciiUpdate();
}

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);
canvas.addEventListener('touchstart', onPointerDown, { passive: false });
canvas.addEventListener('touchmove', onPointerMove, { passive: false });
window.addEventListener('touchend', onPointerUp);

// ─── ASCII conversion (RAF-throttled) ────────────────────────────────────────
function scheduleAsciiUpdate() {
  if (asciiPending) return;
  asciiPending = true;
  requestAnimationFrame(() => {
    buildAscii();
    asciiPending = false;
  });
}

function buildAscii() {
  // Composite onto a temporary canvas so eraser transparency reads as white
  const tmp = document.createElement('canvas');
  tmp.width = CANVAS_W;
  tmp.height = CANVAS_H;
  const tCtx = tmp.getContext('2d');
  tCtx.fillStyle = '#ffffff';
  tCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  tCtx.drawImage(canvas, 0, 0);

  const imgData = tCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  const px = imgData.data;

  asciiData = [];
  asciiDisplay.innerHTML = '';

  for (let row = 0; row < ASCII_ROWS; row++) {
    asciiData[row] = [];
    const rowDiv = document.createElement('div');
    rowDiv.className = 'ascii-row';

    for (let col = 0; col < ASCII_COLS; col++) {
      const sx = Math.min(col * CELL + (CELL >> 1), CANVAS_W - 1);
      const sy = Math.min(row * CELL + (CELL >> 1), CANVAS_H - 1);
      const idx = (sy * CANVAS_W + sx) * 4;

      const r = px[idx], g = px[idx + 1], b = px[idx + 2];
      const brightness = (r + g + b) / 3;

      const charIdx = Math.floor((brightness / 255) * (CHARS.length - 1));
      const char = CHARS[charIdx];

      const span = document.createElement('span');
      span.textContent = char;
      if (brightness < 218) {
        // Invert + boost so dark drawing colors appear bright on the dark ASCII panel.
        // Black stroke → white char; colored stroke → bright version of that hue.
        span.style.color = brightForDarkBg(r, g, b);
      }

      asciiData[row][col] = { char, r, g, b, brightness, span };
      rowDiv.appendChild(span);
    }

    asciiDisplay.appendChild(rowDiv);
  }
}

// ─── File upload ──────────────────────────────────────────────────────────────
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = ev => { img.src = ev.target.result; };
  img.onload = () => {
    const iA = img.width / img.height;
    const cA = CANVAS_W / CANVAS_H;
    let sx, sy, sw, sh;
    if (iA > cA) {
      sh = img.height; sw = sh * cA;
      sx = (img.width - sw) / 2; sy = 0;
    } else {
      sw = img.width; sh = sw / cA;
      sx = 0; sy = (img.height - sh) / 2;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CANVAS_W, CANVAS_H);
    buildAscii();
  };
  reader.readAsDataURL(file);
});

// ─── Clear canvas ─────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  buildAscii();
});

// ─── Audio setup ──────────────────────────────────────────────────────────────
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.55;
  masterGain.connect(audioCtx.destination);

  dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.8;
  dryGain.connect(masterGain);

  // Synthetic reverb via ConvolverNode — not covered in class.
  // The impulse response is built from exponentially-decaying white noise,
  // which approximates the dense late reflections of a room.
  reverbNode = buildReverbIR(audioCtx, 1.6, 2.8);
  reverbGain = audioCtx.createGain();
  reverbGain.gain.value = 0.22;
  reverbNode.connect(reverbGain);
  reverbGain.connect(masterGain);
}

function buildReverbIR(ctx, durationSec, decayRate) {
  const length = Math.ceil(ctx.sampleRate * durationSec);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decayRate);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = buffer;
  return conv;
}

// ─── FM synthesis note ────────────────────────────────────────────────────────
// Concept from class: FM synthesis — the modulator's output is routed into
// the carrier's frequency input, producing sidebands that color the timbre.
// The modulation index scales with brightness, making dark cells richer in harmonics.
function triggerNote(freq, amp, filterFreq, pan, charType) {
  if (!audioCtx || amp < 0.04) return;

  const now = audioCtx.currentTime;
  const dur = (tempoMs / 1000) * 1.5;

  const carrier = audioCtx.createOscillator();
  const mod = audioCtx.createOscillator();
  const modGain = audioCtx.createGain();
  const env = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  const panner = audioCtx.createStereoPanner();

  // Waveform varies by character density: dense (@%#) → sawtooth, sparse (-:.) → sine
  const density = CHARS.indexOf(charType);
  carrier.type = density < 3 ? 'sawtooth' : density < 6 ? 'triangle' : 'sine';
  carrier.frequency.setValueAtTime(freq, now);

  // Modulator: integer ratio keeps sidebands harmonic
  mod.type = 'sine';
  const modRatio = filterFreq > 1200 ? 2 : 1;
  mod.frequency.setValueAtTime(freq * modRatio, now);

  // Modulation index driven by amplitude — darker pixels get richer FM timbres
  modGain.gain.setValueAtTime(freq * amp * 1.8, now);
  modGain.gain.exponentialRampToValueAtTime(0.01, now + dur * 0.4);

  // Short attack, exponential decay envelope
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(amp * 0.45, now + 0.009);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  // Low-pass filter — cutoff driven by the red channel of the source pixel
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(180, filterFreq), now);
  filter.Q.value = 1.8;

  // Stereo pan based on horizontal position in the drawing
  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);

  // Graph: mod → modGain → carrier.frequency
  //        carrier → env → filter → panner → dry & reverb
  mod.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(env);
  env.connect(filter);
  filter.connect(panner);
  panner.connect(dryGain);
  panner.connect(reverbNode);

  carrier.start(now);
  mod.start(now);
  carrier.stop(now + dur + 0.06);
  mod.stop(now + dur + 0.06);
}

// ─── Scanner ──────────────────────────────────────────────────────────────────
function clearScanHighlight() {
  if (prevScanCol === null) return;
  for (let row = 0; row < ASCII_ROWS; row++) {
    const cell = asciiData[row]?.[prevScanCol];
    if (cell) cell.span.classList.remove('scanner-col');
  }
}

function advanceScanner() {
  if (!isPlaying || !asciiData.length) return;

  clearScanHighlight();
  const col = currentCol;

  for (let row = 0; row < ASCII_ROWS; row++) {
    const cell = asciiData[row]?.[col];
    if (!cell) continue;

    cell.span.classList.add('scanner-col');

    if (cell.char.trim() === '') continue;

    // Pitch: top rows → high notes, bottom rows → low notes
    const pitchIdx = Math.floor((1 - row / ASCII_ROWS) * (SCALE.length - 1));
    const freq = SCALE[pitchIdx];

    // Amplitude: darker pixel = louder note
    const amp = 1 - cell.brightness / 255;

    // Stereo pan: left side of drawing → left speaker
    const pan = (col / ASCII_COLS) * 2 - 1;

    // Filter cutoff driven by red channel (warm colors = muffled, cool = bright)
    const filterFreq = 200 + (cell.r / 255) * 4200;

    triggerNote(freq, amp, filterFreq, pan, cell.char);
    animateRainbow(cell.span, row, col);
  }

  prevScanCol = col;
  currentCol = (currentCol + 1) % ASCII_COLS;
  scanTimer = setTimeout(advanceScanner, tempoMs);
}

// ─── Rainbow animation ────────────────────────────────────────────────────────
// When the scanner hits a character it cycles through rainbow hues,
// then restores the original pixel color.
function animateRainbow(span, row, col) {
  const startHue = (rainbowHue + row * 20) % 360;
  rainbowHue = (rainbowHue + 4) % 360;

  let frame = 0;
  const totalFrames = 14;

  function step() {
    if (frame >= totalFrames) {
      const cell = asciiData[row]?.[col];
      if (cell) {
        span.style.color = cell.brightness < 218
          ? brightForDarkBg(cell.r, cell.g, cell.b)
          : '';
      }
      return;
    }
    span.style.color = `hsl(${(startHue + frame * 26) % 360}, 100%, 58%)`;
    frame++;
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── Playback control ─────────────────────────────────────────────────────────
function startPlayback() {
  initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (!asciiData.length) buildAscii();

  isPlaying = true;
  currentCol = 0;
  playBtn.textContent = '■ Stop';
  playBtn.classList.add('playing');
  advanceScanner();
}

function stopPlayback() {
  isPlaying = false;
  clearTimeout(scanTimer);
  clearScanHighlight();
  prevScanCol = null;
  playBtn.textContent = '▶ Play';
  playBtn.classList.remove('playing');
}

playBtn.addEventListener('click', () => {
  if (isPlaying) stopPlayback(); else startPlayback();
});

// ─── Share ────────────────────────────────────────────────────────────────────
shareBtn.addEventListener('click', async () => {
  let text = 'Tittle\n\n';
  for (let row = 0; row < ASCII_ROWS; row++) {
    for (let col = 0; col < ASCII_COLS; col++) {
      text += asciiData[row]?.[col]?.char ?? ' ';
    }
    text += '\n';
  }
  try {
    await navigator.clipboard.writeText(text);
    shareBtn.textContent = '✓ Copied!';
  } catch {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'tittle.txt';
    a.click();
  }
  setTimeout(() => { shareBtn.textContent = 'Share'; }, 2000);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
buildAscii();
