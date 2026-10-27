// Draws a game frame the way draw_frame() in the original does: background
// stripes, hurry-up sign, floors, the character, side walls, then the HUD.
import { gfx, fonts, FLOOR_NAMES, SIGN_NAMES } from './assets.js';
import { roomY, score } from './sim.js';

// Cosmetic state that lives outside the deterministic simulation.
export function createView() {
  return {
    stripes: [0, 0, 0, 0, 0],
    lastStripe: 0,
    stars: [],
    rewardTime: 0,
    rewardScale: 0,
    rewardIndex: 0,
    walkPhase: 0,
    facing: 1,
    tick: 0,
    gameOverY: -100,
  };
}

const STAR_GRAVITY = 0.15;

export function spawnStars(view, x, y, n, spread = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = (1 + Math.random() * 5) * spread;
    view.stars.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 2,
      img: 1 + ((Math.random() * 8) | 0),
      life: 60 + Math.random() * 60,
    });
  }
}

export function startReward(view, index) {
  view.rewardTime = 80;
  view.rewardScale = 0;
  view.rewardIndex = index;
  if (index > 2) spawnStars(view, 320, 360, (index - 2) * 16, 1.4);
}

// Called once per logic tick (update_frame + particle update).
export function updateView(view, g, eyeCandy) {
  view.tick++;
  if (view.rewardTime) {
    if (view.rewardTime > 60) view.rewardScale += 0.05;
    else if (view.rewardTime <= 9) view.rewardScale -= 0.1;
    view.rewardTime--;
  }
  const p = g.p;
  if (p.status === 0) view.walkPhase += Math.abs(p.sx) * 0.08;
  if (p.sx > 0.01) view.facing = 1;
  else if (p.sx < -0.01) view.facing = -1;
  if (eyeCandy && p.rotate && p.status !== 0 && view.tick % 2 === 0) {
    spawnStars(view, p.x, p.y - 26, 1, 0.4);
  }
  for (const s of view.stars) {
    s.x += s.vx;
    s.y += s.vy;
    s.vy += STAR_GRAVITY;
    s.life--;
  }
  view.stars = view.stars.filter((s) => s.life > 0 && s.y < 520);
  if (p.dead) view.gameOverY = Math.min(110, view.gameOverY + 8);
}

