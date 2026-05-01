// ─── Constants ────────────────────────────────────────────────────────────────
const CHARS    = "@%#*+=-:. ";
const CANVAS_W = 480;
const CANVAS_H = 360;
const CELL     = 12;   // pixel art grid: 40 × 30 cells

const GRID_COLS = CANVAS_W / CELL;  // 40
const GRID_ROWS = CANVAS_H / CELL;  // 30

// ASCII display canvas at 2× native: each char gets 24 × 24 px → crisp glyphs
const D_CELL  = 24;
const D_FONT  = `21px "Courier New"`;
const ASCII_W = GRID_COLS * D_CELL;  // 960
const ASCII_H = GRID_ROWS * D_CELL;  // 720

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
let isDrawing  = false;
let brushColor = '#000000';
let brushCells = 1;            // brush size in cells (1, 2, 3, or 5)
let currentTool = 'draw';     // 'draw' | 'eraser'
let tempoMs    = 110;

let asciiData   = [];
let isPlaying   = false;
let currentCol  = 0;
let prevScanCol = null;
let scanTimer   = null;
let rainbowHue  = 0;

const cancelledCols = new Set();

let audioCtx   = null;
let masterGain = null;
let dryGain    = null;
let reverbNode = null;
let reverbGain = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const drawCanvas  = document.getElementById('drawCanvas');
const dCtx        = drawCanvas.getContext('2d');
const gridOverlay = document.getElementById('gridOverlay');
const gCtx        = gridOverlay.getContext('2d');
const asciiCanvas = document.getElementById('asciiCanvas');
const aCtx        = asciiCanvas.getContext('2d');

const playBtn    = document.getElementById('playBtn');
const shareBtn   = document.getElementById('shareBtn');
const uploadBtn  = document.getElementById('uploadBtn');
const clearBtn   = document.getElementById('clearBtn');
const fileInput  = document.getElementById('fileInput');
const colorPicker = document.getElementById('colorPicker');
const eraseBtn   = document.getElementById('eraseBtn');
const tempoSlider = document.getElementById('tempoSlider');

// ─── Canvas init ──────────────────────────────────────────────────────────────
drawCanvas.width  = CANVAS_W;
drawCanvas.height = CANVAS_H;
dCtx.fillStyle = '#ffffff';
dCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

gridOverlay.width  = CANVAS_W;
gridOverlay.height = CANVAS_H;

asciiCanvas.width  = ASCII_W;
asciiCanvas.height = ASCII_H;
aCtx.fillStyle = '#ffffff';
aCtx.fillRect(0, 0, ASCII_W, ASCII_H);

// ─── Grid overlay ─────────────────────────────────────────────────────────────
function drawGrid() {
  gCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  gCtx.strokeStyle = 'rgba(100, 100, 200, 0.18)';
  gCtx.lineWidth   = 0.5;
  for (let x = 0; x <= CANVAS_W; x += CELL) {
    gCtx.beginPath(); gCtx.moveTo(x, 0); gCtx.lineTo(x, CANVAS_H); gCtx.stroke();
  }
  for (let y = 0; y <= CANVAS_H; y += CELL) {
    gCtx.beginPath(); gCtx.moveTo(0, y); gCtx.lineTo(CANVAS_W, y); gCtx.stroke();
  }
}
drawGrid();

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'listen') buildAscii();
  });
});

// ─── Brush size buttons ───────────────────────────────────────────────────────
document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    brushCells = parseInt(btn.dataset.size);
  });
});

// ─── Erase toggle ─────────────────────────────────────────────────────────────
eraseBtn.addEventListener('click', () => {
  currentTool = currentTool === 'eraser' ? 'draw' : 'eraser';
  eraseBtn.classList.toggle('active', currentTool === 'eraser');
});

// ─── Color ────────────────────────────────────────────────────────────────────
colorPicker.addEventListener('input', () => { brushColor = colorPicker.value; });

// ─── Speed slider: right = faster ─────────────────────────────────────────────
tempoSlider.addEventListener('input', () => {
  tempoMs = parseInt(tempoSlider.max) + parseInt(tempoSlider.min) - parseInt(tempoSlider.value);
});

// ─── Pointer → grid cell ─────────────────────────────────────────────────────
function getCell(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  const x = (src.clientX - rect.left) * (CANVAS_W / rect.width);
  const y = (src.clientY - rect.top)  * (CANVAS_H / rect.height);
  return { col: Math.floor(x / CELL), row: Math.floor(y / CELL) };
}

