import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type ShareRow = {
  token: string;
  whiteboard_id: string;
  permission: 'view' | 'edit';
  expires_at: string | null;
};

export const GET: RequestHandler = async ({ params, request, platform }) => {
  const env = platform?.env;
  const db = env?.DB;
  const rooms = env?.COLLABORATION_ROOMS;
  if (!db || !rooms) {
    return json({ error: 'Realtime collaboration is not configured. Deploy the Durable Object binding first.' }, { status: 503 });
  }
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'WebSocket upgrade required' }, { status: 426 });
  }

  const share = await db.prepare(
    'SELECT token, whiteboard_id, permission, expires_at FROM share_links WHERE token = ?'
  ).bind(params.token).first<ShareRow>();

  if (!share || (share.expires_at && new Date(share.expires_at).getTime() <= Date.now())) {
    return json({ error: 'Share link is invalid or expired' }, { status: 404 });
  }

  const board = await db.prepare('SELECT id FROM whiteboards WHERE id = ?')
    .bind(share.whiteboard_id).first<{ id: string }>();
  if (!board) return json({ error: 'Drawing not found' }, { status: 404 });

  const roomUrl = new URL(request.url);
  roomUrl.searchParams.set('permission', share.permission);
  return rooms.get(rooms.idFromName(share.whiteboard_id)).fetch(new Request(roomUrl, request));
};
