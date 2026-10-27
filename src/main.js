import { gfx, fonts, characters, loadAll } from './assets.js';
import {
  initAudio, setVolumes, play, playSfx, playMusic, stopMusic, sfxUrl, COMBO_SOUNDS,
} from './audio.js';
import {
  W, H, FPS, IN_LEFT, IN_RIGHT, IN_JUMP, SIM_VERSION, CLASSIC,
  createGame, step, score, finished, encodeInputs, decodeInputs, isClassic,
} from './sim.js';
import { createView, updateView, drawGame, startReward, spawnStars } from './render.js';
import {
  settings, saveSettings, stats, recordGame, rankId, RANK_LABELS, RANK_FLOORS, RANK_COMBOS,
  unlockedStyles, highScores, qualifies, addHighScore, savedReplays, storeReplay, deleteReplay,
} from './storage.js';
import { fetchScores, onlineAvailable, submitScore } from './online.js';

// ------------------------------------------------------------------ canvas

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let pixelScale = 1;

function resize() {
  const touch = document.body.classList.contains('touch');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const btn = Math.round(Math.max(60, Math.min(110, Math.min(vw, vh) * 0.2)));
  const gap = 12;
  document.documentElement.style.setProperty('--btn', `${btn}px`);
  // leave room for the touch buttons: below the game in portrait, beside it in landscape
  let availW = vw;
  let availH = vh;
  const portrait = vh > vw;
  if (touch && portrait) availH = vh - btn - gap * 3;
  else if (touch) availW = vw - 2 * (2 * btn + gap * 3);
  const s = Math.min(availW / W, availH / H);
  const cw = Math.floor(W * s);
  const ch = Math.floor(H * s);
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  canvas.style.left = `${Math.floor((vw - cw) / 2)}px`;
  canvas.style.top = `${touch && portrait ? Math.max(0, Math.floor((availH - ch) * 0.3)) : Math.floor((vh - ch) / 2)}px`;
  pixelScale = Math.max(1, Math.min(4, Math.ceil(s * (window.devicePixelRatio || 1))));
  const credit = document.getElementById('credit');
  if (credit) credit.hidden = vh - ch < 22 && vw - cw < 300;
  canvas.width = W * pixelScale;
  canvas.height = H * pixelScale;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

function begin() {
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

// ------------------------------------------------------------------- input

const down = new Set();
const touchState = { left: false, right: false, jump: false };
let pad = { left: false, right: false, jump: false, up: false, down: false, start: false };
let lastPad = { ...pad };

const KEY_NAMES = {
  ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN', Space: 'SPACE',
  Enter: 'ENTER', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
  AltLeft: 'ALT', AltRight: 'ALT GR',
};
function keyName(code) {
  if (!code) return '-';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'PAD ').toUpperCase();
}

function inputBits() {
  const k = settings.keys;
  let b = 0;
  if (down.has(k.left) || touchState.left || pad.left) b |= IN_LEFT;
  if (down.has(k.right) || touchState.right || pad.right) b |= IN_RIGHT;
  if (down.has(k.jump) || touchState.jump || pad.jump) b |= IN_JUMP;
  return b;
}

window.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  unlockAudio();
  const repeat = down.has(e.code) || e.repeat;
  down.add(e.code);
  if (!repeat) scene?.onKey?.(e.code, e);
  else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) scene?.onKey?.(e.code, e, true);
});
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('blur', () => {
  down.clear();
  scene?.onBlur?.();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) scene?.onBlur?.(); });

function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...pads].find((p) => p && p.connected);
  lastPad = pad;
  if (!gp) {
    pad = { left: false, right: false, jump: false, up: false, down: false, start: false };
    return;
  }
  const ax = gp.axes[0] || 0;
  const ay = gp.axes[1] || 0;
  const btn = (i) => !!gp.buttons[i]?.pressed;
  pad = {
    left: ax < -0.5 || btn(14),
    right: ax > 0.5 || btn(15),
    up: ay < -0.5 || btn(12),
    down: ay > 0.5 || btn(13),
    jump: btn(0) || btn(1),
    start: btn(9),
  };
  const edge = (k, code) => { if (pad[k] && !lastPad[k]) { unlockAudio(); scene?.onKey?.(code, null, false, true); } };
  edge('up', 'ArrowUp');
  edge('down', 'ArrowDown');
  edge('left', 'ArrowLeft');
  edge('right', 'ArrowRight');
  edge('jump', 'PadA');
  edge('start', 'PadStart');
}

// Touch controls (shown on touch devices)
function bindTouch(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const on = (e) => { e.preventDefault(); unlockAudio(); touchState[key] = true; el.classList.add('on'); if (key === 'jump') scene?.onKey?.('PadA'); };
  const off = (e) => { e.preventDefault(); touchState[key] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
bindTouch('t-left', 'left');
bindTouch('t-right', 'right');
bindTouch('t-jump', 'jump');
document.getElementById('t-pause')?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  scene?.onKey?.(settings.keys.pause);
});
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
  document.body.classList.add('touch');
  resize();
}

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}
canvas.addEventListener('pointermove', (e) => { const p = canvasPoint(e); scene?.onPointer?.(p.x, p.y, false); });
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  const p = canvasPoint(e);
  scene?.onPointer?.(p.x, p.y, true);
});