// ─── Pixel art painting ───────────────────────────────────────────────────────
function paintCells(col, row) {
  const half  = Math.floor(brushCells / 2);
  const color = currentTool === 'eraser' ? '#ffffff' : brushColor;
  dCtx.fillStyle = color;
  for (let dr = -half; dr < brushCells - half; dr++) {
    for (let dc = -half; dc < brushCells - half; dc++) {
      const r = row + dr, c = col + dc;
      if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) continue;
      dCtx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  }
}

function onPointerDown(e) {
  e.preventDefault();
  isDrawing = true;
  paintCells(...Object.values(getCell(e)));
}

function onPointerMove(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const { col, row } = getCell(e);
  paintCells(col, row);
}

function onPointerUp() { isDrawing = false; }

drawCanvas.addEventListener('mousedown',  onPointerDown);
drawCanvas.addEventListener('mousemove',  onPointerMove);
window.addEventListener('mouseup',        onPointerUp);
drawCanvas.addEventListener('touchstart', onPointerDown, { passive: false });
drawCanvas.addEventListener('touchmove',  onPointerMove, { passive: false });
window.addEventListener('touchend',       onPointerUp);

// ─── File upload → pixelate ───────────────────────────────────────────────────
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const img    = new Image();
  const reader = new FileReader();
  reader.onload = ev => { img.src = ev.target.result; };
  img.onload = () => {
    // Crop and scale image to CANVAS_W × CANVAS_H on a temp canvas
    const tmp  = document.createElement('canvas');
    tmp.width  = CANVAS_W; tmp.height = CANVAS_H;
    const tCtx = tmp.getContext('2d');
    const iA   = img.width / img.height, cA = CANVAS_W / CANVAS_H;
    let sx, sy, sw, sh;
    if (iA > cA) { sh = img.height; sw = sh * cA; sx = (img.width - sw) / 2; sy = 0; }
    else         { sw = img.width;  sh = sw / cA; sx = 0; sy = (img.height - sh) / 2; }
    tCtx.drawImage(img, sx, sy, sw, sh, 0, 0, CANVAS_W, CANVAS_H);

    // Average each cell's RGB → fill that cell on drawCanvas
    const imgData = tCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const px      = imgData.data;
    dCtx.fillStyle = '#ffffff';
    dCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        let rS = 0, gS = 0, bS = 0, n = 0;
        for (let dy = 0; dy < CELL; dy++) {
          for (let dx = 0; dx < CELL; dx++) {
            const px_x = col * CELL + dx, px_y = row * CELL + dy;
            if (px_x >= CANVAS_W || px_y >= CANVAS_H) continue;
            const i = (px_y * CANVAS_W + px_x) * 4;
            rS += px[i]; gS += px[i + 1]; bS += px[i + 2]; n++;
          }
        }
        dCtx.fillStyle = `rgb(${Math.round(rS/n)},${Math.round(gS/n)},${Math.round(bS/n)})`;
        dCtx.fillRect(col * CELL, row * CELL, CELL, CELL);
      }
    }
    buildAscii();
    fileInput.value = '';
  };
  reader.readAsDataURL(file);
});

// ─── Clear ────────────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  dCtx.fillStyle = '#ffffff';
  dCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  buildAscii();
});

// ─── ASCII rendering ──────────────────────────────────────────────────────────
function buildAscii() {
  const tmp  = document.createElement('canvas');
  tmp.width  = CANVAS_W; tmp.height = CANVAS_H;
  const tCtx = tmp.getContext('2d');
  tCtx.fillStyle = '#ffffff';
  tCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  tCtx.drawImage(drawCanvas, 0, 0);

  const imgData = tCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  const px      = imgData.data;

  asciiData = [];
  aCtx.fillStyle = '#ffffff';
  aCtx.fillRect(0, 0, ASCII_W, ASCII_H);
  aCtx.font         = D_FONT;
  aCtx.textBaseline = 'top';

  for (let row = 0; row < GRID_ROWS; row++) {
    asciiData[row] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      // Sample center pixel of each grid cell
      const sx  = Math.min(col * CELL + (CELL >> 1), CANVAS_W - 1);
      const sy  = Math.min(row * CELL + (CELL >> 1), CANVAS_H - 1);
      const idx = (sy * CANVAS_W + sx) * 4;

      const r = px[idx], g = px[idx + 1], b = px[idx + 2];
      const brightness = (r + g + b) / 3;
      const char = CHARS[Math.floor((brightness / 255) * (CHARS.length - 1))];

      asciiData[row][col] = { char, r, g, b, brightness };

      if (char.trim()) {
        aCtx.fillStyle = `rgb(${r},${g},${b})`;
        aCtx.fillText(char, col * D_CELL, row * D_CELL);
      }
    }
  }
}

