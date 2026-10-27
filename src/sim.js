// Icy Tower 1.5.1 game logic, ported from the original executable
// (player.c, map.c and play() in main.c). Runs at a fixed 50 ticks/second.
//
// This module is pure and deterministic: the browser uses it to play and to
// replay games, and /api/scores re-runs submitted replays to verify scores.
// All coordinates are screen space (640x480); the tower scrolls by shifting
// a ring of 32 map rows, exactly like the original.

export const W = 640;
export const H = 480;
export const FPS = 50;
export const SIM_VERSION = 1;

export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;

// Physics tables from the original (collision_type 2 is what v1.5 uses).
const MAX_SPEED = 12.2;
const GRAVITY_MODIFIER = [-0.2, 0, 0.2];
const FLOOR_SIZE_MODIFIERS = [2, 0, -2, -4, -6];
const START_SPEEDS = [5, 4, 3, 2, 1, 0];
const SPEEDUP_FRAMES = [1500, 3000, 4500, 6000, 7500, 9000, 10500, 1800000, 9000000];
const NO_FLOOR = -12345678;

export const CLASSIC = { floorShrink: 1, floorSize: 1, startSpeed: 5, speedIncrease: 1, gravity: 1 };

export const REWARD_LIMITS = [6, 14, 24, 34, 49, 69, 99, 139, 199];
export function rewardIndex(floors) {
  let i = 0;
  while (i < REWARD_LIMITS.length && floors > REWARD_LIMITS[i]) i++;
  return i;
}

export function isClassic(o) {
  return o.floorShrink === CLASSIC.floorShrink && o.floorSize === CLASSIC.floorSize &&
    o.startSpeed === CLASSIC.startSpeed && o.speedIncrease === CLASSIC.speedIncrease &&
    o.gravity === CLASSIC.gravity;
}

// MSVCRT rand(), which the original seeds with the replay seed.
function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 214013) + 2531011) >>> 0;
    return (s >>> 16) & 0x7fff;
  };
}

const trunc = (v) => (Number.isFinite(v) ? Math.trunc(v) : -2147483648);
const idiv = (a, b) => (a / b) | 0;

// --------------------------------------------------------------------- map

function emptyRoom() {
  return { empty: -1, start: 0, end: 0, level: 0, sign: 0, tiles: 0 };
}

function addFloor(g) {
  const r = g.rooms;
  for (let i = 0; i < 31; i++) r[i] = { ...r[i + 1] };
  const room = r[31];
  const lvl = room.level;
  room.tiles = lvl > 4999 ? 10 : idiv(lvl, 1000);
  if ((lvl % 250 === 0 && lvl <= 5004) || lvl % 2500 === 0) {
    room.empty = 0;
    room.level = lvl + 1;
    room.start = 0;
    room.end = 40;
  } else if (lvl % 5 !== 0) {
    room.empty = -1;
    room.level = lvl + 1;
  } else {
    room.empty = 0;
    room.level = lvl + 1;
    const L = room.level;
    let w;
    if (g.opts.floorShrink) {
      if (L <= 2999) {
        const rr = g.rand();
        const f = ((300 - idiv(L, 5)) / 300) * 10;
        w = 1 > f ? 6 : (rr % trunc(f)) + 6;
      } else if (L <= 5004) w = 6;
      else if (L <= 7504) w = 5;
      else if (L <= 10004) w = 4;
      else w = L < 50005 ? 3 : 2;
    } else {
      w = (g.rand() % 10) + 6;
    }
    const m = FLOOR_SIZE_MODIFIERS[g.opts.floorSize];
    let span;
    if (w + m > 0) { w += m; span = 30 - w; } else { w = 1; span = 29; }
    room.start = (g.rand() % span) + 5;
    room.end = room.start + w;
  }
  room.sign = lvl % 50 === 0 ? idiv(room.level, 5) : 0;
}

