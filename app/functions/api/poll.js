// /api/poll — visitors' one-tap opinions (no text): "나라면 찬성/반대" on a
// plenary vote, "잘하고 있다/아쉽다" on a member. Never part of any score.
//
//   GET  /api/poll?k=vote&t=<vote id>&d=<device id>  -> { counts: {y, n}, mine }
//   POST /api/poll  {k, t, c, d}                      -> same, after recording
//
// One answer per target from each IP address and from each device; answering
// again changes the answer. The IP is stored only as a salted SHA-256 hash, and
// the salt is a random value kept in the database itself. Needs a D1 binding
// named DB; without it the API answers 503 and the pages hide the buttons.
import { memberById } from '../../lib/scoring.js';

const KINDS = { vote: ['y', 'n'], member: ['y', 'n'] };
const TARGET = /^[A-Za-z0-9_]{4,64}$/;
const DEVICE = /^[a-z0-9]{16,40}$/;
let ready = null; // per isolate: tables created and salt loaded

async function setup(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS poll_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS poll_votes (kind TEXT NOT NULL, target TEXT NOT NULL, ip TEXT NOT NULL,
      device TEXT NOT NULL, choice TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (kind, target, ip))`),
    db.prepare('CREATE INDEX IF NOT EXISTS poll_votes_device ON poll_votes (kind, target, device)'),
  ]);
  const salt = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.prepare("INSERT OR IGNORE INTO poll_meta (k, v) VALUES ('salt', ?)").bind(salt).run();
  return (await db.prepare("SELECT v FROM poll_meta WHERE k = 'salt'").first()).v;
}

async function ipHash(salt, request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${ip}`));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function exists(env, request, k, t) {
  if (k === 'member') return !!memberById(t);
  const r = await env.ASSETS.fetch(new URL(`/vote-data/${encodeURIComponent(t)}.json`, request.url));
  return r.ok;
}

async function state(db, k, t, ip, d) {
  const rows = (await db.prepare('SELECT choice, COUNT(*) AS n FROM poll_votes WHERE kind = ? AND target = ? GROUP BY choice').bind(k, t).all()).results;
  const counts = Object.fromEntries(KINDS[k].map((c) => [c, 0]));
  rows.forEach((r) => { if (r.choice in counts) counts[r.choice] = r.n; });
  const mine = await db.prepare('SELECT choice FROM poll_votes WHERE kind = ? AND target = ? AND (ip = ? OR device = ?) LIMIT 1').bind(k, t, ip, d || '-').first();
  return Response.json({ counts, mine: mine ? mine.choice : null }, { headers: { 'cache-control': 'no-store' } });
}

const bad = (msg, status = 400) => Response.json({ error: msg }, { status });

async function handle({ request, env }, input) {
  if (!env.DB) return bad('poll storage is not set up', 503);
  const { k, t, c, d } = input;
  if (!KINDS[k] || !TARGET.test(t || '') || (d && !DEVICE.test(d))) return bad('bad request');
  ready = ready || setup(env.DB).catch((e) => { ready = null; throw e; });
  const salt = await ready;
  const ip = await ipHash(salt, request);
  if (request.method === 'POST') {
    if (!KINDS[k].includes(c) || !d) return bad('bad request');
    if (!(await exists(env, request, k, t))) return bad('unknown target', 404);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM poll_votes WHERE kind = ? AND target = ? AND (ip = ? OR device = ?)').bind(k, t, ip, d),
      env.DB.prepare('INSERT INTO poll_votes (kind, target, ip, device, choice, at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(k, t, ip, d, c, new Date().toISOString().slice(0, 10)),
    ]);
  }
  return state(env.DB, k, t, ip, d);
}

export async function onRequestGet(ctx) {
  const q = new URL(ctx.request.url).searchParams;
  return handle(ctx, { k: q.get('k'), t: q.get('t'), d: q.get('d') });
}

export async function onRequestPost(ctx) {
  const origin = ctx.request.headers.get('Origin');
  if (origin && origin !== new URL(ctx.request.url).origin) return bad('cross-site request', 403);
  let body;
  try {
    body = await ctx.request.json();
  } catch {
    return bad('bad request');
  }
  return handle(ctx, body || {});
}