function redrawColumn(col) {
  aCtx.font         = D_FONT;
  aCtx.textBaseline = 'top';
  aCtx.fillStyle    = '#ffffff';
  aCtx.fillRect(col * D_CELL, 0, D_CELL, ASCII_H);
  for (let row = 0; row < GRID_ROWS; row++) {
    const cell = asciiData[row]?.[col];
    if (cell?.char.trim()) {
      aCtx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
      aCtx.fillText(cell.char, col * D_CELL, row * D_CELL);
    }
  }
}

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

  // Synthetic reverb — IR is exponentially-decaying white noise
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
// Modulator output routes into carrier's frequency input; modulation index
// scales with amplitude so dark pixels produce richer timbres.
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

  if (prevScanCol !== null) {
    cancelledCols.add(prevScanCol);
    redrawColumn(prevScanCol);
  }

  const col = currentCol;

  aCtx.fillStyle = 'rgba(255, 220, 50, 0.35)';
  aCtx.fillRect(col * D_CELL, 0, D_CELL, ASCII_H);
  aCtx.font         = D_FONT;
  aCtx.textBaseline = 'top';
  for (let row = 0; row < GRID_ROWS; row++) {
    const cell = asciiData[row]?.[col];
    if (cell?.char.trim()) {
      aCtx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
      aCtx.fillText(cell.char, col * D_CELL, row * D_CELL);
    }
  }

  prevScanCol = col;

  for (let row = 0; row < GRID_ROWS; row++) {
    const cell = asciiData[row]?.[col];
    if (!cell?.char.trim()) continue;
    const pitchIdx   = Math.floor((1 - row / GRID_ROWS) * (SCALE.length - 1));
    const amp        = 1 - cell.brightness / 255;
    const pan        = (col / GRID_COLS) * 2 - 1;
    const filterFreq = 200 + (cell.r / 255) * 4200;
    triggerNote(SCALE[pitchIdx], amp, filterFreq, pan, cell.char);
  }

  animateRainbow(col);

  currentCol = (currentCol + 1) % GRID_COLS;
  scanTimer  = setTimeout(advanceScanner, tempoMs);
}

// ─── Rainbow animation ────────────────────────────────────────────────────────
function animateRainbow(col) {
  cancelledCols.delete(col);
  const baseHue     = rainbowHue;
  rainbowHue        = (rainbowHue + 4) % 360;
  let frame         = 0;
  const totalFrames = 16;

  function step() {
    if (cancelledCols.has(col)) return;
    aCtx.font         = D_FONT;
    aCtx.textBaseline = 'top';
    const isScannerCol = col === prevScanCol;
    aCtx.fillStyle = isScannerCol ? 'rgba(255,220,50,0.35)' : '#ffffff';
    aCtx.fillRect(col * D_CELL, 0, D_CELL, ASCII_H);
    for (let row = 0; row < GRID_ROWS; row++) {
      const cell = asciiData[row]?.[col];
      if (!cell?.char.trim()) continue;
      aCtx.fillStyle = frame < totalFrames
        ? `hsl(${(baseHue + row * 22 + frame * 23) % 360}, 100%, 45%)`
        : `rgb(${cell.r},${cell.g},${cell.b})`;
      aCtx.fillText(cell.char, col * D_CELL, row * D_CELL);
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
  updatePlayBtn(true);
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
  updatePlayBtn(false);
}

function updatePlayBtn(playing) {
  playBtn.textContent = playing ? '■ Stop' : '▶ Play';
  playBtn.classList.toggle('playing', playing);
}

playBtn.addEventListener('click', () => { if (isPlaying) stopPlayback(); else startPlayback(); });

// ─── Share ────────────────────────────────────────────────────────────────────
async function doShare() {
  if (!asciiData.length) buildAscii();
  let text = 'Tittle\n\n';
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++)
      text += asciiData[row]?.[col]?.char ?? ' ';
    text += '\n';
  }
  try {
    await navigator.clipboard.writeText(text);
    shareBtn.textContent = '✓ Copied!';
  } catch {
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'tittle.txt';
    a.click();
  }
  setTimeout(() => { shareBtn.textContent = 'Share'; }, 2000);
}

shareBtn.addEventListener('click', doShare);

// ─── Init ─────────────────────────────────────────────────────────────────────
buildAscii();
