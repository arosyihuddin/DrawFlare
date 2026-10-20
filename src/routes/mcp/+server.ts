import type { RequestHandler } from './$types';
import { resolveOwnerId } from '$lib/server/auth';
import { readScene, removeSceneAsset, storeScene } from '$lib/server/scenes';
import { validateDrawingScene } from '$lib/server/validateDrawingScene';

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const tools = [
  { name: 'list_drawings', description: 'List recent saved drawings.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum number of drawings to return (default 20).' } } } },
  { name: 'search_drawings', description: 'Search drawings by title.', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 1, description: 'Text to search for in drawing titles.' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  { name: 'list_collections', description: 'List collections and the number of active drawings in each collection.', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_collection', description: 'Create a collection in your workspace.', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } } },
  { name: 'rename_collection', description: 'Rename a collection you own.', inputSchema: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string', minLength: 1, maxLength: 80 } } } },
  { name: 'delete_collection', description: 'Delete a collection you own. Drawings in it become unorganized.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'get_drawing', description: 'Get a saved drawing scene by its ID, including its revision number.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'Drawing ID.' } } } },
  { name: 'save_drawing', description: 'Create or update a drawing scene. Supply expectedRevision when updating to prevent overwriting newer changes.', inputSchema: { type: 'object', required: ['scene'], properties: { id: { type: 'string', description: 'Existing drawing ID; omit to create a new drawing.' }, title: { type: 'string' }, scene: { type: 'object' }, expectedRevision: { type: 'integer', minimum: 1, description: 'Current revision from get_drawing; recommended when updating an existing drawing.' } } } }
];
const ALL_SCOPES = ['drawings:read', 'drawings:write', 'collections:read', 'collections:write'];
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function rpc(id: JsonRpcRequest['id'], result: unknown) {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result }, { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function error(id: JsonRpcRequest['id'], code: number, message: string) {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export const GET: RequestHandler = async () => new Response('DrawFlare MCP endpoint. Send MCP JSON-RPC requests with POST.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env;
  const database = env?.DB;
  if (!database) return error(null, -32000, 'D1 binding DB is not configured');

  const authorization = request.headers.get('authorization') ?? '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const globalToken = Boolean(env?.MCP_AUTH_TOKEN && bearer === env.MCP_AUTH_TOKEN);
  let authenticated = false;
  let userId: string | null = null;
  let scopes = [...ALL_SCOPES];
  if (env?.MCP_AUTH_TOKEN && bearer === env.MCP_AUTH_TOKEN) {
    authenticated = true;
  } else if (bearer.startsWith('edash_')) {
    try {
      const tokenHash = await digest(bearer);
      const key = await database.prepare('SELECT id, user_id, scopes FROM api_keys WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(tokenHash).first<{ id: string; user_id: string; scopes: string }>();
      if (key) {
        authenticated = true;
        userId = key.user_id;
        scopes = key.scopes.split(',').filter((scope: string) => ALL_SCOPES.includes(scope));
        await database.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').bind(key.id).run();
      }
    } catch {
      if (env?.AUTH_SECRET || env?.APP_PASSWORD) return error(null, -32001, 'API key storage is not ready. Apply the latest D1 migrations.');
    }
  } else if (!env?.MCP_AUTH_TOKEN && !env?.APP_PASSWORD && !env?.AUTH_SECRET) {
    authenticated = true;
  }
  if (!authenticated) return error(null, -32001, 'Unauthorized: provide MCP_AUTH_TOKEN or a valid DrawFlare API key.');

  const body = await request.json().catch(() => null) as JsonRpcRequest | null;
  if (!body || body.jsonrpc !== '2.0' || !body.method) return error(body?.id, -32600, 'Invalid JSON-RPC request');
  const id = body.id;
  const params = body.params ?? {};

  if (body.method === 'initialize') {
    return rpc(id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: env?.MCP_SERVER_NAME && env.MCP_SERVER_NAME !== 'drawflare-worker-mcp' ? env.MCP_SERVER_NAME : 'drawflare-worker-mcp', version: '0.1.0' } });
  }
  if (body.method === 'notifications/initialized' || body.method === 'ping') return rpc(id, {});
  if (body.method === 'tools/list') {
    const visibleTools = tools.filter((tool) => {
      if (tool.name === 'list_drawings' || tool.name === 'search_drawings' || tool.name === 'get_drawing') return scopes.includes('drawings:read');
      if (tool.name === 'save_drawing') return scopes.includes('drawings:write');
      if (tool.name === 'list_collections') return scopes.includes('collections:read');
      if (tool.name === 'create_collection' || tool.name === 'rename_collection' || tool.name === 'delete_collection') return scopes.includes('collections:write');
    });
    return rpc(id, { tools: visibleTools });
  }
  if (body.method !== 'tools/call') return error(id, -32601, 'Method not found');

  const name = String(params.name ?? '');
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const requiredScope = name === 'list_drawings' || name === 'list_whiteboards' || name === 'search_drawings' || name === 'get_drawing' || name === 'get_whiteboard'
    ? 'drawings:read'
    : name === 'list_collections' ? 'collections:read'
    : name === 'create_collection' || name === 'rename_collection' || name === 'delete_collection' ? 'collections:write'
    : name === 'save_drawing' || name === 'save_whiteboard' ? 'drawings:write' : null;
  if (!requiredScope) return error(id, -32602, 'Unknown tool: ' + name);
  if (!scopes.includes(requiredScope)) return error(id, -32003, 'API key does not have the required scope: ' + requiredScope);

  try {
    if (name === 'list_drawings' || name === 'list_whiteboards') {
      const limit = Math.max(1, Math.min(100, Number(args.limit ?? 20) || 20));
      const result = userId
        ? await database.prepare('SELECT id, title, created_at, updated_at, revision FROM whiteboards WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?').bind(userId, limit).all()
        : await database.prepare('SELECT id, title, created_at, updated_at, revision FROM whiteboards WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?').bind(limit).all();
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify(result.results ?? []) }] });
    }
    if (name === 'search_drawings') {
      const query = String(args.query ?? '').trim().slice(0, 160);
      if (!query) return error(id, -32602, 'query is required');
      const limit = Math.max(1, Math.min(100, Number(args.limit ?? 20) || 20));
      const result = userId
        ? await database.prepare('SELECT id, title, created_at, updated_at, revision FROM whiteboards WHERE owner_id = ? AND deleted_at IS NULL AND title LIKE ? ORDER BY updated_at DESC LIMIT ?').bind(userId, '%' + query + '%', limit).all()
        : await database.prepare('SELECT id, title, created_at, updated_at, revision FROM whiteboards WHERE deleted_at IS NULL AND title LIKE ? ORDER BY updated_at DESC LIMIT ?').bind('%' + query + '%', limit).all();
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify(result.results ?? []) }] });
    }
    if (name === 'list_collections') {
      const result = userId
        ? await database.prepare('SELECT c.id, c.name, c.created_at, c.updated_at, (SELECT COUNT(*) FROM whiteboards w WHERE w.collection_id = c.id AND w.deleted_at IS NULL AND w.owner_id = ?) AS drawing_count FROM collections c WHERE c.owner_id = ? ORDER BY c.name COLLATE NOCASE').bind(userId, userId).all()
        : await database.prepare('SELECT c.id, c.name, c.created_at, c.updated_at, (SELECT COUNT(*) FROM whiteboards w WHERE w.collection_id = c.id AND w.deleted_at IS NULL) AS drawing_count FROM collections c ORDER BY c.name COLLATE NOCASE').all();
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify(result.results ?? []) }] });
    }
    if (name === 'create_collection') {
      const collectionName = String(args.name ?? '').trim().slice(0, 80);
      if (!collectionName) return error(id, -32602, 'name is required');
      const collectionId = crypto.randomUUID();
      const ownerId = userId ?? (globalToken ? await resolveOwnerId(database, { id: null, email: null, name: 'Workspace', role: 'ADMIN', legacy: true }) : null);
      await database.prepare('INSERT INTO collections (id, name, owner_id) VALUES (?, ?, ?)').bind(collectionId, collectionName, ownerId).run();
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify({ id: collectionId, name: collectionName, ok: true }) }] });
    }
    if (name === 'rename_collection') {
      const collectionId = String(args.id ?? '');
      const collectionName = String(args.name ?? '').trim().slice(0, 80);
      if (!collectionId || !collectionName) return error(id, -32602, 'id and name are required');
      const result = userId
        ? await database.prepare('UPDATE collections SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?').bind(collectionName, collectionId, userId).run()
        : await database.prepare('UPDATE collections SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(collectionName, collectionId).run();
      if (!result.meta.changes) return rpc(id, { isError: true, content: [{ type: 'text', text: 'Collection not found' }] });
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify({ id: collectionId, name: collectionName, ok: true }) }] });
    }
    if (name === 'delete_collection') {
      const collectionId = String(args.id ?? '');
      if (!collectionId) return error(id, -32602, 'id is required');
      const result = userId
        ? await database.prepare('DELETE FROM collections WHERE id = ? AND owner_id = ?').bind(collectionId, userId).run()
        : await database.prepare('DELETE FROM collections WHERE id = ?').bind(collectionId).run();
      if (!result.meta.changes) return rpc(id, { isError: true, content: [{ type: 'text', text: 'Collection not found' }] });
      await database.prepare('UPDATE whiteboards SET collection_id = NULL WHERE collection_id = ?').bind(collectionId).run();
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify({ id: collectionId, ok: true }) }] });
    }
    if (name === 'get_drawing' || name === 'get_whiteboard') {
      const boardId = String(args.id ?? '');
      if (!boardId) return error(id, -32602, 'id is required');
      const row = userId
        ? await database.prepare('SELECT id, title, scene_json, created_at, updated_at, revision FROM whiteboards WHERE id = ? AND owner_id = ?').bind(boardId, userId).first<{ id: string; title: string; scene_json: string; created_at: string; updated_at: string; revision: number }>()
        : await database.prepare('SELECT id, title, scene_json, created_at, updated_at, revision FROM whiteboards WHERE id = ?').bind(boardId).first<{ id: string; title: string; scene_json: string; created_at: string; updated_at: string; revision: number }>();
      if (!row) return rpc(id, { isError: true, content: [{ type: 'text', text: 'Drawing not found' }] });
      const scene = await readScene(row.scene_json, row.id, env);
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify({ id: row.id, title: row.title, scene, revision: row.revision, created_at: row.created_at, updated_at: row.updated_at }) }] });
    }
    if (name === 'save_drawing' || name === 'save_whiteboard') {
      const sceneError = validateDrawingScene(args.scene);
      if (sceneError) return error(id, -32602, sceneError);
      if (args.expectedRevision !== undefined && (!Number.isInteger(args.expectedRevision) || Number(args.expectedRevision) < 1)) return error(id, -32602, 'expectedRevision must be a positive integer');
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 160) : undefined;
      const boardId = String(args.id ?? crypto.randomUUID());
      const existing = args.id
        ? (userId
          ? await database.prepare('SELECT scene_json, title, revision FROM whiteboards WHERE id = ? AND owner_id = ?').bind(boardId, userId).first<{ scene_json: string; title: string; revision: number }>()
          : await database.prepare('SELECT scene_json, title, revision FROM whiteboards WHERE id = ?').bind(boardId).first<{ scene_json: string; title: string; revision: number }>())
        : null;
      if (args.id && !existing) return rpc(id, { isError: true, content: [{ type: 'text', text: 'Drawing not found' }] });
      const expectedRevision = args.expectedRevision === undefined ? undefined : Number(args.expectedRevision);
      if (existing && expectedRevision !== undefined && existing.revision !== expectedRevision) {
        return rpc(id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'Revision conflict', currentRevision: existing.revision }) }] });
      }
      const stored = await storeScene(args.scene, boardId, env);
      const savedTitle = title === undefined ? (existing?.title ?? 'Untitled drawing') : (title || 'Untitled drawing');
      if (existing) {
        const result = expectedRevision === undefined
          ? (title === undefined
            ? await database.prepare('UPDATE whiteboards SET scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(stored.stored, boardId).run()
            : await database.prepare('UPDATE whiteboards SET title = ?, scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(savedTitle, stored.stored, boardId).run())
          : (title === undefined
            ? await database.prepare('UPDATE whiteboards SET scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?').bind(stored.stored, boardId, expectedRevision).run()
            : await database.prepare('UPDATE whiteboards SET title = ?, scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?').bind(savedTitle, stored.stored, boardId, expectedRevision).run());
        if (!result.meta.changes) {
          if (stored.inR2) await removeSceneAsset(stored.stored, boardId, env);
          const current = await database.prepare('SELECT revision FROM whiteboards WHERE id = ?').bind(boardId).first<{ revision: number }>();
          return rpc(id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'Revision conflict', currentRevision: current?.revision }) }] });
        }
        await removeSceneAsset(existing.scene_json, boardId, env);
      } else {
        const ownerId = userId ?? (globalToken ? await resolveOwnerId(database, { id: null, email: null, name: 'Workspace', role: 'ADMIN', legacy: true }) : null);
        await database.prepare('INSERT INTO whiteboards (id, title, scene_json, owner_id) VALUES (?, ?, ?, ?)').bind(boardId, savedTitle, stored.stored, ownerId).run();
      }
      const current = await database.prepare('SELECT revision FROM whiteboards WHERE id = ?').bind(boardId).first<{ revision: number }>();
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify({ id: boardId, title: savedTitle, ok: true, revision: current?.revision, storage: stored.inR2 ? 'r2' : 'd1', bytes: stored.byteLength }) }] });
    }
    return error(id, -32602, 'Unknown tool: ' + name);
  } catch (e) {
    return error(id, -32603, e instanceof Error ? e.message : 'Internal error');
  }
};
