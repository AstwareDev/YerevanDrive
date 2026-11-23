// Multiplayer relay for Netlify (which can't host WebSockets): a Cloudflare Worker + one Durable Object per room.
// Every message a client sends is forwarded verbatim to every other client in the same room, so everybody sees everybody.
// Deploy:  cd server && npx wrangler deploy      (free plan is enough)  ->  prints https://yerevan-mp.<you>.workers.dev
export class Room {
  constructor(state) { this.state = state; }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);                       // hibernation API: idle rooms cost nothing
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws, msg) {
    if (typeof msg === 'string' && msg.length > 2048) return;
    for (const o of this.state.getWebSockets()) if (o !== ws) { try { o.send(msg); } catch { /* closed */ } }
  }
  webSocketClose(ws) { try { ws.close(); } catch { /* */ } }
  webSocketError(ws) { try { ws.close(); } catch { /* */ } }
}

export default {
  async fetch(req, env) {
    const room = (new URL(req.url).searchParams.get('room') || 'public').slice(0, 32);
    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(req);
  },
};