let audioReady = false;
function unlockAudio() {
  if (audioReady) return;
  audioReady = true;
  initAudio();
  setVolumes(settings.sfx, settings.music);
  scene?.onAudio?.();
}

// ------------------------------------------------------------------ helpers

const isAction = (code) => code === 'Enter' || code === 'Space' || code === 'PadA' || code === 'NumpadEnter';
const isBack = (code) => code === 'Escape' || code === 'Backspace' || code === 'PadStart';

function character() {
  return characters[settings.character] || characters[0];
}

function fmtTime(ticks) {
  const s = Math.floor(ticks / FPS);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function download(name, data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function askText(title, initial = '', maxLength = 16) {
  return new Promise((resolve) => {
    const box = document.getElementById('prompt');
    const form = box.querySelector('form');
    const input = box.querySelector('input');
    box.querySelector('label').textContent = title;
    input.value = initial;
    input.maxLength = maxLength;
    box.hidden = false;
    down.clear();
    setTimeout(() => { input.focus(); input.select(); }, 30);
    const done = (value) => {
      box.hidden = true;
      form.onsubmit = null;
      box.querySelector('.cancel').onclick = null;
      input.blur();
      resolve(value);
    };
    form.onsubmit = (e) => { e.preventDefault(); done(input.value.trim()); };
    box.querySelector('.cancel').onclick = () => done(null);
  });
}

// Lines of text drawn with the original fonts.
function textBlock(lines, x, y, font = fonts.FONT_MED_BLACK, lh = 26, align = 'left') {
  lines.forEach((l, i) => font.draw(ctx, l, x, y + i * lh, { align }));
}

// ------------------------------------------------------------------- scroller

const SCROLL_TEXT = 'Welcome to Icy Tower!     Help Harold the Homeboy to climb as high as possible!       '
  + 'Use arrow keys to move and spacebar to jump.      Good luck!          '
  + 'Icy Tower (R) is a game by Free Lunch Design - www.freelunchdesign.com - design & code by Johan Peitz, '
  + 'graphics by Emanuel Garnheim, sound & music by SomaTone Interactive Audio.          ';
let scrollX = W;
function drawScroller() {
  const f = fonts.FONT_MED_WHITE;
  const w = f.width(SCROLL_TEXT);
  scrollX -= 1.5;
  if (scrollX < -w) scrollX = W;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 452, W, 28);
  f.draw(ctx, SCROLL_TEXT, scrollX, 452);
}

// --------------------------------------------------------------------- menus

const PANEL = { x: 270, y: 210 };

class MenuScene {
  constructor(items, { onBack = null, title = '', note = '' } = {}) {
    this.items = items;
    this.sel = 0;
    this.onBack = onBack;
    this.title = title;
    this.note = note;
    this.t = 0;
  }

  enter() { playMusic(sfxUrl('BG_MENU')); }
  onAudio() { playMusic(sfxUrl('BG_MENU')); }

  itemY(i) {
    const n = this.items.length;
    const top = PANEL.y + (this.title ? 34 : 22);
    const bottom = PANEL.y + (this.note ? 178 : 222);
    const spacing = Math.min(30, (bottom - top) / n);
    return Math.round(top + (bottom - top - n * spacing) / 2 + i * spacing);
  }

  move(d) {
    this.sel = (this.sel + d + this.items.length) % this.items.length;
    playSfx('MENU_CHANGE');
  }

  activate(it, dir = 0) {
    if (dir && (it.left || it.right)) {
      (dir < 0 ? it.left : it.right)?.();
      playSfx('MENU_CHANGE');
      saveSettings();
      return;
    }
    if (it.action) { playSfx('MENU_CHOOSE'); it.action(); return; }
    if (it.right) { it.right(); playSfx('MENU_CHANGE'); saveSettings(); }
  }

  onKey(code) {
    const it = this.items[this.sel];
    if (code === 'ArrowUp') this.move(-1);
    else if (code === 'ArrowDown') this.move(1);
    else if (code === 'ArrowLeft') this.activate(it, -1);
    else if (code === 'ArrowRight') this.activate(it, 1);
    else if (isAction(code)) this.activate(it);
    else if (isBack(code) && this.onBack) { playSfx('MENU_CHOOSE'); this.onBack(); }
  }

  onPointer(x, y, click) {
    for (let i = 0; i < this.items.length; i++) {
      const iy = this.itemY(i);
      if (y >= iy - 2 && y < iy + 26 && x >= PANEL.x && x < PANEL.x + 360) {
        if (this.sel !== i && !click) { this.sel = i; playSfx('MENU_CHANGE'); }
        if (click) {
          this.sel = i;
          const it = this.items[i];
          const dir = it.left && x < PANEL.x + 200 ? -1 : 1;
          this.activate(it, it.action ? 0 : dir);
        }
        return;
      }
    }
  }

  update() { this.t++; }

  draw() {
    drawTitleBackground(this.t);
    const p = PANEL;
    ctx.drawImage(gfx.MENU_BG, p.x, p.y);
    const f = fonts.FONT_MED_BLACK;
    if (this.title) fonts.FONT_SMALL.draw(ctx, this.title, p.x + 150, p.y + 16, { color: '#7a1010', align: 'center' });
    const indent = this.items.some((it) => it.value) ? 58 : 70;
    this.items.forEach((it, i) => {
      const y = this.itemY(i);
      const label = typeof it.label === 'function' ? it.label() : it.label;
      const value = it.value ? it.value() : '';
      f.draw(ctx, label, p.x + indent, y);
      if (typeof value === 'number') drawSlider(p.x + 178, y + 4, value);
      else if (value) f.draw(ctx, value, p.x + 276, y, { align: 'right' });
      if (i === this.sel) {
        const bob = Math.sin(this.t * 0.2) * 3;
        ctx.drawImage(gfx.MENU_BULLET, p.x + indent - 46 + bob, y - 10);
      }
    });
    if (this.note) {
      const lines = wrap(this.note, fonts.FONT_SMALL, 250);
      lines.forEach((l, i) => fonts.FONT_SMALL.draw(ctx, l, p.x + 150, p.y + 186 + i * 13, { color: '#4a3a20', align: 'center' }));
    }
    drawScroller();
  }
}

function wrap(text, font, width) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.width(t) > width && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function drawTitleBackground(t) {
  ctx.drawImage(gfx.TITLE_BG, 0, 0);
  const bob = Math.sin(t * 0.05) * 3;
  ctx.drawImage(gfx.TITLE, -6, -6 + bob);
}

function drawSlider(x, y, v) {
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i < Math.round(v * 10) ? '#2b5fb4' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(x + i * 10, y + 14 - i, 7, 4 + i);
  }
}
const onOff = (v) => (v ? 'On' : 'Off');
const clamp01 = (v) => Math.max(0, Math.min(1, Math.round(v * 10) / 10));

