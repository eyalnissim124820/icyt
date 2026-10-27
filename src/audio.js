// Sample playback with WebAudio. The original sounds are Ogg Vorbis; browsers
// that can't decode Ogg (older Safari) get the MP3 copies instead.

let ctx = null;
let sfxGain = null;
let musicGain = null;
const buffers = new Map();
const pending = new Map();
let ext = 'ogg';
let music = null;
let musicKey = null;
const vol = { sfx: 0.8, music: 0.6 };

export const SFX = [
  'AIGHT', 'AMAZING', 'BG_BEAT', 'BG_MENU', 'CHEER', 'EXTREME', 'FANTASTIC', 'GAMEOVER', 'GOOD', 'GREAT',
  'HURRYUP', 'MENU_CHANGE', 'MENU_CHOOSE', 'RING', 'SPLAT', 'SPLENDID', 'STEP', 'SUPER', 'SWEET',
  'TRYAGAIN', 'UNBELIEVABLE', 'WOW',
];
// combo_sound[] in the original, indexed by reward level
export const COMBO_SOUNDS = ['GOOD', 'SWEET', 'GREAT', 'SUPER', 'WOW', 'AMAZING', 'EXTREME', 'FANTASTIC', 'SPLENDID', 'UNBELIEVABLE'];

export function sfxUrl(name) {
  return `assets/sfx/S_${name}`;
}

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const probe = document.createElement('audio');
  ext = probe.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3';
  sfxGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain.connect(ctx.destination);
  musicGain.connect(ctx.destination);
  setVolumes(vol.sfx, vol.music);
  for (const n of SFX) load(sfxUrl(n));
}

export function setVolumes(sfx, mus) {
  vol.sfx = sfx;
  vol.music = mus;
  if (!ctx) return;
  sfxGain.gain.value = sfx;
  musicGain.gain.value = mus;
}

// Resolves to an AudioBuffer (or null). `url` is given without extension.
export function load(url) {
  if (!ctx || !url) return Promise.resolve(null);
  if (buffers.has(url)) return Promise.resolve(buffers.get(url));
  if (pending.has(url)) return pending.get(url);
  const p = fetch(`${url}.${ext}`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
    .then((data) => new Promise((res, rej) => ctx.decodeAudioData(data, res, rej)))
    .then((buf) => { buffers.set(url, buf); return buf; })
    .catch(() => { buffers.set(url, null); return null; });
  pending.set(url, p);
  return p;
}

// Plays a sample once. Returns a handle with stop().
export function play(url, { gain = 1 } = {}) {
  if (!ctx || !url) return null;
  const handle = { src: null, stopped: false, stop() { this.stopped = true; try { this.src?.stop(); } catch { /* already stopped */ } } };
  load(url).then((buf) => {
    if (!buf || handle.stopped) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(sfxGain);
    src.start();
    handle.src = src;
  });
  return handle;
}

export function playSfx(name) {
  return play(sfxUrl(name));
}

export function playMusic(url) {
  if (!ctx || musicKey === url) return;
  stopMusic();
  musicKey = url;
  load(url).then((buf) => {
    if (!buf || musicKey !== url) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(musicGain);
    src.start();
    music = src;
  });
}

export function stopMusic() {
  musicKey = null;
  if (music) {
    try { music.stop(); } catch { /* already stopped */ }
    music = null;
  }
}

export function pauseAll(paused) {
  if (!ctx) return;
  if (paused) ctx.suspend(); else ctx.resume();
}