function sprite(ctx, img, x, y, flip = false) {
  if (!img) return;
  if (!flip) {
    ctx.drawImage(img, Math.round(x), Math.round(y));
    return;
  }
  ctx.save();
  ctx.translate(Math.round(x) + img.width, Math.round(y));
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawBackground(ctx, g, view) {
  const level = g.p.level;
  const kinds = level <= 200 ? 2 : level <= 350 ? 3 : level < 601 ? 4 : 5;
  if (g.offset >> 8 > view.lastStripe) {
    view.lastStripe++;
    view.stripes.pop();
    let id = 0;
    if (Math.random() * 100 <= 40) {
      id = (Math.random() * kinds) | 0;
      if (id === view.stripes[0] || id === view.stripes[1]) id = 0;
    }
    view.stripes.unshift(id);
  }
  const names = ['BGTILE', 'BGTILE2', 'BGTILE3', 'BGTILE4', 'BGTILE5'];
  const sub = (g.offset % 256) / 2 | 0;
  for (let i = -1; i < 4; i++) {
    ctx.drawImage(gfx[names[view.stripes[i + 1]]], 37, i * 128 + sub);
  }
}

function drawFloors(ctx, g, startStyle) {
  const small = fonts.FONT_SMALL;
  for (let i = 31; i >= 0; i--) {
    const room = g.rooms[i];
    const y = roomY(g, i);
    if (room.empty === 0) {
      let t = Math.min(room.tiles + startStyle, 9);
      if (room.level > 4999) t++;
      const left = gfx[FLOOR_NAMES[t * 3]];
      const mid = gfx[FLOOR_NAMES[t * 3 + 1]];
      const right = gfx[FLOOR_NAMES[t * 3 + 2]];
      ctx.drawImage(left, room.start * 16 - 5, y - 6);
      for (let x = room.start + 1; x < room.end; x++) ctx.drawImage(mid, x * 16, y - 6);
      ctx.drawImage(right, room.end * 16, y - 6);
    }
    if (room.sign) {
      let s = Math.min(room.tiles + startStyle, 9);
      if (room.level > 4999) s++;
      const img = gfx[SIGN_NAMES[s]];
      const sx = (room.start + ((room.end - room.start) >> 1)) * 16;
      const sy = y + 10;
      ctx.drawImage(img, sx, sy);
      const cx = sx + (img.width >> 1);
      for (const [dx, dy] of [[1, 7], [2, 6], [0, 6], [1, 5]]) {
        small.draw(ctx, room.sign, cx + dx, sy + dy, { color: '#373737', align: 'center' });
      }
      small.draw(ctx, room.sign, cx + 1, sy + 6, { color: '#ffffff', align: 'center' });
    }
  }
}

function pickFrame(g, view) {
  const p = g.p;
  const f = (i) => i;
  if (p.status !== 0) {
    if (p.rotate) return { i: 12, rotate: true };
    if (Math.abs(p.sx) < 0.01) return { i: 8 };
    if (p.sy > 3) return { i: 7 };
    if (p.sy < -5) return { i: 5 };
    return { i: 6 };
  }
  if (p.edge) return { i: view.tick & 8 ? 14 : 13, edge: p.edge };
  if (g.offset > 200 && p.y > 400) return { i: 11 };
  if (Math.abs(p.sx) > 0.3) return { i: f(1 + ((view.walkPhase | 0) % 4)) };
  return { i: [0, 9, 0, 10][p.anim % 4] };
}

function drawPlayer(ctx, g, view, character) {
  const p = g.p;
  const frames = character.frames;
  const { i, rotate, edge } = pickFrame(g, view);
  const img = frames[i];
  if (!img) return;
  const px = Math.trunc(p.x);
  const py = Math.trunc(p.y) + 1 - frames[0].height;
  if (rotate) {
    ctx.save();
    ctx.translate(px, py + img.height / 2);
    ctx.rotate((p.angle / 256) * Math.PI * 2 * (view.facing < 0 ? -1 : 1));
    if (view.facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  } else if (edge) {
    // edge 1: hanging over the right edge, 2: over the left edge
    if (edge === 2) sprite(ctx, img, px - img.width + 11, py, true);
    else sprite(ctx, img, px - 11, py);
  } else {
    sprite(ctx, img, px - (img.width >> 1), py, view.facing < 0);
  }
}

function drawWalls(ctx, g) {
  const img = gfx.SIDEBLOCK;
  const o = Math.trunc((g.offset % 84) * 1.476);
  for (let y = -124; y < 496; y += 124) {
    sprite(ctx, img, 565, y + o);
    sprite(ctx, img, -57, y + o, true);
  }
}

function drawStars(ctx, view) {
  for (const s of view.stars) ctx.drawImage(gfx['STAR0' + s.img], Math.round(s.x) - 5, Math.round(s.y) - 5);
}

function drawHud(ctx, g, view) {
  const p = g.p;
  // combo meter
  ctx.drawImage(gfx.COMBO_METER, 22, 100);
  const big = fonts.FONT_BIG_WHITE;
  if (p.inCombo) {
    const c = p.inCombo;
    ctx.drawImage(gfx.COMBO_LIQUID, 0, 100 - c, 16, c, 33, 219 - c, 16, c);
    ctx.drawImage(gfx.COMBO_COUNT, -8, 210);
    big.draw(ctx, p.accLevel, 42, 210, { align: 'center' });
  } else if (view.rewardTime) {
    ctx.drawImage(gfx.COMBO_COUNT, -8, 210);
    big.draw(ctx, p.latestCombo, 42, 210, { align: 'center' });
  }

  // clock (shakes while the hurry-up sign is on screen)
  let jx = 0;
  let jy = 0;
  let cx = 6;
  let cy = 10;
  if (g.hurryY - 251 >= 0 && g.hurryY - 251 <= 228) {
    cx = 5 + (view.tick % 3);
    cy = 9 + ((view.tick + 1) % 3);
    jx = (view.tick % 3) - 1;
    jy = ((view.tick + 1) % 3) - 1;
  } else if (g.hurryY - 201 >= 0 && g.hurryY - 201 <= 278) {
    jx = ((view.tick + 2) % 3) - 1;
    jy = ((view.tick + 3) % 3) - 1;
  }
  ctx.drawImage(gfx.CLOCK, cx, cy);
  const hand = gfx.CLOCK_HAND;
  const angle = g.clock === 0 ? 0 : (((g.clock % 1500) + 1500) % 1500) * (256 / 1500);
  ctx.save();
  ctx.translate(34 + hand.width / 2 + jx, 28 + hand.height / 2 + jy);
  ctx.rotate((angle / 256) * Math.PI * 2);
  ctx.drawImage(hand, -hand.width / 2, -hand.height / 2);
  ctx.restore();

  fonts.FONT_MED_WHITE.draw(ctx, 'score: ' + score(g), 8, 440);

  // reward graphic, zooming in and out
  if (view.rewardTime && view.rewardScale > 0) {
    const img = gfx['REWARD00' + view.rewardIndex];
    const s = Math.max(0, view.rewardScale);
    const wob = Math.sin(view.tick * 0.25) * 0.05;
    ctx.save();
    ctx.translate(320, 360);
    ctx.rotate(wob);
    ctx.scale(s, s);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }
}

export function drawGame(ctx, g, view, { character, startStyle = 0, eyeCandy = true, replay = false }) {
  ctx.save();
  if (g.p.shake) ctx.translate(((Math.random() * 8) | 0) - 4, ((Math.random() * 8) | 0) - 4);
  drawBackground(ctx, g, view);
  if ((g.hurryY + 99) >>> 0 <= 578) ctx.drawImage(gfx.HURRYUP, 320 - (gfx.HURRYUP.width >> 1), g.hurryY);
  drawFloors(ctx, g, startStyle);
  drawPlayer(ctx, g, view, character);
  drawWalls(ctx, g);
  if (eyeCandy) drawStars(ctx, view);
  ctx.restore();
  drawHud(ctx, g, view);
  if (g.p.dead) ctx.drawImage(gfx.GAMEOVER, 320 - (gfx.GAMEOVER.width >> 1), view.gameOverY);
  if (replay && view.tick & 8) fonts.FONT_MED_WHITE.draw(ctx, 'REPLAY', 320, 8, { align: 'center' });
}