function roomAt(g, y) {
  const row = (y + 1) >> 4;
  const i = 29 - row;
  return i < 0 || i > 31 ? null : { room: g.rooms[i], row };
}

function getLevel(g, y) {
  const r = roomAt(g, y);
  return r ? r.room.level : 0;
}

function getFloorData(g, y) {
  const r = roomAt(g, y);
  if (!r || r.room.empty !== 0) return null;
  return { fx1: r.room.start * 16 - 2, fx2: r.room.end * 16 + 17, fy: r.row * 16 + (g.offset % 16) };
}

// Screen y of a map room's top (used by the renderer).
export function roomY(g, i) {
  return (29 - i) * 16 + (g.offset % 16);
}

// ------------------------------------------------------------------- game

export function createGame(seed, opts = CLASSIC, rejump = false) {
  const g = {
    seed: seed & 0x7fff,
    opts: { ...CLASSIC, ...opts },
    rejump: !!rejump,
    rand: makeRand(seed & 0x7fff),
    rooms: Array.from({ length: 32 }, emptyRoom),
    offset: 0,
    frame: 0,
    fallCount: 0,
    clock: 0,
    speed: -1,
    speedIdx: 0,
    hurryY: 480,
    nextMilestone: 50,
    deathCounter: 0,
    gameOverVoice: false,
    p: {
      x: 200, y: 431, sx: 0.001, sy: 0,
      level: 0, score: 0, bestCombo: 0, status: 0, jumpKey: 1,
      inCombo: 0, accLevel: 0, accJumps: 0, dead: 0,
      rotate: 0, angle: 0, edge: 0, edgeDrawn: 0, bounce: 0, shake: 0,
      latestCombo: 0, biggestLostCombo: 0, anim: 0,
    },
    jumps: 0,
    events: [],
  };
  for (let i = 0; i < 30; i++) addFloor(g);
  return g;
}

export function score(g) {
  return g.p.level * 10 + g.p.score;
}

function jumpPlayer(g) {
  const p = g.p;
  if (p.status !== 0) return false;
  p.status = 1;
  const j = -2 * Math.abs(p.sx);
  p.sy = j < -MAX_SPEED ? j : -MAX_SPEED;
  if (-22 > p.sy) p.rotate = 1;
  p.angle = 0;
  g.jumps++;
  g.events.push({ type: 'jump', sy: p.sy });
  return true;
}

function handleInput(g, input) {
  const p = g.p;
  const fire = (input & IN_JUMP) !== 0;
  if (input & IN_LEFT) {
    if (p.sx > 0) p.sx *= 0.7;
    p.sx -= 0.3;
  } else if (input & IN_RIGHT) {
    if (0 > p.sx) p.sx *= 0.7;
    p.sx += 0.3;
  } else {
    p.sx *= 0.9;
  }
  if (g.rejump) {
    if (fire) jumpPlayer(g);
  } else {
    if (fire && p.jumpKey === 0 && jumpPlayer(g)) p.jumpKey = -1;
    if (!fire) p.jumpKey = 0;
  }
}

function updatePlayer(g) {
  const p = g.p;
  if (p.sy < -100) p.sy = -100;
  if (p.sy > MAX_SPEED) p.sy = MAX_SPEED;
  if (p.sx < -MAX_SPEED) p.sx = -MAX_SPEED;
  if (p.sx > MAX_SPEED) p.sx = MAX_SPEED;
  p.x += p.sx;
  p.y += p.sy;
  if (p.y > 1000) p.y = 1000;
  if (p.x > 555) {
    p.x = 555;
    p.sx *= -0.9;
    if (Math.abs(p.sx) > 4) { p.bounce = -20; g.events.push({ type: 'bump' }); }
  } else if (85 > p.x) {
    p.x = 85;
    p.sx *= -0.9;
    if (Math.abs(p.sx) > 4) { p.bounce = 20; g.events.push({ type: 'bump' }); }
  }
  if (p.status === 0) return;
  p.sy = 0.8 + GRAVITY_MODIFIER[g.opts.gravity] + p.sy;
  if (p.status === 1 && p.sy > 0) p.status = 2;
}

function lineIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  const r = ((ax - cx) * (cy - dy) + (ay - cy) * (dx - cx)) / denom;
  if (0 > r) return null;
  const s = ((ay - cy) * (bx - ax) + (ay - by) * (ax - cx)) / denom;
  if (0 > s || r > 1 || s > 1) return null;
  return {
    x: (trunc(r * (bx - ax) + 0.5) + ax) | 0,
    y: (trunc(r * (by - ay) + 0.5) + ay) | 0,
  };
}

function handleCollision(g, lastX, lastY) {
  const p = g.p;
  const py = trunc(p.y);
  const f = getFloorData(g, py) || getFloorData(g, lastY);
  if (!f) {
    if (p.status === 2 || p.status === 0) p.status = 3;
    return;
  }
  const px = trunc(p.x);
  const c1 = lineIntersect(f.fx1, f.fy, f.fx2, f.fy, px - 11, py + 1, lastX - 11, lastY);
  const c2 = lineIntersect(f.fx1, f.fy, f.fx2, f.fy, px + 11, py + 1, lastX + 11, lastY);
  if (!c1 && !c2) {
    if (p.status === 2 || p.status === 0) p.status = 3;
    p.edge = 0;
    return;
  }
  p.edge = c1 && c2 ? 0 : c1 ? 1 : 2;
  if (p.status !== 2 && p.status !== 3) return;
  if (c1 && c2 && (c1.x < -10000 || c2.x < -10000 || c1.x > 10000 || c2.x > 10000)) return;
  p.status = 0;
  p.sy = 0;
  p.y = f.fy - 1;
  p.x = c1 ? c1.x + 11 : c2.x - 11;
  p.rotate = 0;
  g.events.push({ type: 'land' });
}

function startReward(g, floors) {
  g.events.push({ type: 'reward', floors, index: rewardIndex(floors) });
}

function landingLogic(g) {
  const p = g.p;
  const nf = idiv(getLevel(g, trunc(p.y)) - 1, 5);
  if (nf < p.level) {
    if (p.inCombo) p.inCombo = 1;
  } else {
    const d = nf - p.level;
    if (d >= 2) {
      if (p.inCombo) { p.accLevel += d; p.accJumps++; } else { p.accLevel = d; p.accJumps = 1; }
      p.inCombo = 100;
      g.events.push({ type: 'combo', floors: p.accLevel, jumps: p.accJumps });
    } else if (d === 1 && p.inCombo) {
      p.inCombo = 1;
    }
  }
  p.level = nf;
}

