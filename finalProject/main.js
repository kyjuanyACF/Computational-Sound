// ─── Helpers ─────────────────────────────────────────────────────────────────

// On the white ASCII canvas the source pixel color is used directly —
// dark strokes are already legible without any transformation.
function charColor(r, g, b) {
  return `rgb(${r},${g},${b})`;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CHARS = "@%#*+=-:. ";
const CANVAS_W = 480;
const CANVAS_H = 360;
const CELL = 8; // pixels per ASCII cell — same grid on both canvases

const ASCII_COLS = CANVAS_W / CELL; // 60
const ASCII_ROWS = CANVAS_H / CELL; // 45

// Font drawn at CELL-1 px so glyphs sit inside each cell without bleeding
const ASCII_FONT = `${CELL - 1}px "Courier New"`;

// C-pentatonic scale across 5 octaves (C2–A6), 25 notes
const SCALE = (() => {
  const semitones = [0, 2, 4, 7, 9];
  const notes = [];
  for (let oct = 0; oct < 5; oct++)
    for (const s of semitones)
      notes.push(65.41 * Math.pow(2, oct + s / 12));
  return notes;
})();

// ─── State ────────────────────────────────────────────────────────────────────
let currentTool = 'pencil';
let isDrawing = false;
let lastX = 0, lastY = 0;
let brushColor = '#000000';
let brushSize = 6;
let tempoMs = 110;

// asciiData[row][col] = { char, r, g, b, brightness }
let asciiData = [];
let asciiPendingRaf = false;

let isPlaying = false;
let currentCol = 0;
let prevScanCol = null;
let scanTimer = null;
let rainbowHue = 0;

// Columns whose in-flight rainbow animations should be cancelled
const cancelledCols = new Set();

// Audio nodes
let audioCtx = null;
let masterGain = null;
let dryGain = null;
let reverbNode = null;
let reverbGain = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const drawCanvas  = document.getElementById('drawCanvas');
const dCtx        = drawCanvas.getContext('2d');
const asciiCanvas = document.getElementById('asciiCanvas');
const aCtx        = asciiCanvas.getContext('2d');

const playBtn     = document.getElementById('playBtn');
const playBtn2    = document.getElementById('playBtn2');
const shareBtn    = document.getElementById('shareBtn');
const shareBtn2   = document.getElementById('shareBtn2');
const uploadBtn   = document.getElementById('uploadBtn');
const clearBtn    = document.getElementById('clearBtn');
const fileInput   = document.getElementById('fileInput');
const brushSizeSlider = document.getElementById('brushSize');
const colorPicker = document.getElementById('colorPicker');
const eraseBtn    = document.getElementById('eraseBtn');
const tempoSlider = document.getElementById('tempoSlider');

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    // Rebuild the ASCII view whenever switching to Listen so it's fresh
    if (btn.dataset.tab === 'listen') buildAscii();
  });
});

// ─── Canvas init ──────────────────────────────────────────────────────────────
drawCanvas.width  = CANVAS_W;
drawCanvas.height = CANVAS_H;
dCtx.fillStyle = '#ffffff';
dCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
dCtx.lineCap = 'round';
dCtx.lineJoin = 'round';

asciiCanvas.width  = CANVAS_W;
asciiCanvas.height = CANVAS_H;
aCtx.fillStyle = '#ffffff';
aCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

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

// ─── Controls ─────────────────────────────────────────────────────────────────
brushSizeSlider.addEventListener('input', () => { brushSize = parseInt(brushSizeSlider.value); });
colorPicker.addEventListener('input',     () => { brushColor = colorPicker.value; });

// Speed slider: invert so right = faster (lower tempoMs)
tempoSlider.addEventListener('input', () => {
  tempoMs = parseInt(tempoSlider.max) + parseInt(tempoSlider.min) - parseInt(tempoSlider.value);
});

// ─── Pointer helpers ──────────────────────────────────────────────────────────
function getPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * (CANVAS_W / rect.width),
    y: (src.clientY - rect.top)  * (CANVAS_H / rect.height),
  };
}

// ─── Drawing ──────────────────────────────────────────────────────────────────
function onPointerDown(e) {
  e.preventDefault();
  const { x, y } = getPos(e);
  isDrawing = true;
  lastX = x; lastY = y;
  dCtx.beginPath();
  dCtx.moveTo(x, y);
}

