# Icy Tower — web edition

A browser port of **Icy Tower v1.5.1**, rebuilt from the original Windows release. It's plain HTML5 Canvas and JavaScript with no build step, and it deploys to Vercel as-is.

> Icy Tower® is a game by [Free Lunch Design](http://www.freelunchdesign.com): design and code by Johan Peitz, graphics by Emanuel Garnheim, sound and music by SomaTone Interactive Audio. This port is a non-commercial fan recreation made with the permission of Johan Peitz. All original graphics and sounds remain the property of their authors.

## What's in it

- **Original gameplay.** The physics, floor generation, scrolling, speed-ups and combo rules are ported line by line from the disassembled game (`player.c`, `map.c` and `play()`; see the notes below). It runs at the original fixed rate of 50 logic ticks per second.
- **Original assets.** Every graphic, font, voice clip and music track is decoded from the game's Allegro datafiles, along with the four characters: Harold the Homeboy, Disco Dave, Jungle Jane and Wild Wendy.
- **Menus from the original:**
  - Classic and Custom games (speed, floor size, gravity).
  - Instructions, Profile with the 12 ranks, and High Scores.
  - Options: character, start floor, eye candy, fullscreen, sound and music volume, rebindable keys, ReJump.
- **Replays.** Every game is recorded. You can watch it right away, save it, download it as a file, and load it back later.
- **Online high scores** (optional). Submitted replays are re-simulated on the server, so a posted score can't be faked.
- **Touch controls** on phones and tablets, and **gamepad** support.

## Controls

| Action | Default |
| --- | --- |
| Run | ← / → |
| Jump | Space |
| Pause | P (Esc also pauses; Esc while paused quits) |
| Replay fast-forward | F |

The faster you run, the higher you jump. Land two or more floors above your take-off floor to start a combo, and keep chaining multi-floor jumps before the meter on the left drains. A combo scores the square of the floors it covered.

## Run locally

```bash
npm run dev     # http://localhost:3000
npm test        # deterministic simulation tests
```

Node 18+ is the only requirement; there are no dependencies to install. Any static file server works for the game itself; `npm run dev` also runs the `/api/scores` function.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (framework preset: **Other**, no build command, output directory = repo root).
2. Deploy. The game works immediately, with local high scores and replays.

### Optional: global high score list

1. In the Vercel dashboard, open **Storage** (or the Marketplace), add an **Upstash Redis** database, and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
   - Setting `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` yourself also works.
2. Redeploy. The **ONLINE** tab in High Scores and the **Submit Online** button after a classic game turn on automatically.

`api/scores.js` re-runs each submitted replay with `src/sim.js`. Only the score that simulation produces is stored, and only for classic games.

## Adding a character

Draw or generate a sprite sheet: 15 poses in a 5×3 grid on a solid magenta (#FF00FF) background, facing right, in the game's frame order (idle, walk ×4, jump up / peak / down, straight jump, idle 2, idle 3, scared, cartwheel, edge wobble ×2). `assets/characters/harold/001_BMP.png` … `015_BMP.png` show what each pose looks like. Then run:

```bash
python3 tools/add_character.py sheet.png chick "Chick"   # needs Pillow
```

The script cuts out each pose, scales it to the original 52 px character height and removes the magenta. It saves the frames to `assets/characters/<key>/` and registers the character in `assets/characters/index.json`, reusing Harold's voice by default (`--sounds-from`). The character then appears under **Options → GFX Options → Character**.

## Project layout

```
index.html          page shell, touch controls, name prompt
src/sim.js          deterministic game logic (shared by browser and server)
src/render.js       in-game drawing (floors, walls, character, HUD)
src/main.js         menus, scenes, input, game loop, replays, results
src/assets.js       asset loader + Allegro bitmap-font renderer
src/audio.js        WebAudio sample playback (Ogg, MP3 fallback)
src/storage.js      settings, profile, ranks, local scores, saved replays
src/online.js       client for /api/scores
api/scores.js       Vercel serverless leaderboard with replay verification
assets/             graphics, fonts, sounds and characters extracted from the original
tools/extract/      scripts that decode the original datafiles
scripts/dev-server.mjs  local static server + API runner
test/sim.test.mjs   simulation tests
```

## How it was reverse engineered

The installer is Inno Setup 5.5; `innoextract` unpacks it. The game data lives in Allegro 4 datafiles:

- **Encryption.** `data/data.dat` and `data/sfx15.dat` are encrypted with the packfile password `CHEESE` (header XOR mask `0x45450d3a`). Character `.dat` files aren't encrypted.
- **Compression.** Contents are LZSS-compressed (`slh!`) or stored as-is (`slh.`).
- **Object formats.** Bitmaps are 16-bit 565 or 24-bit, with magenta used for transparency. Fonts are Allegro 4.2 mono or colour fonts, and sounds are embedded Ogg Vorbis.

`tools/extract/convert.py` turns them into PNG, JSON and OGG/MP3. To regenerate `assets/`:

```bash
innoextract -e -d out icytower_install.exe
python3 tools/extract/convert.py out/app assets   # needs Pillow and ffmpeg
```

`icytower15.exe` ships with DWARF debug info, which gave function names, source file names and struct layouts. The game logic was then read from the x86/x87 disassembly. Key facts recovered:

- **Timing.** Logic runs at 50 Hz (a 20 ms Allegro timer).
- **Acceleration.** Holding a direction adds `±0.3` to `sx`, after `sx *= 0.7` when turning around. With no input, `sx *= 0.9`. Speed is clamped to `±12.2`.
- **Jump.** `sy = -max(12.2, 2·|sx|)`; a cartwheel happens when `sy < -22`. Gravity is `0.8` (custom game: `0.6` or `1.0`). Walls bounce with `sx *= -0.9`.
- **Map.** The map is a ring of 32 rows of 16 px, with a floor every 5 rows (80 px). Floor width comes from MSVCRT `rand()` seeded by the replay seed, shrinking from 6–15 tiles down to 2. Every 50th floor is full width (every 500th above floor 1000).
- **Scrolling.** It starts once the tower has been climbed 100 px. Speed begins at 0.5 px/tick and gains 1 px/tick every 1500 ticks (30 s), up to 5. It also catches up quickly when the player is near the top of the screen.
- **Combos.** A jump of two or more floors refills a 100-tick combo timer. A one-floor jump, or landing lower, ends the combo. A combo needs at least two jumps and is worth `floors²`.
- **Rewards.** GOOD ≤6 floors, SWEET ≤14, GREAT ≤24, SUPER ≤34, WOW ≤49, AMAZING ≤69, EXTREME ≤99, FANTASTIC ≤139, SPLENDID ≤199; anything higher gets the top reward.
- **Score.** `floor × 10 + combo points`.

Replays from the original game (`.itr`) aren't compatible, because the original runs on 80-bit x87 floating point. Replays made with this port are deterministic across browsers and the server.