function mainMenu(sel = 0) {
  const m = new MenuScene([
    { label: 'Play Game', action: () => setScene(playMenu()) },
    { label: 'Instructions', action: () => setScene(new ImageScene('INSTRUCTIONS', () => setScene(mainMenu(1)))) },
    { label: 'Profile', action: () => setScene(new ProfileScene(() => setScene(mainMenu(2)))) },
    { label: 'High Scores', action: () => setScene(new ScoresScene(() => setScene(mainMenu(3)))) },
    { label: 'Load Replay', action: () => setScene(new ReplayListScene(() => setScene(mainMenu(4)))) },
    { label: 'Options', action: () => setScene(optionsMenu()) },
  ]);
  m.sel = sel;
  return m;
}

function playMenu() {
  return new MenuScene([
    { label: 'Classic Game', action: () => startGame(CLASSIC) },
    { label: 'Custom Game', action: () => setScene(customMenu()) },
    { label: 'Back', action: () => setScene(mainMenu(0)) },
  ], { onBack: () => setScene(mainMenu(0)), title: 'PLAY GAME' });
}

const SPEED_NAMES = ['Insane', 'Crazy', 'Fast', 'Quick', 'Normal', 'Slow'];
const FLOOR_NAMES = ['Wide', 'Normal', 'Narrow', 'Tiny', 'Micro'];
const GRAVITY_NAMES = ['Low', 'Normal', 'High'];

function customMenu() {
  const c = settings.custom;
  const cyc = (k, n, d) => () => { c[k] = (c[k] + d + n) % n; };
  return new MenuScene([
    { label: 'Start Game', action: () => startGame({ ...CLASSIC, ...c }) },
    { label: 'Speed', value: () => SPEED_NAMES[c.startSpeed], left: cyc('startSpeed', 6, 1), right: cyc('startSpeed', 6, -1) },
    { label: 'Floors', value: () => FLOOR_NAMES[c.floorSize], left: cyc('floorSize', 5, -1), right: cyc('floorSize', 5, 1) },
    { label: 'Gravity', value: () => GRAVITY_NAMES[c.gravity], left: cyc('gravity', 3, -1), right: cyc('gravity', 3, 1) },
    { label: 'Back', action: () => setScene(playMenu()) },
  ], {
    onBack: () => setScene(playMenu()),
    title: 'CUSTOM GAME',
    note: 'Crazy fun, but custom games do not count for your profile or the high score lists.',
  });
}

function optionsMenu(sel = 0) {
  const m = new MenuScene([
    { label: 'GFX Options', action: () => setScene(gfxMenu()) },
    { label: 'Sound Options', action: () => setScene(soundMenu()) },
    { label: 'Controls', action: () => setScene(controlsMenu()) },
    { label: 'Back', action: () => setScene(mainMenu(5)) },
  ], { onBack: () => setScene(mainMenu(5)), title: 'OPTIONS' });
  m.sel = sel;
  return m;
}