function onPointerMove(e) {
  if (!isDrawing) return;
  e.preventDefault();

  const { x, y } = getPos(e);
  const dx = x - lastX, dy = y - lastY;
  const speed = Math.sqrt(dx * dx + dy * dy);

  dCtx.lineCap  = 'round';
  dCtx.lineJoin = 'round';

  if (currentTool === 'pencil') {
    // Slight jitter per point gives a grainy pencil texture
    dCtx.globalCompositeOperation = 'source-over';
    dCtx.globalAlpha  = 0.55 + Math.random() * 0.25;
    dCtx.strokeStyle  = brushColor;
    dCtx.lineWidth    = brushSize * 0.7;
    dCtx.beginPath();
    dCtx.moveTo(lastX + (Math.random() - 0.5), lastY + (Math.random() - 0.5));
    dCtx.lineTo(x    + (Math.random() - 0.5), y    + (Math.random() - 0.5));
    dCtx.stroke();

  } else if (currentTool === 'pen') {
    // Midpoint quadratic bezier → smooth curves
    dCtx.globalCompositeOperation = 'source-over';
    dCtx.globalAlpha = 1.0;
    dCtx.strokeStyle = brushColor;
    dCtx.lineWidth   = brushSize;
    const mx = (lastX + x) / 2, my = (lastY + y) / 2;
    dCtx.quadraticCurveTo(lastX, lastY, mx, my);
    dCtx.stroke();
    dCtx.beginPath();
    dCtx.moveTo(mx, my);

  } else if (currentTool === 'marker') {
    // Semi-transparent wide strokes build up like felt-tip
    dCtx.globalCompositeOperation = 'source-over';
    dCtx.globalAlpha = 0.12;
    dCtx.strokeStyle = brushColor;
    dCtx.lineWidth   = brushSize * 4;
    dCtx.beginPath();
    dCtx.moveTo(lastX, lastY);
    dCtx.lineTo(x, y);
    dCtx.stroke();

  } else if (currentTool === 'brush') {
    // Width decreases with speed, simulating brush pressure
    const w = Math.max(1, brushSize * 2.5 * Math.pow(0.94, speed));
    dCtx.globalCompositeOperation = 'source-over';
    dCtx.globalAlpha = 0.88;
    dCtx.strokeStyle = brushColor;
    dCtx.lineWidth   = w;
    dCtx.lineTo(x, y);
    dCtx.stroke();
    dCtx.beginPath();
    dCtx.moveTo(x, y);

  } else if (currentTool === 'eraser') {
    dCtx.globalCompositeOperation = 'destination-out';
    dCtx.globalAlpha = 1.0;
    dCtx.lineWidth   = brushSize * 4;
    dCtx.lineTo(x, y);
    dCtx.stroke();
    dCtx.beginPath();
    dCtx.moveTo(x, y);
  }

  dCtx.globalAlpha = 1.0;
  dCtx.globalCompositeOperation = 'source-over';
  lastX = x; lastY = y;
  scheduleAsciiUpdate();
}

function onPointerUp() {
  if (!isDrawing) return;
  isDrawing = false;
  dCtx.beginPath();
  dCtx.globalAlpha = 1.0;
  dCtx.globalCompositeOperation = 'source-over';
  scheduleAsciiUpdate();
}

drawCanvas.addEventListener('mousedown', onPointerDown);
drawCanvas.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);
drawCanvas.addEventListener('touchstart', onPointerDown, { passive: false });
drawCanvas.addEventListener('touchmove',  onPointerMove, { passive: false });
window.addEventListener('touchend', onPointerUp);

// ─── ASCII rendering ──────────────────────────────────────────────────────────
// The ASCII canvas is CANVAS_W × CANVAS_H pixels. Each character is drawn at
// (col * CELL, row * CELL) — the same coordinate grid as the drawing canvas,
// so the ASCII art aligns pixel-for-pixel with the source drawing.

function scheduleAsciiUpdate() {
  if (asciiPendingRaf) return;
  asciiPendingRaf = true;
  requestAnimationFrame(() => {
    buildAscii();
    asciiPendingRaf = false;
  });
}

function buildAscii() {
  // Flatten onto a white background (handles eraser transparency)
  const tmp  = document.createElement('canvas');
  tmp.width  = CANVAS_W;
  tmp.height = CANVAS_H;
  const tCtx = tmp.getContext('2d');
  tCtx.fillStyle = '#ffffff';
  tCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  tCtx.drawImage(drawCanvas, 0, 0);

  const imgData = tCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  const px      = imgData.data;

  asciiData = [];
  aCtx.fillStyle = '#ffffff';
  aCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  aCtx.font         = ASCII_FONT;
  aCtx.textBaseline = 'top';

  for (let row = 0; row < ASCII_ROWS; row++) {
    asciiData[row] = [];
    for (let col = 0; col < ASCII_COLS; col++) {
      // Sample center of each CELL×CELL block
      const sx  = Math.min(col * CELL + (CELL >> 1), CANVAS_W - 1);
      const sy  = Math.min(row * CELL + (CELL >> 1), CANVAS_H - 1);
      const idx = (sy * CANVAS_W + sx) * 4;

      const r = px[idx], g = px[idx + 1], b = px[idx + 2];
      const brightness = (r + g + b) / 3;
      const charIdx = Math.floor((brightness / 255) * (CHARS.length - 1));
      const char    = CHARS[charIdx];

      asciiData[row][col] = { char, r, g, b, brightness };

      if (char.trim()) {
        aCtx.fillStyle = charColor(r, g, b);
        aCtx.fillText(char, col * CELL, row * CELL);
      }
    }
  }
}

