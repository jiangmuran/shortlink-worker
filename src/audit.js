// Append-only audit trail of account and administrative actions.

export function audit(ctx, action, { type = null, id = null, detail = '', actorId } = {}) {
  const actor = actorId !== undefined ? actorId : ctx.user?.id ?? null;
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  ctx.ctx.waitUntil(
    ctx.env.DB.prepare('INSERT INTO audit_logs(ts, actor_id, action, target_type, target_id, detail, ip) VALUES(?,?,?,?,?,?,?)')
      .bind(Date.now(), actor, action, type, id, text.slice(0, 1000), ctx.req.headers.get('cf-connecting-ip') || null)
      .run()
      .catch((e) => console.error('audit failed', e))
  );
}