function gfxMenu() {
  const n = characters.length;
  return new MenuScene([
    {
      label: 'Character',
      value: () => character().short,
      left: () => { settings.character = (settings.character + n - 1) % n; },
      right: () => { settings.character = (settings.character + 1) % n; },
    },
    {
      label: 'Start floor',
      value: () => `${settings.startStyle + 1}/${unlockedStyles()}`,
      left: () => { settings.startStyle = (settings.startStyle + unlockedStyles() - 1) % unlockedStyles(); },
      right: () => { settings.startStyle = (settings.startStyle + 1) % unlockedStyles(); },
    },
    { label: 'Eye Candy', value: () => onOff(settings.eyeCandy), right: () => { settings.eyeCandy = !settings.eyeCandy; }, left: () => { settings.eyeCandy = !settings.eyeCandy; } },
    { label: 'Fullscreen', value: () => onOff(!!document.fullscreenElement), action: toggleFullscreen },
    { label: 'Back', action: () => setScene(optionsMenu(0)) },
  ], { onBack: () => setScene(optionsMenu(0)), title: 'GFX OPTIONS', note: 'New start floors are unlocked by climbing higher in classic games.' });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function soundMenu() {
  const adj = (k, d) => () => { settings[k] = clamp01(settings[k] + d); setVolumes(settings.sfx, settings.music); };
  return new MenuScene([
    { label: 'Sound', value: () => settings.sfx, left: adj('sfx', -0.1), right: adj('sfx', 0.1) },
    { label: 'Music', value: () => settings.music, left: adj('music', -0.1), right: adj('music', 0.1) },
    { label: 'Back', action: () => setScene(optionsMenu(1)) },
  ], { onBack: () => setScene(optionsMenu(1)), title: 'SOUND OPTIONS' });
}

function controlsMenu(sel = 0) {
  const bind = (k) => ({
    label: k.toUpperCase(),
    value: () => (rebinding === k ? '???' : keyName(settings.keys[k])),
    action: () => { rebinding = k; },
  });
  const m = new MenuScene([
    bind('left'), bind('right'), bind('jump'), bind('pause'),
    { label: 'ReJump', value: () => onOff(settings.rejump), right: () => { settings.rejump = !settings.rejump; }, left: () => { settings.rejump = !settings.rejump; } },
    { label: 'Back', action: () => setScene(optionsMenu(2)) },
  ], {
    onBack: () => setScene(optionsMenu(2)),
    title: 'CONTROLS',
    note: 'ReJump on: hold jump to keep jumping. Gamepads work too: d-pad to move, button 1 to jump.',
  });
  m.sel = sel;
  const base = m.onKey.bind(m);
  m.onKey = (code) => {
    if (rebinding) {
      if (code !== 'Escape' && code !== 'PadA' && code !== 'PadStart') settings.keys[rebinding] = code;
      rebinding = null;
      saveSettings();
      playSfx('MENU_CHOOSE');
      return;
    }
    base(code);
  };
  return m;
}
let rebinding = null;

// -------------------------------------------------------------- info screens

class ImageScene {
  constructor(img, back) { this.img = img; this.back = back; }
  onKey() { playSfx('MENU_CHOOSE'); this.back(); }
  onPointer(x, y, click) { if (click) this.onKey(); }
  draw() { ctx.drawImage(gfx[this.img], 0, 0); }
}

class ProfileScene {
  constructor(back) { this.back = back; this.t = 0; }
  onKey() { playSfx('MENU_CHOOSE'); this.back(); }
  onPointer(x, y, click) { if (click) this.onKey(); }
  update() { this.t++; }
  draw() {
    drawTitleBackground(this.t);
    const x0 = 103;
    ctx.drawImage(gfx.REPLAY_BG, x0, 25);
    const r = rankId();
    ctx.drawImage(gfx['RANK_' + String(r).padStart(2, '0')], x0 + 290, 60);
    const f = fonts.FONT_MED_BLACK;
    f.draw(ctx, 'PROFILE', x0 + 30, 50);
    const lines = [
      `Name: ${settings.name || 'Guest'}`,
      `Rank: ${RANK_LABELS[r]}`,
      `Games played: ${stats.games}`,
      `Best score: ${stats.bestScore}`,
      `Best floor: ${stats.bestFloor}`,
      `Best combo: ${stats.bestCombo} floors`,
      `Floors climbed: ${stats.floors}`,
      `Jumps: ${stats.jumps}`,
      `Time played: ${fmtTime(stats.ticks)}`,
      `Custom games: ${stats.customGames}`,
    ];
    textBlock(lines, x0 + 30, 90, f, 27);
    if (r < RANK_LABELS.length - 1) {
      const need = `Next rank: floor ${RANK_FLOORS[r + 1]} and a ${RANK_COMBOS[r + 1]} floor combo`;
      wrap(need, fonts.FONT_SMALL, 380).forEach((l, i) => fonts.FONT_SMALL.draw(ctx, l, x0 + 30, 380 + i * 14, { color: '#000000' }));
    }
  }
}

class ScoresScene {
  constructor(back) {
    this.back = back;
    this.tab = 0;
    this.online = null;
    this.t = 0;
    fetchScores().then((d) => { this.online = d; });
  }
  onKey(code) {
    if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Tab') { this.tab ^= 1; playSfx('MENU_CHANGE'); return; }
    playSfx('MENU_CHOOSE');
    this.back();
  }
  onPointer(x, y, click) {
    if (!click) return;
    if (y < 120) { this.tab ^= 1; playSfx('MENU_CHANGE'); } else this.onKey('Escape');
  }
  update() { this.t++; }
  draw() {
    drawTitleBackground(this.t);
    const x0 = 140;
    ctx.drawImage(gfx.HISC_TOP, x0, 10);
    for (let y = 174; y < 380; y += 100) ctx.drawImage(gfx.HISC_MID, x0, y);
    ctx.drawImage(gfx.HISC_BTM, x0, 360);
    const f = fonts.FONT_MED_BLACK;
    const tabs = ['LOCAL', 'ONLINE'];
    tabs.forEach((t, i) => f.draw(ctx, (i === this.tab ? '> ' : '  ') + t + (i === this.tab ? ' <' : '  '), x0 + 110 + i * 140, 90, { align: 'center' }));
    let rows;
    if (this.tab === 0) rows = highScores();
    else if (!this.online) rows = null;
    else rows = this.online.scores;
    const small = fonts.FONT_SMALL;
    const hdrY = 122;
    const cols = [x0 + 30, x0 + 60, x0 + 205, x0 + 260, x0 + 330];
    ['#', 'NAME', 'FLOOR', 'COMBO', 'SCORE'].forEach((h, i) => small.draw(ctx, h, cols[i], hdrY, { color: '#7a1010', align: i > 1 ? 'right' : 'left' }));
    if (!rows) {
      f.draw(ctx, 'Loading...', x0 + 180, 220, { align: 'center' });
    } else if (this.tab === 1 && !this.online.enabled) {
      wrap('The online high score list is not set up on this server yet. See the README to enable it.', small, 280)
        .forEach((l, i) => small.draw(ctx, l, x0 + 180, 200 + i * 16, { color: '#000000', align: 'center' }));
    } else if (!rows.length) {
      f.draw(ctx, 'No scores yet!', x0 + 180, 220, { align: 'center' });
    } else {
      rows.slice(0, this.tab === 0 ? 10 : 20).forEach((r, i) => {
        const y = hdrY + 18 + i * (this.tab === 0 ? 24 : 13);
        const fnt = this.tab === 0 ? f : small;
        const opt = (a) => ({ color: this.tab === 0 ? null : '#000000', align: a });
        fnt.draw(ctx, String(i + 1), cols[0], y, opt('left'));
        fnt.draw(ctx, r.name.slice(0, 12), cols[1], y, opt('left'));
        fnt.draw(ctx, String(r.floor), cols[2], y, opt('right'));
        fnt.draw(ctx, String(r.combo), cols[3], y, opt('right'));
        fnt.draw(ctx, String(r.score), cols[4], y, opt('right'));
      });
    }
  }
}

class ReplayListScene {
  constructor(back) {
    this.back = back;
    this.list = savedReplays();
    this.sel = 0;
    this.top = 0;
    this.t = 0;
  }
  items() { return [{ load: true }, ...this.list]; }
  onKey(code) {
    const n = this.items().length;
    if (code === 'ArrowUp') { this.sel = (this.sel + n - 1) % n; playSfx('MENU_CHANGE'); } else if (code === 'ArrowDown') { this.sel = (this.sel + 1) % n; playSfx('MENU_CHANGE'); } else if (isAction(code)) this.open();
    else if ((code === 'Delete' || code === 'KeyX') && this.sel > 0) {
      deleteReplay(this.sel - 1);
      this.list = savedReplays();
      this.sel = Math.min(this.sel, this.list.length);
      playSfx('MENU_CHOOSE');
    } else if (code === 'KeyD' && this.sel > 0) {
      const r = this.list[this.sel - 1];
      download(`icytower-${r.name || 'replay'}-${r.score}.itr.json`, r);
    } else if (isBack(code)) { playSfx('MENU_CHOOSE'); this.back(); }
  }
  open() {
    playSfx('MENU_CHOOSE');
    if (this.sel === 0) {
      const input = document.getElementById('file');
      input.onchange = async () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        try {
          const r = JSON.parse(await file.text());
          if (!Array.isArray(r.inputs) || !Number.isInteger(r.seed)) throw new Error('bad');
          storeReplay(r);
          this.list = savedReplays();
          this.sel = 1;
        } catch {
          alert('That file is not an Icy Tower web replay.');
        }
      };
      input.click();
      return;
    }
    const r = this.list[this.sel - 1];
    setScene(new GameScene({ replay: r, onExit: () => setScene(this) }));
  }
  onPointer(x, y, click) {
    const i = Math.floor((y - 100) / 26) + this.top;
    if (i >= 0 && i < this.items().length && y >= 100 && y < 100 + 12 * 26) {
      if (this.sel !== i) this.sel = i;
      if (click) this.open();
    } else if (click && y > 410) this.onKey('Escape');
  }
  update() {
    this.t++;
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + 12) this.top = this.sel - 11;
  }
  draw() {
    drawTitleBackground(this.t);
    const x0 = 103;
    ctx.drawImage(gfx.REPLAY_BG, x0, 25);
    const f = fonts.FONT_MED_BLACK;
    const s = fonts.FONT_SMALL;
    f.draw(ctx, 'LOAD REPLAY', x0 + 217, 50, { align: 'center' });
    const items = this.items();
    items.slice(this.top, this.top + 12).forEach((r, k) => {
      const i = k + this.top;
      const y = 100 + k * 26;
      if (i === this.sel) ctx.drawImage(gfx.MENU_BULLET, x0 + 8, y - 12);
      if (r.load) { f.draw(ctx, 'Load from file...', x0 + 50, y); return; }
      f.draw(ctx, `${(r.name || 'Guest').slice(0, 10)}`, x0 + 50, y);
      f.draw(ctx, String(r.score), x0 + 250, y, { align: 'right' });
      s.draw(ctx, `floor ${r.floor}  ${r.date || ''}`, x0 + 262, y + 6, { color: '#333333' });
    });
    s.draw(ctx, 'ENTER watch   D download   DEL delete   ESC back', x0 + 217, 420, { color: '#000000', align: 'center' });
  }
}

