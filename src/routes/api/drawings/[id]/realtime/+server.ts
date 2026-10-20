import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request, platform, locals }) => {
  const env = platform?.env;
  const database = env?.DB;
  const rooms = env?.COLLABORATION_ROOMS;
  if (!database || !rooms) return json({ error: 'Realtime collaboration is not configured. Deploy the Durable Object binding first.' }, { status: 503 });
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket upgrade required' }, { status: 426 });
  if (!locals.user?.id) return json({ error: 'Authentication required' }, { status: 401 });
  const row = await database.prepare('SELECT id FROM whiteboards WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).first();
  if (!row) return json({ error: 'Drawing not found' }, { status: 404 });
  const roomUrl = new URL(request.url);
  roomUrl.searchParams.set('permission', 'edit');
  return rooms.get(rooms.idFromName(params.id)).fetch(new Request(roomUrl, request));
};
