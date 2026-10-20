import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type Release = { tag_name?: string; name?: string; html_url?: string; published_at?: string; prerelease?: boolean };

export const GET: RequestHandler = async ({ url, fetch, platform }) => {
  const channel = url.searchParams.get('channel') === 'prerelease' ? 'prerelease' : 'stable';
  const repository = platform?.env?.DRAWFLARE_GITHUB_REPO;
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return json({ error: 'Set DRAWFLARE_GITHUB_REPO to the DrawFlare GitHub repository (owner/repo) to enable update checks.', channel }, { status: 503 });
  }
  const endpoint = channel === 'stable'
    ? 'https://api.github.com/repos/' + repository + '/releases/latest'
    : 'https://api.github.com/repos/' + repository + '/releases?per_page=20';
  try {
    const response = await fetch(endpoint, { headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
    if (!response.ok) return json({ error: `GitHub Releases returned HTTP ${response.status}.`, channel }, { status: 502 });
    const payload = await response.json() as Release | Release[];
    const release = Array.isArray(payload)
      ? payload.find((item) => channel === 'prerelease' ? item.prerelease === true : item.prerelease !== true)
      : payload;
    if (!release?.tag_name) return json({ error: 'No release is available for this channel.', channel }, { status: 404 });
    return json({ channel, latestVersion: release.tag_name, name: release.name ?? release.tag_name, url: release.html_url ?? 'https://github.com/' + repository + '/releases', publishedAt: release.published_at ?? null }, { headers: { 'cache-control': 'public, max-age=300' } });
  } catch {
    return json({ error: 'Could not reach GitHub Releases. Check outbound network access.', channel }, { status: 502 });
  }
};
