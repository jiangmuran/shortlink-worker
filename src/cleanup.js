// Scheduled cleanup: expired sessions, aged access logs, long-expired links.
// Runs from the cron trigger ("triggers.crons" in wrangler.jsonc) and can be
// triggered manually by an admin via POST /api/admin/cleanup.

import { getSettings } from './auth.js';

const DAY = 86400000;

export async function runCleanup(env) {
  const settings = await getSettings(env);
  const now = Date.now();
  const result = { ran_at: now, sessions_deleted: 0, logs_deleted: 0, links_deleted: 0 };

  const sessions = await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  result.sessions_deleted = sessions.meta.changes || 0;

  const logs = await env.DB
    .prepare('DELETE FROM logs WHERE ts < ?')
    .bind(now - settings.retention_days * DAY)
    .run();
  result.logs_deleted = logs.meta.changes || 0;

  if (settings.auto_delete_expired_days > 0) {
    const cutoff = now - settings.auto_delete_expired_days * DAY;
    const { results } = await env.DB
      .prepare('SELECT id FROM links WHERE expires_at IS NOT NULL AND expires_at < ?')
      .bind(cutoff)
      .all();
    const ids = (results || []).map((l) => l.id);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM logs WHERE link_id IN (${placeholders})`).bind(...ids),
        env.DB.prepare(`DELETE FROM links WHERE id IN (${placeholders})`).bind(...ids),
      ]);
      result.links_deleted = ids.length;
    }
  }
  return result;
}
