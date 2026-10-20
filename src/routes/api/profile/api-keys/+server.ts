import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ALLOWED_SCOPES = ['drawings:read', 'drawings:write', 'collections:read', 'collections:write'];
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function makeToken() {
  return 'edash_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const GET: RequestHandler = async ({ platform, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  if (!locals.user?.id || locals.user.legacy) return json({ error: 'API keys require an individual account.' }, { status: 403 });
  try {
    const result = await db.prepare('SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').bind(locals.user.id).all();
    return json(result.results ?? []);
  } catch {
    return json({ error: 'API keys require the latest D1 migrations.' }, { status: 503 });
  }
};

export const POST: RequestHandler = async ({ platform, locals, request }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  if (!locals.user?.id || locals.user.legacy) return json({ error: 'API keys require an individual account.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: unknown; scopes?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!name) return json({ error: 'API key name is required.' }, { status: 400 });
  const scopes = body?.scopes === undefined ? ALLOWED_SCOPES : body.scopes;
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((scope) => typeof scope !== 'string' || !ALLOWED_SCOPES.includes(scope))) {
    return json({ error: 'Choose at least one valid API key scope.' }, { status: 400 });
  }
  const token = makeToken();
  const id = crypto.randomUUID();
  const prefix = token.slice(0, 14);
  try {
    await db.prepare('INSERT INTO api_keys (id, user_id, name, prefix, token_hash, scopes) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, locals.user.id, name, prefix, await digest(token), [...new Set(scopes as string[])].join(',')).run();
    return json({ ok: true, token, key: { id, name, prefix, scopes: [...new Set(scopes as string[])], created_at: new Date().toISOString(), last_used_at: null, revoked_at: null } }, { status: 201 });
  } catch {
    return json({ error: 'Could not create API key.' }, { status: 500 });
  }
};