// Redraw one column with normal (non-highlight) colors
function redrawColumn(col) {
  aCtx.font         = ASCII_FONT;
  aCtx.textBaseline = 'top';
  aCtx.fillStyle    = '#ffffff';
  aCtx.fillRect(col * CELL, 0, CELL, CANVAS_H);
  for (let row = 0; row < ASCII_ROWS; row++) {
    const cell = asciiData[row]?.[col];
    if (cell?.char.trim()) {
      aCtx.fillStyle = charColor(cell.r, cell.g, cell.b);
      aCtx.fillText(cell.char, col * CELL, row * CELL);
    }
  }
}

// ─── File upload ──────────────────────────────────────────────────────────────
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const img    = new Image();
  const reader = new FileReader();
  reader.onload = ev => { img.src = ev.target.result; };
  img.onload = () => {
    const iA = img.width / img.height, cA = CANVAS_W / CANVAS_H;
    let sx, sy, sw, sh;
    if (iA > cA) { sh = img.height; sw = sh * cA; sx = (img.width - sw) / 2; sy = 0; }
    else         { sw = img.width;  sh = sw / cA; sx = 0; sy = (img.height - sh) / 2; }
    dCtx.globalAlpha = 1;
    dCtx.globalCompositeOperation = 'source-over';
    dCtx.fillStyle = '#fff';
    dCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    dCtx.drawImage(img, sx, sy, sw, sh, 0, 0, CANVAS_W, CANVAS_H);
    buildAscii();
  };
  reader.readAsDataURL(file);
});

// ─── Clear ────────────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  dCtx.globalAlpha = 1;
  dCtx.globalCompositeOperation = 'source-over';
  dCtx.fillStyle = '#fff';
  dCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  buildAscii();
});

// ─── Audio ────────────────────────────────────────────────────────────────────
function initAudio() {
  if (audioCtx) return;
  audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.55;
  masterGain.connect(audioCtx.destination);

  dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.8;
  dryGain.connect(masterGain);

  // Synthetic reverb: not covered in class.
  // IR = exponentially-decaying white noise, approximating late room reflections.
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
    for (let i = 0; i < length; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decayRate);
  }
  const conv  = ctx.createConvolver();
  conv.buffer = buffer;
  return conv;
}

// ─── FM synthesis ─────────────────────────────────────────────────────────────
// Concept from class: FM synthesis — modulator output routes into the carrier's
// frequency input, generating sidebands. Modulation index scales with pixel
// brightness so darker cells produce richer, more complex timbres.
function triggerNote(freq, amp, filterFreq, pan, charType) {
  if (!audioCtx || amp < 0.04) return;

  const now = audioCtx.currentTime;
  const dur = (tempoMs / 1000) * 1.5;

  const carrier = audioCtx.createOscillator();
  const mod     = audioCtx.createOscillator();
  const modGain = audioCtx.createGain();
  const env     = audioCtx.createGain();
  const filter  = audioCtx.createBiquadFilter();
  const panner  = audioCtx.createStereoPanner();

  // Dense chars (@%#) → sawtooth, sparse (- : .) → sine
  const density = CHARS.indexOf(charType);
  carrier.type = density < 3 ? 'sawtooth' : density < 6 ? 'triangle' : 'sine';
  carrier.frequency.setValueAtTime(freq, now);

  mod.type = 'sine';
  mod.frequency.setValueAtTime(freq * (filterFreq > 1200 ? 2 : 1), now);
  modGain.gain.setValueAtTime(freq * amp * 1.8, now);
  modGain.gain.exponentialRampToValueAtTime(0.01, now + dur * 0.4);

  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(amp * 0.45, now + 0.009);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(180, filterFreq), now);
  filter.Q.value = 1.8;

  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);

  mod.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(env);
  env.connect(filter);
  filter.connect(panner);
  panner.connect(dryGain);
  panner.connect(reverbNode);

  carrier.start(now); mod.start(now);
  carrier.stop(now + dur + 0.06); mod.stop(now + dur + 0.06);
}

