// Per-user rate limits and daily creation quotas, backed by tiny counter rows.

import { capsOf, isAdmin } from './auth.js';
import { HttpError } from './util.js';

const DAY = 86400000;

async function bump(env, userId, bucket) {
  const row = await env.DB
    .prepare('INSERT INTO usage_counters(user_id, bucket, n) VALUES(?, ?, 1) ON CONFLICT(user_id, bucket) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(userId, bucket)
    .first();
  return row?.n || 1;
}

// Call right before creating something. `kind` is 'links' | 'notes'.
export async function consumeCreation(env, user, kind) {
  if (isAdmin(user)) return;
  const caps = capsOf(user);
  const perMinute = caps.rate.per_minute;
  if (perMinute > 0) {
    const n = await bump(env, user.id, `m:${Math.floor(Date.now() / 60000)}`);
    if (n > perMinute) throw new HttpError(429, 'rate_limited', `操作太频繁，每分钟最多 ${perMinute} 次，请稍后再试`);
  }
  const daily = caps[kind]?.daily || 0;
  if (daily > 0) {
    const n = await bump(env, user.id, `d:${Math.floor(Date.now() / DAY)}:${kind}`);
    if (n > daily) throw new HttpError(429, 'daily_quota', `今天的创建次数已达上限（${daily} 次）`);
  }
}

export async function todayUsage(env, userId) {
  const { results } = await env.DB
    .prepare('SELECT bucket, n FROM usage_counters WHERE user_id = ? AND bucket LIKE ?')
    .bind(userId, `d:${Math.floor(Date.now() / DAY)}:%`)
    .all();
  const out = {};
  for (const r of results || []) out[r.bucket.split(':')[2]] = r.n;
  return out;
}

export async function pruneUsage(env) {
  const minute = Math.floor(Date.now() / 60000) - 10;
  const day = Math.floor(Date.now() / DAY) - 2;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_counters WHERE bucket LIKE 'm:%' AND CAST(substr(bucket, 3) AS INTEGER) < ?").bind(minute),
    env.DB.prepare("DELETE FROM usage_counters WHERE bucket LIKE 'd:%' AND CAST(substr(bucket, 3, instr(substr(bucket, 3), ':') - 1) AS INTEGER) < ?").bind(day),
  ]);
}
