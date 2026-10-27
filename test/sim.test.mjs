// Headless checks for the deterministic simulation: run with `node test/sim.test.mjs`.
import assert from 'node:assert/strict';
import { createGame, step, score, encodeInputs, simulateReplay, IN_LEFT, IN_RIGHT, IN_JUMP, roomY } from '../src/sim.js';

// A simple bot: walk toward the middle of the next floor up and jump from below it.
function bot(g) {
  const p = g.p;
  const above = g.rooms.filter((r) => !r.empty && roomY(g, g.rooms.indexOf(r)) < p.y - 20)
    .sort((a, b) => b.level - a.level).pop();
  if (!above) return 0;
  const cx = (above.start + above.end) * 8 + 8;
  const dir = cx > p.x + 4 ? IN_RIGHT : cx < p.x - 4 ? IN_LEFT : 0;
  const under = Math.abs(cx - p.x) < (above.end - above.start) * 8;
  return dir | (p.status === 0 && under && g.frame % 2 ? IN_JUMP : 0);
}

function play(seed) {
  const g = createGame(seed);
  const inputs = [];
  let lands = 0, maxLevel = 0, combos = 0;
  while (!g.p.dead && g.frame < 50 * 60 * 5) {
    const i = bot(g);
    inputs.push(i);
    step(g, i);
    for (const e of g.events) { if (e.type === 'land') lands++; if (e.type === 'reward') combos++; }
    maxLevel = Math.max(maxLevel, g.p.level);
  }
  return { g, inputs, lands, maxLevel, combos };
}

const r = play(1234);
console.log('frames', r.g.frame, 'lands', r.lands, 'maxLevel', r.maxLevel, 'final level', r.g.p.level, 'score', score(r.g), 'rewards', r.combos, 'speed', r.g.speed);
assert.ok(r.lands > 5, 'player should land on floors');
assert.ok(r.maxLevel > 3, 'player should climb');

// first map: bottom floor is full width and sits under the player's feet
const g0 = createGame(99);
const bottom = g0.rooms.findIndex((rm) => rm.level === 1);
assert.equal(g0.rooms[bottom].start, 0);
assert.equal(roomY(g0, bottom), 432);

// replays are deterministic
const again = simulateReplay({ seed: 1234, opts: undefined, rejump: false, inputs: encodeInputs(r.inputs) });
assert.equal(score(again), score(r.g));
assert.equal(again.frame, r.g.frame);
console.log('ok');
