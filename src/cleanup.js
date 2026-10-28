// Scheduled maintenance (cron, hourly) — also runnable by an admin via
// POST /api/admin/cleanup:
//   1. roll raw click logs up into link_daily (idempotent: whole days are recomputed)
//   2. burn notes whose time is up
//   3. delete expired sessions, aged logs (in batches), long-expired links
//   4. prune usage counters

import { getSettings, setSettings } from './auth.js';
import { deleteLinkCascade } from './links-service.js';
import { pruneUsage } from './usage.js';

const DAY = 86400000;
const BATCH = 2000;
const MAX_BATCHES = 25;

export async function runMaintenance(env) {
  const settings = await getSettings(env);
  const now = Date.now();
  const result = { ran_at: now, rolled_days: 0, notes_burned: 0, sessions_deleted: 0, logs_deleted: 0, links_deleted: 0 };

  // 1. rollup — recompute every day touched since the previous watermark
  const until = now - 60_000;
  const fromDayStart = Math.floor(settings.rollup_until / DAY) * DAY;
  const rolled = await env.DB
    .prepare(
      `INSERT INTO link_daily(link_id, day, clicks)
       SELECT link_id, CAST(ts / ${DAY} AS INTEGER) AS d, COUNT(*) FROM logs
       WHERE ts >= ? AND ts < ? AND status IN ('hit', 'opened')
       GROUP BY link_id, d
       ON CONFLICT(link_id, day) DO UPDATE SET clicks = excluded.clicks`
    )
    .bind(fromDayStart, until)
    .run();
  result.rolled_days = rolled.meta.changes || 0;
  await setSettings(env, { rollup_until: until });

  // 2. notes past their deadline
  const burned = await env.DB
    .prepare(
      `UPDATE notes SET cipher = NULL, burned_at = ?, burn_reason = 'expired'
       WHERE burned_at IS NULL AND (
         (open_ttl IS NOT NULL AND first_open_at IS NOT NULL AND first_open_at + open_ttl * 1000 < ?)
         OR link_id IN (SELECT id FROM links WHERE kind = 'note' AND expires_at IS NOT NULL AND expires_at < ?)
       )`
    )
    .bind(now, now, now)
    .run();
  result.notes_burned = burned.meta.changes || 0;

  // 2b. drop R2 image objects for any burned note (the bulk burn above and the
  // manual-burn path both leave orphaned attachments otherwise)
  if (env.MEDIA) {
    const { results: orphans } = await env.DB
      .prepare('SELECT m.id, m.link_id FROM note_media m JOIN notes n ON n.link_id = m.link_id WHERE n.burned_at IS NOT NULL LIMIT 1000')
      .all();
    for (const o of orphans || []) await env.MEDIA.delete(`note/${o.link_id}/${o.id}`).catch(() => {});
    if ((orphans || []).length) {
      await env.DB.prepare('DELETE FROM note_media WHERE link_id IN (SELECT link_id FROM notes WHERE burned_at IS NOT NULL)').run();
    }
  }

  // 3. sessions, logs, links
  const sessions = await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  result.sessions_deleted = sessions.meta.changes || 0;

  // never delete logs that the rollup has not covered yet
  const logCutoff = Math.min(now - settings.retention_days * DAY, fromDayStart);
  for (let i = 0; i < MAX_BATCHES; i++) {
    const res = await env.DB
      .prepare(`DELETE FROM logs WHERE id IN (SELECT id FROM logs WHERE ts < ? ORDER BY ts LIMIT ${BATCH})`)
      .bind(logCutoff)
      .run();
    const n = res.meta.changes || 0;
    result.logs_deleted += n;
    if (n < BATCH) break;
  }

  if (settings.auto_delete_expired_days > 0) {
    const cutoff = now - settings.auto_delete_expired_days * DAY;
    const { results } = await env.DB
      .prepare('SELECT id FROM links WHERE expires_at IS NOT NULL AND expires_at < ? LIMIT 200')
      .bind(cutoff)
      .all();
    for (const l of results || []) await deleteLinkCascade(env, l.id);
    result.links_deleted = (results || []).length;
  }

  // 4. counters
  await pruneUsage(env);
  return result;
}

// kept for older imports
export const runCleanup = runMaintenance;