// One logic tick (20ms). `input` is a bitmask of IN_LEFT | IN_RIGHT | IN_JUMP.
export function step(g, input) {
  g.events.length = 0;
  const p = g.p;
  g.frame++;
  g.fallCount++;
  const lastX = trunc(p.x);
  let lastY = trunc(p.y);

  handleInput(g, input);
  updatePlayer(g);

  // scrolling: catch up quickly when the player is high on the screen
  const oldOffset = g.offset;
  let scrolled = 0;
  if (160 > p.y) {
    let k = 140 > p.y ? 2 : 1;
    if (120 > p.y) k++;
    if (100 > p.y) k++;
    if (80 > p.y) k++;
    if (60 > p.y) k++;
    if (40 > p.y) k += 2;
    if (20 > p.y) k += 2;
    if (0 > p.y) k += 3;
    g.offset = oldOffset + k;
    p.y += k;
    lastY += k;
    scrolled = k;
  }
  if (!p.dead) g.clock++;
  if (g.offset <= 100) {
    if (!p.dead) { g.clock = 0; g.fallCount = 0; }
  } else if (!p.dead) {
    if (g.speed === -1) {
      g.speed = START_SPEEDS[g.opts.startSpeed];
      g.events.push({ type: 'scrollStart' });
    }
    const s = g.speed !== 0 ? g.speed : g.frame & 1;
    g.offset += s;
    scrolled += s;
    p.y += s;
    lastY += s;
  }

  if ((g.hurryY + 99) >>> 0 <= 578) g.hurryY -= 2;
  if (g.opts.speedIncrease && !p.dead && SPEEDUP_FRAMES[g.speedIdx] < g.fallCount && g.speed <= 4) {
    g.speedIdx++;
    g.speed++;
    g.hurryY = 479;
    g.events.push({ type: 'speedup', speed: g.speed });
  }
  if (g.speed === 5) {
    g.fallCount -= 45;
    if (!p.dead) g.clock -= 45;
  }

  if (oldOffset % 16 > g.offset % 16 || scrolled > 15) addFloor(g);
  handleCollision(g, lastX, lastY);

  if (p.rotate) p.angle += 8;
  if (p.inCombo) {
    p.inCombo--;
    if (p.inCombo === 0 && p.accJumps > 1) {
      p.score += p.accLevel * p.accLevel;
      p.latestCombo = p.accLevel;
      if (p.accLevel > p.bestCombo) p.bestCombo = p.accLevel;
      startReward(g, p.accLevel);
    } else if (p.inCombo === 0) {
      g.events.push({ type: 'comboEnd' });
    }
  }

  if (p.status === 0) landingLogic(g);

  if (p.y > 540 && !p.dead) {
    if (p.inCombo && p.accJumps > 1) p.biggestLostCombo = p.accLevel;
    p.inCombo = 0;
    p.dead = 1;
    g.deathCounter = 1;
    g.events.push({ type: 'death' });
  }

  if (p.dead) {
    if (p.y > 900 && !g.gameOverVoice) {
      g.gameOverVoice = true;
      g.events.push({ type: 'gameOverVoice' });
    }
    if (g.deathCounter) {
      g.deathCounter++;
      if (g.deathCounter > p.level * 5 || g.deathCounter > 250) {
        g.deathCounter = 0;
        p.shake = 24;
        g.events.push({ type: 'splat' });
      }
    }
  }

  if (g.nextMilestone <= p.level) {
    g.events.push({ type: 'milestone', floor: g.nextMilestone });
    g.nextMilestone += g.nextMilestone > 999 ? 500 : 50;
  }

  if (!p.edge) p.edgeDrawn = 0;
  if (p.edgeDrawn === 11 && p.status === 0) g.events.push({ type: 'edge' });
  if (p.edgeDrawn === 50) p.edgeDrawn = 0;
  if (p.shake) p.shake--;

  // update_frame()
  if (p.dead && p.dead <= 299) p.dead += 8;
  if (p.edge) p.edgeDrawn++;
  if (g.frame % 10 === 0) p.anim++;
}

// True once the game is over and the result screen should be shown.
export function finished(g) {
  return g.p.dead > 100;
}

// --- Replays: per-tick input bits, run-length encoded -------------------

export function encodeInputs(frames) {
  const out = [];
  for (let i = 0; i < frames.length;) {
    const v = frames[i];
    let n = 1;
    while (i + n < frames.length && frames[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

export function decodeInputs(rle, maxFrames = Infinity) {
  const frames = [];
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const v = rle[i] & 7;
    const n = rle[i + 1] | 0;
    if (n <= 0) continue;
    if (frames.length + n > maxFrames) throw new Error('replay too long');
    for (let k = 0; k < n; k++) frames.push(v);
  }
  return frames;
}

// Runs a replay headlessly until the player dies. Returns the final state.
export function simulateReplay(replay, maxFrames = Infinity) {
  const frames = decodeInputs(replay.inputs, maxFrames);
  const g = createGame(replay.seed, replay.opts, replay.rejump);
  for (let i = 0; i < frames.length && !g.p.dead; i++) step(g, frames[i]);
  return g;
}
