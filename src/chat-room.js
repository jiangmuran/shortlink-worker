// ChatRoom — one Durable Object per room. Relays end-to-end-encrypted messages
// and presence over hibernatable WebSockets. The server only ever sees
// ciphertext (the room key lives in the invite link's # fragment); it never
// stores or logs message plaintext.
//
// Per-connection identity is kept on the socket via serializeAttachment, so the
// member list survives hibernation without a separate store. Room config and
// (optional) recent ciphertext are kept in DO storage.

const MAX_MSG_BYTES = 16 * 1024;
const RATE = { windowMs: 10_000, max: 40 };

export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.rate = new Map();
  }

  async config() {
    if (!this._cfg) this._cfg = (await this.ctx.storage.get('config')) || {};
    return this._cfg;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path.endsWith('/config')) {
      const cfg = await req.json();
      this._cfg = cfg;
      await this.ctx.storage.put('config', cfg);
      return Response.json({ ok: true });
    }

    if (path.endsWith('/info')) {
      return Response.json({ ok: true, members: this.members(), count: this.ctx.getWebSockets().length });
    }

    if (path.endsWith('/destroy')) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(JSON.stringify({ t: 'destroyed' }));
          ws.close(1000, 'destroyed');
        } catch {}
      }
      await this.ctx.storage.deleteAll();
      this._cfg = null;
      return Response.json({ ok: true });
    }

    if (path.endsWith('/ws')) {
      if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const cfg = await this.config();
      const max = cfg.max_members || 50;
      if (this.ctx.getWebSockets().length >= max) return new Response('room full', { status: 409 });

      const member = JSON.parse(decodeURIComponent(url.searchParams.get('m') || '%7B%7D'));
      member.id = crypto.randomUUID().slice(0, 8);
      member.joinedAt = Date.now();

      const pair = new WebSocketPair();
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(member);

      // send history (ciphertext only) + current roster to the newcomer
      const history = cfg.retain > 0 ? (await this.ctx.storage.get('history')) || [] : [];
      server.send(JSON.stringify({ t: 'welcome', you: member.id, config: publicConfig(cfg), members: this.members(), history }));
      this.broadcast({ t: 'join', member: publicMember(member, cfg) }, server);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response('not found', { status: 404 });
  }

  members() {
    const cfg = this._cfg || {};
    return this.ctx.getWebSockets().map((ws) => publicMember(ws.deserializeAttachment() || {}, cfg));
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(s);
      } catch {}
    }
  }

  allowRate(id) {
    const now = Date.now();
    const r = this.rate.get(id) || { n: 0, t: now };
    if (now - r.t > RATE.windowMs) {
      r.n = 0;
      r.t = now;
    }
    r.n++;
    this.rate.set(id, r);
    return r.n <= RATE.max;
  }

  async webSocketMessage(ws, raw) {
    const me = ws.deserializeAttachment() || {};
    if (typeof raw !== 'string' || raw.length > MAX_MSG_BYTES) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!this.allowRate(me.id)) {
      ws.send(JSON.stringify({ t: 'error', message: '发得太快了，稍等一下' }));
      return;
    }
    const cfg = await this.config();

    if (msg.t === 'msg') {
      if (typeof msg.cipher !== 'string' || !msg.cipher) return;
      const out = {
        t: 'msg',
        id: crypto.randomUUID().slice(0, 12),
        from: me.id,
        nick: me.nick,
        color: me.color,
        cipher: msg.cipher,
        kind: msg.kind === 'image' ? 'image' : 'text',
        ts: Date.now(),
      };
      if (cfg.retain > 0) {
        const hist = (await this.ctx.storage.get('history')) || [];
        hist.push(out);
        while (hist.length > cfg.retain) hist.shift();
        await this.ctx.storage.put('history', hist);
      }
      // echo to sender too (so their own bubble appears via the same path)
      this.broadcast(out);
    } else if (msg.t === 'typing') {
      this.broadcast({ t: 'typing', from: me.id, nick: me.nick }, ws);
    } else if (msg.t === 'seen') {
      this.broadcast({ t: 'seen', from: me.id, id: msg.id }, ws);
    }
  }

  async webSocketClose(ws) {
    const me = ws.deserializeAttachment() || {};
    this.broadcast({ t: 'leave', id: me.id });
    this.rate.delete(me.id);
  }

  async webSocketError(ws) {
    try {
      ws.close(1011, 'error');
    } catch {}
  }
}

function publicMember(m, cfg) {
  const vis = (cfg && cfg.visible) || {};
  const out = { id: m.id, nick: m.nick, color: m.color, owner: !!m.isOwner, joinedAt: m.joinedAt };
  if (vis.device) out.device = m.device;
  if (vis.geo) out.geo = m.geo;
  if (vis.ip) out.ip = m.ip;
  if (vis.local_time) out.tz = m.tz;
  return out;
}

function publicConfig(cfg) {
  return {
    type: cfg.type,
    display: cfg.display || { mode: 'motion' },
    disappear: cfg.disappear || 0,
    hold: !!cfg.hold,
    visible: cfg.visible || {},
    features: cfg.features || {},
  };
}
