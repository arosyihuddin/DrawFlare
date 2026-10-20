const COOKIE_NAME = 'excalidraw_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 310_000;

export type SessionIdentity = {
  id: string | null;
  email: string | null;
  name: string;
  role: 'ADMIN' | 'USER';
  legacy: boolean;
  mustResetPassword?: boolean;
};

type SessionPayload = {
  exp: number;
  userId?: string;
  email?: string;
  name?: string;
  role?: 'ADMIN' | 'USER';
  legacy?: boolean;
};

function base64url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
}

function equal(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64url(new Uint8Array(signature));
}

export function isAuthConfigured(env: App.Platform['env'] | undefined) {
  return Boolean(env?.AUTH_SECRET && (env?.APP_PASSWORD || env?.DB));
}
export async function resolveOwnerId(db: App.Platform['env']['DB'], user: SessionIdentity | null | undefined): Promise<string | null> {
  if (user?.id) return user.id;
  if (!user?.legacy || !db) return null;
  try {
    const admin = await db.prepare("SELECT id FROM app_users WHERE role = 'ADMIN' AND is_active = 1 ORDER BY created_at ASC LIMIT 1").first<{ id: string }>();
    return admin?.id ?? null;
  } catch { return null; }
}

export function verifyPassword(candidate: string, env: App.Platform['env'] | undefined) {
  const expected = env?.APP_PASSWORD;
  return Boolean(expected && equal(candidate, expected));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return 'pbkdf2$' + PASSWORD_ITERATIONS + '$' + base64url(salt) + '$' + base64url(new Uint8Array(derived));
}

export async function verifyHashedPassword(password: string, encoded: string) {
  try {
    const [scheme, iterationText, saltText, hashText] = encoded.split('$');
    const iterations = Number(iterationText);
    if (scheme !== 'pbkdf2' || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000 || !saltText || !hashText) return false;
    const saltBinary = fromBase64url(saltText);
    const salt = Uint8Array.from(saltBinary, (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return equal(base64url(new Uint8Array(derived)), hashText);
  } catch {
    return false;
  }
}

export async function createSession(env: App.Platform['env'] | undefined, identity?: SessionIdentity) {
  const secret = env?.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    ...(identity ? { userId: identity.id ?? undefined, email: identity.email ?? undefined, name: identity.name, role: identity.role, legacy: identity.legacy } : { role: 'ADMIN', name: 'Workspace', legacy: true })
  };
  const encoded = base64url(JSON.stringify(payload));
  return encoded + '.' + await hmac(encoded, secret);
}

export async function getSession(cookieValue: string | undefined, env: App.Platform['env'] | undefined): Promise<SessionIdentity | null> {
  const secret = env?.AUTH_SECRET;
  if (!cookieValue || !secret) return null;
  const separator = cookieValue.lastIndexOf('.');
  if (separator < 1) return null;
  const payload = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  if (!equal(signature, await hmac(payload, secret))) return null;
  try {
    const decoded = fromBase64url(payload);
    const session = JSON.parse(decoded) as SessionPayload;
    if (typeof session.exp !== 'number' || session.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!session.userId) return { id: null, email: null, name: session.name || 'Workspace', role: 'ADMIN', legacy: true, mustResetPassword: false };
    if (session.role !== 'ADMIN' && session.role !== 'USER') return null;
    if (!env?.DB) return null;
    const user = await env.DB.prepare('SELECT id, email, name, role, is_active, must_reset_password FROM app_users WHERE id = ?').bind(session.userId).first<{ id: string; email: string; name: string; role: 'ADMIN' | 'USER'; is_active: number; must_reset_password: number }>();
    if (!user || user.is_active !== 1 || (user.role !== 'ADMIN' && user.role !== 'USER')) return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role, legacy: false, mustResetPassword: user.must_reset_password === 1 };
  } catch {
    return null;
  }
}

export async function hasValidSession(cookieValue: string | undefined, env: App.Platform['env'] | undefined) {
  return Boolean(await getSession(cookieValue, env));
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAge: SESSION_SECONDS
};