// ------------------------------------------------------------------- game

function startGame(opts) {
  setScene(new GameScene({ opts }));
}

class GameScene {
  constructor({ opts = CLASSIC, replay = null, onExit = null }) {
    this.replay = replay;
    this.onExit = onExit;
    if (replay) {
      this.frames = decodeInputs(replay.inputs);
      this.char = characters.find((c) => c.key === replay.character) || character();
      this.g = createGame(replay.seed, replay.opts || CLASSIC, replay.rejump);
      this.startStyle = replay.startStyle || 0;
    } else {
      this.char = character();
      this.opts = { ...CLASSIC, ...opts };
      this.g = createGame((Math.random() * 32768) | 0, this.opts, settings.rejump);
      this.startStyle = settings.startStyle;
    }
    this.inputs = [];
    this.view = createView();
    this.paused = false;
    this.post = 0;
    this.ff = false;
    this.deathSound = null;
    this.greeting = null;
  }

  enter() { this.startAudio(); }
  onAudio() { this.startAudio(); }
  startAudio() {
    const snd = this.char.sounds;
    playMusic(snd.bgmusic || sfxUrl('BG_BEAT'));
    if (!this.greeted) {
      this.greeted = true;
      this.greeting = play(snd.greeting);
    }
  }

  onBlur() { if (!this.replay && !this.g.p.dead) this.setPaused(true); }