// ─── Scanner ──────────────────────────────────────────────────────────────────
function advanceScanner() {
  if (!isPlaying || !asciiData.length) return;

  // Restore the previous column (cancel any in-flight rainbow on it)
  if (prevScanCol !== null) {
    cancelledCols.add(prevScanCol);
    redrawColumn(prevScanCol);
  }

  const col = currentCol;

  // Scanner highlight strip, then redraw chars on top
  aCtx.fillStyle = 'rgba(255, 220, 50, 0.35)';
  aCtx.fillRect(col * CELL, 0, CELL, CANVAS_H);
  aCtx.font         = ASCII_FONT;
  aCtx.textBaseline = 'top';
  for (let row = 0; row < ASCII_ROWS; row++) {
    const cell = asciiData[row]?.[col];
    if (cell?.char.trim()) {
      aCtx.fillStyle = charColor(cell.r, cell.g, cell.b);
      aCtx.fillText(cell.char, col * CELL, row * CELL);
    }
  }

  prevScanCol = col;

  // Trigger notes and rainbow for every active char in this column
  for (let row = 0; row < ASCII_ROWS; row++) {
    const cell = asciiData[row]?.[col];
    if (!cell?.char.trim()) continue;

    const pitchIdx  = Math.floor((1 - row / ASCII_ROWS) * (SCALE.length - 1));
    const amp       = 1 - cell.brightness / 255;
    const pan       = (col / ASCII_COLS) * 2 - 1;
    const filterFreq = 200 + (cell.r / 255) * 4200;

    triggerNote(SCALE[pitchIdx], amp, filterFreq, pan, cell.char);
  }

  animateRainbow(col);

  currentCol = (currentCol + 1) % ASCII_COLS;
  scanTimer  = setTimeout(advanceScanner, tempoMs);
}

// ─── Rainbow animation ────────────────────────────────────────────────────────
function animateRainbow(col) {
  cancelledCols.delete(col);
  const baseHue   = rainbowHue;
  rainbowHue      = (rainbowHue + 4) % 360;
  let frame       = 0;
  const totalFrames = 16;

  function step() {
    if (cancelledCols.has(col)) return;

    aCtx.font         = ASCII_FONT;
    aCtx.textBaseline = 'top';

    const isScannerCol = col === prevScanCol;
    aCtx.fillStyle = isScannerCol ? 'rgba(255,220,50,0.35)' : '#ffffff';
    aCtx.fillRect(col * CELL, 0, CELL, CANVAS_H);

    for (let row = 0; row < ASCII_ROWS; row++) {
      const cell = asciiData[row]?.[col];
      if (!cell?.char.trim()) continue;
      aCtx.fillStyle = frame < totalFrames
        ? `hsl(${(baseHue + row * 22 + frame * 23) % 360}, 100%, 45%)`
        : charColor(cell.r, cell.g, cell.b);
      aCtx.fillText(cell.char, col * CELL, row * CELL);
    }

    frame++;
    if (frame <= totalFrames) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// ─── Playback ─────────────────────────────────────────────────────────────────
function startPlayback() {
  initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (!asciiData.length) buildAscii();
  isPlaying   = true;
  currentCol  = 0;
  prevScanCol = null;
  updatePlayBtns(true);
  advanceScanner();
}

function stopPlayback() {
  isPlaying = false;
  clearTimeout(scanTimer);
  if (prevScanCol !== null) {
    cancelledCols.add(prevScanCol);
    redrawColumn(prevScanCol);
    prevScanCol = null;
  }
  updatePlayBtns(false);
}

function updatePlayBtns(playing) {
  [playBtn, playBtn2].forEach(btn => {
    btn.textContent = playing ? '■ Stop' : '▶ Play';
    btn.classList.toggle('playing', playing);
  });
}

playBtn.addEventListener('click',  () => { if (isPlaying) stopPlayback(); else startPlayback(); });
playBtn2.addEventListener('click', () => { if (isPlaying) stopPlayback(); else startPlayback(); });

// ─── Share ────────────────────────────────────────────────────────────────────
async function doShare() {
  let text = 'Tittle\n\n';
  for (let row = 0; row < ASCII_ROWS; row++) {
    for (let col = 0; col < ASCII_COLS; col++)
      text += asciiData[row]?.[col]?.char ?? ' ';
    text += '\n';
  }
  try {
    await navigator.clipboard.writeText(text);
    [shareBtn, shareBtn2].forEach(b => { b.textContent = '✓ Copied!'; });
  } catch {
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'tittle.txt';
    a.click();
  }
  setTimeout(() => { [shareBtn, shareBtn2].forEach(b => { b.textContent = 'Share'; }); }, 2000);
}

shareBtn.addEventListener('click',  doShare);
shareBtn2.addEventListener('click', doShare);

// ─── Init ─────────────────────────────────────────────────────────────────────
buildAscii();
