/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
export interface CollaborationRoomEnv {}
type RoomState = DurableObjectState;
declare const WebSocketPair: { new(): [WebSocket, WebSocket] };

/** One strongly-consistent WebSocket room per drawing. The room relays scene updates
 * and presence; durable scene persistence remains handled by the drawing API. */
export class CollaborationRoom extends DurableObject<CollaborationRoomEnv> {
  private state: RoomState;

  constructor(state: DurableObjectState, env: CollaborationRoomEnv) {
    super(state, env);
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const permission = new URL(request.url).searchParams.get('permission') === 'view' ? 'view' : 'edit';
    this.state.acceptWebSocket(server, [permission]);
    this.broadcast({ type: 'presence', count: this.state.getWebSockets().length });
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string' || message.length > 25_000_000) return;
    let payload: { type?: string };
    try { payload = JSON.parse(message) as { type?: string }; }
    catch { return; }
    if (!payload || !['scene', 'request-scene', 'presence'].includes(payload.type ?? '')) return;
    if (payload.type === 'scene' && this.state.getTags(socket).includes('view')) return;
    if (payload.type === 'presence' && this.state.getTags(socket).includes('view')) return;
     for (const peer of this.state.getWebSockets()) {
       if (peer === socket) continue;
       try { peer.send(message); } catch { /* Closed peers are removed by the runtime. */ }
     }
  }

  webSocketClose(socket: WebSocket): void {
    try { socket.close(); } catch { /* Already closed. */ }
    this.broadcast({ type: 'presence', count: Math.max(0, this.state.getWebSockets().length - 1) });
  }

  webSocketError(socket: WebSocket): void {
    try { socket.close(1011, 'WebSocket error'); } catch { /* Already closed. */ }
  }

  private broadcast(payload: unknown): void {
    const message = JSON.stringify(payload);
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(message); } catch { /* Closed peers are removed by the runtime. */ }
    }
  }
}