  setPaused(p) {
    if (this.paused === p) return;
    this.paused = p;
    if (p) {
      stopMusic();
      play(this.char.sounds.pause);
    } else {
      playMusic(this.char.sounds.bgmusic || sfxUrl('BG_BEAT'));
    }
  }

  onKey(code) {
    if (this.replay) {
      if (isBack(code)) this.exit();
      else if (code === 'KeyF' || code === 'ArrowRight') this.ff = !this.ff;
      else if (code === 'KeyP' || code === settings.keys.pause) this.paused = !this.paused;
      else if (this.g.p.dead && this.post > 30) this.exit();
      return;
    }
    if (this.paused) {
      if (code === 'Escape') this.quit();
      else if (code === settings.keys.pause || code === 'PadStart' || isAction(code)) this.setPaused(false);
      return;
    }
    if (code === settings.keys.pause || code === 'Escape' || code === 'PadStart') {
      if (!this.g.p.dead) this.setPaused(true);
      return;
    }
    if (this.g.p.dead && this.post > 40 && (isAction(code) || code === settings.keys.jump)) this.toResults();
  }

  onPointer(x, y, click) {
    if (!click) return;
    if (this.paused) {
      if (y > 260 && y < 300) this.quit(); else this.setPaused(false);
    } else if (this.replay && this.g.p.dead) this.exit();
    else if (this.g.p.dead && this.post > 40) this.toResults();
  }

  quit() {
    stopMusic();
    this.greeting?.stop();
    setScene(mainMenu(0));
  }

  exit() {
    stopMusic();
    (this.onExit || (() => setScene(mainMenu(4))))();
  }

