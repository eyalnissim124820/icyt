// localStorage wrappers. Every access is guarded: storage can be unavailable
// (private mode, blocked site data) and the game must still run.

const PREFIX = 'icytower.';

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function loadList(key) {
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_KEYS = { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Space', pause: 'KeyP' };

export const settings = load('settings', {
  sfx: 0.8,
  music: 0.6,
  rejump: false,
  eyeCandy: true,
  character: 0,
  startStyle: 0,
  name: '',
  custom: { startSpeed: 5, floorSize: 1, gravity: 1 },
});
settings.keys = { ...DEFAULT_KEYS, ...(settings.keys || {}) };

export function saveSettings() {
  save('settings', settings);
}

export const stats = load('profile', {
  games: 0,
  customGames: 0,
  floors: 0,
  jumps: 0,
  combos: 0,
  bestFloor: 0,
  bestScore: 0,
  bestCombo: 0,
  ticks: 0,
});

export function recordGame(g, sc, classic) {
  if (!classic) {
    stats.customGames++;
    save('profile', stats);
    return;
  }
  stats.games++;
  stats.floors += g.p.level;
  stats.jumps += g.jumps;
  stats.ticks += g.frame;
  stats.bestFloor = Math.max(stats.bestFloor, g.p.level);
  stats.bestScore = Math.max(stats.bestScore, sc);
  stats.bestCombo = Math.max(stats.bestCombo, g.p.bestCombo);
  save('profile', stats);
}

// Rank tables from the original (rankLables / rankFloors / rankCombos).
export const RANK_LABELS = ['no rank', 'F', 'E', 'D', 'C', 'B', 'A', '*', '**', '***', '****', '*****'];
export const RANK_FLOORS = [0, 50, 100, 150, 200, 300, 400, 500, 600, 750, 1000, 1500];
export const RANK_COMBOS = [0, 0, 7, 15, 25, 35, 70, 120, 200, 300, 400, 650];

export function rankId() {
  let r = 0;
  for (let i = 1; i < RANK_LABELS.length; i++) {
    if (stats.bestFloor >= RANK_FLOORS[i] && stats.bestCombo >= RANK_COMBOS[i]) r = i;
  }
  return r;
}

// Start floor styles unlock as the profile climbs higher.
export function unlockedStyles() {
  return Math.min(10, 1 + Math.floor(stats.bestFloor / 100));
}

export function highScores() {
  return loadList('scores');
}

export function qualifies(sc) {
  if (sc <= 0) return false;
  const list = highScores();
  return list.length < 10 || sc > list[list.length - 1].score;
}

export function addHighScore(entry) {
  const list = highScores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list.length = Math.min(list.length, 10);
  save('scores', list);
  return list.indexOf(entry);
}

export function savedReplays() {
  return loadList('replays');
}

export function storeReplay(replay) {
  const list = savedReplays();
  list.unshift(replay);
  while (list.length > 30) list.pop();
  while (list.length && !save('replays', list)) list.pop();
  return list.length > 0;
}

export function deleteReplay(index) {
  const list = savedReplays();
  list.splice(index, 1);
  save('replays', list);
}
