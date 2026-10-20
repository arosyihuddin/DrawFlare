import { redirect, json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { getSession, isAuthConfigured } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const env = event.platform?.env;

  // Without AUTH_SECRET, authentication is intentionally disabled and routes stay public.
  if (!env?.AUTH_SECRET) {
    event.locals.user = null;
    return resolve(event);
  }

  if (!isAuthConfigured(env)) {
    event.locals.user = null;
    if (path.startsWith('/api/')) return json({ error: 'AUTH_SECRET is set but neither APP_PASSWORD nor D1 user accounts are configured' }, { status: 503 });
    return new Response('Authentication is misconfigured. Configure APP_PASSWORD or D1 user accounts.', { status: 503 });
  }

  const publicRoute = path === '/login'
    || path === '/register'
    || path === '/forgot-password'
    || path.startsWith('/reset-password/')
    || path === '/mcp'
    || path === '/api/auth/login'
    || path === '/api/auth/logout'
    || path === '/api/auth/register'
    || path === '/api/auth/forgot-password'
    || path.startsWith('/api/auth/reset-password/')
    || path === '/api/auth/modes'
    || path.startsWith('/share/')
    || path.startsWith('/shared/')
    || path.startsWith('/collection-share/')
    || path.startsWith('/api/share/')
    || path.startsWith('/api/collection-share/');

  const session = await getSession(event.cookies.get('excalidraw_session'), env);
  event.locals.user = session;
  if ((path === '/admin' || path.startsWith('/admin/')) && session?.role !== 'ADMIN') redirect(303, '/');
  if (session?.mustResetPassword && path !== '/profile' && path !== '/api/auth/change-password' && path !== '/api/auth/logout' && path !== '/api/auth/session') {
    if (path.startsWith('/api/')) return json({ error: 'Password change required', mustResetPassword: true }, { status: 403 });
    redirect(303, '/profile?forcePassword=1');
  }

  if (!publicRoute && !session) {
    // Match upstream ProtectedRoute: unauthenticated visitors opening a normal editor URL
    // are redirected to the public/shared route, where sharing policy is enforced.
    const editorMatch = path.match(/^\/editor\/([^/]+)\/?$/);
    if (editorMatch) redirect(303, '/shared/' + encodeURIComponent(decodeURIComponent(editorMatch[1])) + event.url.search);
    if (path.startsWith('/api/')) return json({ error: 'Authentication required' }, { status: 401 });
    const next = event.url.pathname + event.url.search;
    redirect(303, '/login?next=' + encodeURIComponent(next));
  }

  if (path === '/login' && session) redirect(303, '/');
  return resolve(event);
};