  tick() {
    const g = this.g;
    let bits = 0;
    if (!g.p.dead) {
      if (this.replay) bits = this.frames[g.frame] ?? 0;
      else {
        bits = inputBits();
        this.inputs.push(bits);
      }
    }
    step(g, bits);
    const snd = this.char.sounds;
    for (const e of g.events) {
      switch (e.type) {
        case 'jump': play(e.sy <= -22 ? snd.jumphi : e.sy <= -15 ? snd.jumpmed : snd.jumplo); break;
        case 'land': playSfx('STEP'); break;
        case 'reward':
          playSfx(COMBO_SOUNDS[e.index]);
          startReward(this.view, e.index);
          break;
        case 'speedup': playSfx('RING'); playSfx('HURRYUP'); break;
        case 'milestone':
          playSfx('AIGHT');
          if (settings.eyeCandy) for (let i = 0; i < e.floor / 2 && i < 200; i++) spawnStars(this.view, 20 + Math.random() * 600, 480, 1, 1.6);
          break;
        case 'edge': play(snd.edge); break;
        case 'death':
          stopMusic();
          this.deathSound = play(snd.death);
          this.onDeath();
          break;
        case 'gameOverVoice': playSfx('GAMEOVER'); break;
        case 'splat': this.deathSound?.stop(); playSfx('SPLAT'); break;
        default:
      }
    }
    updateView(this.view, g, settings.eyeCandy);
    if (g.p.dead) {
      this.post++;
      if (this.post > 230) {
        if (this.replay) this.exit(); else this.toResults();
      }
    }
  }

  onDeath() {
    if (this.replay) return;
    const g = this.g;
    const classic = isClassic(this.opts);
    this.result = {
      score: score(g),
      floor: g.p.level,
      combo: g.p.bestCombo,
      ticks: g.frame,
      classic,
      pb: classic && score(g) > stats.bestScore,
      replay: {
        v: SIM_VERSION,
        seed: g.seed,
        opts: this.opts,
        rejump: g.rejump,
        character: this.char.key,
        startStyle: this.startStyle,
        inputs: encodeInputs(this.inputs),
        score: score(g),
        floor: g.p.level,
        combo: g.p.bestCombo,
        date: new Date().toISOString().slice(0, 10),
        name: settings.name || 'Guest',
      },
    };
    recordGame(g, this.result.score, classic);
  }

  toResults() {
    if (this.leaving) return;
    this.leaving = true;
    setScene(new ResultsScene(this));
  }

  update(steps) {
    if (this.paused) return;
    const n = this.replay && this.ff ? steps * 4 : steps;
    for (let i = 0; i < n; i++) this.tick();
  }

  draw() {
    drawGame(ctx, this.g, this.view, {
      character: this.char,
      startStyle: this.startStyle,
      eyeCandy: settings.eyeCandy,
      replay: !!this.replay,
    });
    if (this.replay) fonts.FONT_SMALL.draw(ctx, this.ff ? 'FAST FORWARD (F)' : 'F: fast forward  ESC: exit', 320, 30, { align: 'center' });
    if (this.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      fonts.FONT_BIG_WHITE.draw(ctx, 'PAUSED', 320, 170, { align: 'center' });
      fonts.FONT_MED_WHITE.draw(ctx, `Press ${keyName(settings.keys.pause)} to continue`, 320, 230, { align: 'center' });
      fonts.FONT_MED_WHITE.draw(ctx, 'Press ESC to quit', 320, 262, { align: 'center' });
    }
  }
}

class ResultsScene {
  constructor(game) {
    this.game = game;
    this.r = game.result;
    this.t = 0;
    this.saved = false;
    this.submitted = null;
    this.message = '';
    this.items = [];
    this.sel = 0;
    this.buildItems();
    playMusic(sfxUrl('BG_MENU'));
    if (this.r.classic && qualifies(this.r.score)) {
      this.awaitingName = true;
      askText('NEW HIGH SCORE! Enter your name:', settings.name || '').then((name) => {
        this.awaitingName = false;
        if (name) {
          settings.name = name;
          saveSettings();
          this.r.replay.name = name;
          this.rank = addHighScore({ name, score: this.r.score, floor: this.r.floor, combo: this.r.combo, date: this.r.replay.date });
          playSfx('CHEER');
        }
      });
    }
    fetchScores().then(() => this.buildItems());
  }

  buildItems() {
    const items = [
      { label: 'Play Again', action: () => startGame(this.game.opts) },
      { label: 'Watch Replay', action: () => setScene(new GameScene({ replay: this.r.replay, onExit: () => setScene(this) })) },
      { label: this.saved ? 'Replay Saved!' : 'Save Replay', action: () => this.saveReplay() },
    ];
    if (onlineAvailable() && this.r.classic) items.push({ label: this.submitted ? 'Submitted!' : 'Submit Online', action: () => this.submit() });
    items.push({ label: 'View Profile', action: () => setScene(new ProfileScene(() => setScene(this))) });
    items.push({ label: 'Main Menu', action: () => setScene(mainMenu(0)) });
    this.items = items;
    this.sel = Math.min(this.sel, items.length - 1);
  }

  async saveReplay() {
    if (this.saved) return;
    const name = await askText('Save replay as (your name):', settings.name || '');
    if (name === null) return;
    if (name) { settings.name = name; saveSettings(); this.r.replay.name = name; }
    this.saved = storeReplay(this.r.replay);
    this.message = this.saved ? 'Saved! Find it under Load Replay.' : 'Could not save (storage full?)';
    this.buildItems();
  }

