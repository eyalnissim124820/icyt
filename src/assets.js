// Loads the graphics, bitmap fonts and characters extracted from the original
// datafiles (see tools/extract). Everything lives under /assets.

const BASE = 'assets/';

export const gfx = {};
export const fonts = {};
export const characters = [];

export const FLOOR_NAMES = [
  'FLOOR01', 'FLOOR02', 'FLOOR03', 'FLOOR04', 'FLOOR05', 'FLOOR06', 'FLOOR07', 'FLOOR08', 'FLOOR09',
  'FLOOR10', 'FLOOR11', 'FLOOR12', 'FLOOR12a', 'FLOOR12b', 'FLOOR12c', 'FLOOR13', 'FLOOR14', 'FLOOR15',
  'FLOOR16', 'FLOOR17', 'FLOOR18', 'FLOOR18a', 'FLOOR18b', 'FLOOR18c', 'FLOOR19', 'FLOOR20', 'FLOOR21',
  'FLOOR22', 'FLOOR23', 'FLOOR24', 'FLOOR25', 'FLOOR26', 'FLOOR27',
];
export const SIGN_NAMES = ['SIGN01', 'SIGN02', 'SIGN03', 'SIGN04', 'SIGN04a', 'SIGN05', 'SIGN06', 'SIGN06a', 'SIGN07', 'SIGN08', 'SIGN09'];

const GFX_NAMES = [
  'BGTILE', 'BGTILE2', 'BGTILE3', 'BGTILE4', 'BGTILE5', 'BT_ESC', 'BT_NO', 'BT_UP_DN', 'BT_YES',
  'CLOCK', 'CLOCK_HAND', 'COMBO_COUNT', 'COMBO_LIQUID', 'COMBO_METER', 'GAMEOVER',
  'HEROFACE000', 'HEROFACE001', 'HEROFACE002', 'HEROFACESHADOW', 'HIGHSCORE', 'HISC_BTM', 'HISC_MID', 'HISC_TOP',
  'HURRYUP', 'ICON_HS', 'ICON_PB', 'INSTRUCTIONS', 'MENU_BG', 'MENU_BULLET',
  'REPLAY_BG', 'REPLAY_BG_MED', 'REPLAY_BG_SML', 'SIDEBLOCK', 'TITLE', 'TITLE_BG', 'VCR',
  ...FLOOR_NAMES, ...SIGN_NAMES,
  ...Array.from({ length: 10 }, (_, i) => 'REWARD00' + i),
  ...Array.from({ length: 12 }, (_, i) => 'RANK_' + String(i).padStart(2, '0')),
  ...Array.from({ length: 8 }, (_, i) => 'STAR0' + (i + 1)),
];
const FONT_NAMES = ['FONT_BIG_WHITE', 'FONT_MED_BLACK', 'FONT_MED_WHITE', 'FONT_MONO', 'FONT_SMALL'];

// Character sound order, as listed in the original character script format.
export const CHAR_SOUNDS = ['jumplo', 'jumpmed', 'jumphi', 'pause', 'death', 'greeting', 'edge', 'bgmusic'];
const CHAR_INFO = {
  harold: ['Harold the Homeboy', 'Harold'],
  dave: ['Disco Dave', 'Dave'],
  jane: ['Jungle Jane', 'Jane'],
  wendy: ['Wild Wendy', 'Wendy'],
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + src));
    img.src = src;
  });
}

export async function loadAll(onProgress) {
  const index = await (await fetch(BASE + 'characters/index.json')).json();
  const jobs = [];
  for (const n of GFX_NAMES) jobs.push(() => loadImage(`${BASE}gfx/${n}.png`).then((im) => { gfx[n] = im; }));
  for (const n of FONT_NAMES) {
    jobs.push(async () => {
      const [img, meta] = await Promise.all([
        loadImage(`${BASE}fonts/${n}.png`),
        fetch(`${BASE}fonts/${n}.json`).then((r) => r.json()),
      ]);
      fonts[n] = new BitmapFont(img, meta);
    });
  }
  for (const [key, info] of Object.entries(index)) {
    const [name, short] = CHAR_INFO[key] || [key, key];
    const ch = { key, name, short, frames: [], sounds: {} };
    info.sounds.forEach((s, i) => { ch.sounds[CHAR_SOUNDS[i]] = `${BASE}characters/${key}/${s}`; });
    characters.push(ch);
    info.frames.forEach(([name], i) => {
      jobs.push(() => loadImage(`${BASE}characters/${key}/${name}.png`).then((im) => { ch.frames[i] = im; }));
    });
  }
  let done = 0;
  const total = jobs.length;
  const queue = jobs.slice();
  async function worker() {
    while (queue.length) {
      await queue.shift()();
      done++;
      onProgress?.(done / total);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
}

// ------------------------------------------------------------ bitmap fonts

export class BitmapFont {
  constructor(img, meta) {
    this.img = img;
    this.mono = meta.mono;
    this.height = meta.height;
    this.glyphs = meta.glyphs;
    this.tinted = new Map();
  }

  // Allegro draws mono fonts (and colour fonts given an explicit colour) as a
  // solid colour, so keep one recoloured atlas per colour.
  atlas(color) {
    if (!color) return this.img;
    let c = this.tinted.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = this.img.width;
      c.height = this.img.height;
      const x = c.getContext('2d');
      x.drawImage(this.img, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = color;
      x.fillRect(0, 0, c.width, c.height);
      this.tinted.set(color, c);
    }
    return c;
  }

  width(str) {
    let w = 0;
    for (const ch of String(str)) {
      const g = this.glyphs[ch.charCodeAt(0)] || this.glyphs[63];
      w += g ? g[2] : 0;
    }
    return w;
  }

  draw(ctx, str, x, y, { color = null, align = 'left' } = {}) {
    str = String(str);
    if (align === 'center') x -= Math.floor(this.width(str) / 2);
    else if (align === 'right') x -= this.width(str);
    const src = this.atlas(color || (this.mono ? '#ffffff' : null));
    for (const ch of str) {
      const g = this.glyphs[ch.charCodeAt(0)] || this.glyphs[63];
      if (!g) continue;
      if (g[2] && g[3]) ctx.drawImage(src, g[0], g[1], g[2], g[3], Math.round(x), Math.round(y), g[2], g[3]);
      x += g[2];
    }
  }
}
