// Global leaderboard (Vercel serverless function).
//
// Storage is an Upstash Redis database reached over its REST API. Connect one
// from the Vercel Marketplace (it sets KV_REST_API_URL / KV_REST_API_TOKEN) or
// set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN yourself. Without
// those variables the endpoint reports `enabled: false` and the game only
// keeps local high scores.
//
// Scores are never trusted from the client: the submitted replay is re-run
// with the same deterministic simulation the game uses, and the score that
// simulation produces is what gets stored.
import { simulateReplay, score, isClassic, CLASSIC, FPS, SIM_VERSION } from '../src/sim.js';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'icytower:scores:v' + SIM_VERSION;
const MAX_FRAMES = FPS * 60 * 60; // one hour of play
const KEEP = 100;

async function redis(commands) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('storage error ' + r.status);
  return r.json();
}

async function top(n = 50) {
  const [res] = await redis([['ZREVRANGE', KEY, '0', String(n - 1), 'WITHSCORES']]);
  const flat = res.result || [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    try {
      out.push({ ...JSON.parse(flat[i]), score: Number(flat[i + 1]) });
    } catch { /* skip malformed rows */ }
  }
  return out;
}

function cleanName(name) {
  return String(name || '').replace(/[^\w .\-!?]/g, '').trim().slice(0, 16) || 'Anonymous';
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 512 * 1024) throw new Error('payload too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!URL_ || !TOKEN) {
    res.status(200).json({ enabled: false, scores: [] });
    return;
  }
  try {
    if (req.method === 'GET') {
      res.status(200).json({ enabled: true, scores: await top() });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }
    const body = await readBody(req);
    const replay = body.replay || {};
    if (!Array.isArray(replay.inputs) || replay.inputs.length > 200000 || !Number.isInteger(replay.seed)) {
      res.status(400).json({ error: 'invalid replay' });
      return;
    }
    if (replay.opts && !isClassic({ ...CLASSIC, ...replay.opts })) {
      res.status(400).json({ error: 'only classic games are ranked' });
      return;
    }
    const g = simulateReplay({ seed: replay.seed, opts: CLASSIC, rejump: !!replay.rejump, inputs: replay.inputs }, MAX_FRAMES);
    if (!g.p.dead) {
      res.status(400).json({ error: 'replay does not end in a finished game' });
      return;
    }
    const entry = {
      name: cleanName(body.name),
      floor: g.p.level,
      combo: g.p.bestCombo,
      date: new Date().toISOString().slice(0, 10),
      id: Math.random().toString(36).slice(2, 10),
    };
    const sc = score(g);
    await redis([
      ['ZADD', KEY, String(sc), JSON.stringify(entry)],
      ['ZREMRANGEBYRANK', KEY, '0', String(-KEEP - 1)],
    ]);
    const scores = await top();
    const rank = scores.findIndex((s) => s.id === entry.id);
    res.status(200).json({ ok: true, score: sc, floor: entry.floor, rank: rank >= 0 ? rank + 1 : null, scores });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