  async submit() {
    if (this.submitted) return;
    let name = settings.name;
    if (!name) {
      name = await askText('Your name for the online high scores:', '');
      if (!name) return;
      settings.name = name;
      saveSettings();
    }
    this.message = 'Submitting...';
    try {
      const res = await submitScore(name, this.r.replay);
      this.submitted = true;
      this.message = res.rank ? `You are #${res.rank} in the world!` : 'Submitted!';
    } catch (e) {
      this.message = `Submit failed: ${e.message}`;
    }
    this.buildItems();
  }

  onKey(code) {
    if (this.awaitingName) return;
    if (code === 'ArrowUp') { this.sel = (this.sel + this.items.length - 1) % this.items.length; playSfx('MENU_CHANGE'); } else if (code === 'ArrowDown') { this.sel = (this.sel + 1) % this.items.length; playSfx('MENU_CHANGE'); } else if (isAction(code)) { playSfx('MENU_CHOOSE'); this.items[this.sel].action(); } else if (isBack(code)) setScene(mainMenu(0));
  }

  onPointer(x, y, click) {
    if (this.awaitingName) return;
    for (let i = 0; i < this.items.length; i++) {
      const iy = 250 + i * 27;
      if (y >= iy - 2 && y < iy + 25 && x > 150 && x < 490) {
        this.sel = i;
        if (click) { playSfx('MENU_CHOOSE'); this.items[i].action(); }
      }
    }
  }

  update() { this.t++; }

  draw() {
    this.game.draw();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    const x0 = 103;
    ctx.drawImage(gfx.REPLAY_BG, x0, 25);
    const f = fonts.FONT_MED_BLACK;
    f.draw(ctx, this.r.classic ? 'GAME OVER' : 'GAME OVER (custom game)', 320, 45, { align: 'center' });
    const lines = [
      ['Score', this.r.score],
      ['Floor', this.r.floor],
      ['Best combo', `${this.r.combo} floors`],
      ['Time', fmtTime(this.r.ticks)],
    ];
    lines.forEach(([k, v], i) => {
      f.draw(ctx, k, x0 + 60, 85 + i * 28);
      f.draw(ctx, String(v), x0 + 370, 85 + i * 28, { align: 'right' });
    });
    if (this.r.pb) ctx.drawImage(gfx.ICON_PB, x0 + 30, 88);
    if (this.rank != null && this.rank >= 0) {
      ctx.drawImage(gfx.ICON_HS, x0 + 30, 116);
      fonts.FONT_SMALL.draw(ctx, `#${this.rank + 1} on your high score list!`, 320, 200, { color: '#7a1010', align: 'center' });
    }
    if (this.message) fonts.FONT_SMALL.draw(ctx, this.message, 320, 218, { color: '#000000', align: 'center' });
    this.items.forEach((it, i) => {
      const y = 250 + i * 27;
      f.draw(ctx, it.label, x0 + 110, y);
      if (i === this.sel) ctx.drawImage(gfx.MENU_BULLET, x0 + 60 + Math.sin(this.t * 0.2) * 3, y - 10);
    });
  }
}

// ----------------------------------------------------------------- startup

class LoadingScene {
  constructor() { this.progress = 0; this.ready = false; }
  draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2d6fd6';
    ctx.fillRect(170, 236, 300 * this.progress, 10);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(170.5, 236.5, 300, 10);
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Loading Icy Tower...', 320, 220);
  }
}

class SplashScene {
  constructor() { this.t = 0; }
  onKey() { this.go(); }
  onPointer(x, y, click) { if (click) this.go(); }
  go() {
    unlockAudio();
    setScene(mainMenu(0));
  }
  update() { this.t++; }
  draw() {
    drawTitleBackground(this.t);
    if ((this.t >> 4) % 2 === 0) fonts.FONT_BIG_WHITE.draw(ctx, 'PRESS ANY KEY', 440, 380, { align: 'center' });
    drawScroller();
  }
}

let scene = new LoadingScene();
function setScene(s) {
  scene = s;
  s.enter?.();
}

let acc = 0;
let last = performance.now();
const STEP_MS = 1000 / FPS;

function frame(now) {
  pollPad();
  acc += Math.min(250, now - last);
  last = now;
  let steps = 0;
  while (acc >= STEP_MS) {
    acc -= STEP_MS;
    steps++;
  }
  if (steps) {
    if (scene.update?.length) scene.update(steps);
    else for (let i = 0; i < steps; i++) scene.update?.();
  }
  begin();
  scene.draw?.();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

loadAll((p) => { scene.progress = p; })
  .then(() => {
    setVolumes(settings.sfx, settings.music);
    setScene(new SplashScene());
  })
  .catch((e) => {
    console.error(e);
    scene.draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f66';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Failed to load game data: ' + e.message, 320, 240);
    };
  });

window.icyTower = { get scene() { return scene; }, setScene, mainMenu };
