<script lang="ts">
  import { confirmAction } from '$lib/confirm';
  import WorkspaceSidebar from '$lib/WorkspaceSidebar.svelte';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  type User = { id: string | null; email: string | null; name: string; role: 'ADMIN' | 'USER'; legacy: boolean };
  type ApiKey = { id: string; name: string; prefix: string; scopes: string; last_used_at: string | null; revoked_at: string | null; created_at: string };
  let user = $state<User | null>(null);
  const forcePassword = $derived(page.url.searchParams.get('forcePassword') === '1');
  let loaded = $state(false);
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let showPassword = $state(false);
  let busy = $state(false);
  let error = $state('');
  let success = $state('');
  let apiKeys = $state<ApiKey[]>([]);
  let keysLoading = $state(false);
  let keyName = $state('');
  let keyScopes = $state<string[]>(['drawings:read', 'drawings:write', 'collections:read', 'collections:write']);
  let keyBusy = $state(false);
  let revealedToken = $state('');
  onMount(async () => {
    try {
      const response = await fetch('/api/auth/session');
      if (response.ok) user = (await response.json() as { user: User | null }).user;
      if (user && !user.legacy) await loadApiKeys();
    } catch { error = 'Could not load account details.'; }
    finally { loaded = true; }
  });
  async function changePassword() {
    error = ''; success = '';
    if (newPassword !== confirmPassword) { error = 'New passwords do not match.'; return; }
    busy = true;
    try {
      const response = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not change password');
      currentPassword = ''; newPassword = ''; confirmPassword = '';
      success = 'Password changed successfully.';
    } catch (e) { error = e instanceof Error ? e.message : 'Could not change password'; }
    finally { busy = false; }
  }
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }
  async function loadApiKeys() {
    keysLoading = true;
    try { const response = await fetch('/api/profile/api-keys'); const data = await response.json() as ApiKey[] | { error?: string }; if (!response.ok || !Array.isArray(data)) throw new Error((data as { error?: string }).error || 'Could not load API keys'); apiKeys = data; }
    catch (e) { error = e instanceof Error ? e.message : 'Could not load API keys'; }
    finally { keysLoading = false; }
  }
  async function createApiKey() {
    if (!keyName.trim() || keyScopes.length === 0) { error = 'Give the key a name and select at least one scope.'; return; }
    keyBusy = true; error = ''; success = ''; revealedToken = '';
    try {
      const response = await fetch('/api/profile/api-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: keyName, scopes: keyScopes }) });
      const data = await response.json() as { error?: string; token?: string };
      if (!response.ok || !data.token) throw new Error(data.error || 'Could not create API key');
      revealedToken = data.token; keyName = ''; success = 'API key created. Copy it now; the full token will not be shown again.'; await loadApiKeys();
    } catch (e) { error = e instanceof Error ? e.message : 'Could not create API key'; }
    finally { keyBusy = false; }
  }
  async function revokeApiKey(key: ApiKey) {
    if (!await confirmAction('Revoke API key “' + key.name + '”? Any MCP client using it will lose access.', { title: 'Revoke API key', confirmLabel: 'Revoke key', destructive: true })) return;
    try { const response = await fetch('/api/profile/api-keys/' + encodeURIComponent(key.id), { method: 'DELETE' }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || 'Could not revoke API key'); success = 'API key revoked.'; await loadApiKeys(); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not revoke API key'; }
  }
</script>
<svelte:head><title>Profile · DrawFlare</title></svelte:head>
<main class="profile-page"><div class="layout">
  <WorkspaceSidebar activePage="profile" />
  <section class="content"><p class="eyebrow">ACCOUNT</p><h1>Profile</h1><p class="intro">Manage your account identity and sign-in security.</p>
    {#if forcePassword}<p class="message error" role="alert">Your administrator issued a temporary password. Change it now before continuing.</p>{/if}
    {#if !loaded}<article class="panel">Loading account…</article>
    {:else if user && !user.legacy}
      <article class="profile-card"><div class="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div class="identity"><h2>{user.name}</h2><p>{user.email}</p><span class="pill">{user.role === 'ADMIN' ? 'Administrator' : 'Member'}</span></div></article>
      <section class="panel"><h2>Change password</h2><p class="panel-intro">Use at least 8 characters. You’ll need your current password to confirm this change.</p>
        <form onsubmit={(event) => { event.preventDefault(); void changePassword(); }}>
          <label for="current-password">Current password</label><input id="current-password" type={showPassword ? 'text' : 'password'} bind:value={currentPassword} autocomplete="current-password" required />
          <label for="new-password">New password</label><input id="new-password" type={showPassword ? 'text' : 'password'} bind:value={newPassword} minlength="8" maxlength="256" autocomplete="new-password" required />
          <label for="confirm-password">Confirm new password</label><input id="confirm-password" type={showPassword ? 'text' : 'password'} bind:value={confirmPassword} minlength="8" maxlength="256" autocomplete="new-password" required />
          <label class="check"><input type="checkbox" bind:checked={showPassword} /> Show passwords</label>
          {#if error}<p class="message error" role="alert">{error}</p>{/if}{#if success}<p class="message success" role="status">{success}</p>{/if}
          <div class="actions"><button class="primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button><button type="button" class="secondary" onclick={() => void logout()}>Sign out</button></div>
        </form>
      </section>
      <section id="api-keys" class="panel api-keys"><div class="panel-title"><div><h2>MCP API keys</h2><p class="panel-intro">Create scoped keys to connect MCP clients to this account. A token is shown only once.</p></div></div>
        <form class="key-form" onsubmit={(event) => { event.preventDefault(); void createApiKey(); }}><label for="key-name">Key name</label><input id="key-name" bind:value={keyName} maxlength="80" placeholder="e.g. ChatGPT workspace" required /><span class="scope-label">Permissions</span><div class="scope-grid"><label><input type="checkbox" value="drawings:read" bind:group={keyScopes} /> Read drawings</label><label><input type="checkbox" value="drawings:write" bind:group={keyScopes} /> Create and edit drawings</label><label><input type="checkbox" value="collections:read" bind:group={keyScopes} /> Read collections</label><label><input type="checkbox" value="collections:write" bind:group={keyScopes} /> Create, rename, and delete collections</label></div><button class="primary" disabled={keyBusy}>{keyBusy ? 'Creating…' : 'Create API key'}</button></form>
        {#if revealedToken}<div class="token-reveal"><strong>Copy this token now</strong><p>It will not be displayed again after you leave this page.</p><code>{revealedToken}</code><button class="secondary" onclick={() => { void navigator.clipboard.writeText(revealedToken).then(() => success = 'API key copied to clipboard.').catch(() => error = 'Clipboard access failed; select and copy the token manually.'); }}>Copy token</button></div>{/if}
        {#if error}<p class="message error" role="alert">{error}</p>{/if}{#if success}<p class="message success" role="status">{success}</p>{/if}
        <h3 class="key-list-title">Your keys</h3>
        {#if keysLoading}<p class="panel-intro">Loading API keys…</p>{:else if apiKeys.length === 0}<p class="panel-intro">No API keys created yet.</p>{:else}<div class="key-list">{#each apiKeys as key (key.id)}<article class="key-row"><div class="key-info"><strong>{key.name}</strong><code>{key.prefix}••••••••</code><small>{key.scopes.split(',').join(' · ')}</small><small>Last used: {key.last_used_at ? new Date(key.last_used_at.replace(' ', 'T') + (key.last_used_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : 'Never'}</small></div>{#if key.revoked_at}<span class="revoked">Revoked</span>{:else}<button class="secondary" onclick={() => void revokeApiKey(key)}>Revoke</button>{/if}</article>{/each}</div>{/if}
      </section>
    {:else}
      <article class="profile-card"><div class="avatar">{user?.name?.slice(0, 1).toUpperCase() ?? 'E'}</div><div class="identity"><h2>{user?.name ?? 'Workspace account'}</h2><p>{user?.email ?? 'Single workspace session'}</p><span class="pill">Shared-password mode</span></div></article>
      <article class="notice"><h2>Workspace authentication</h2><p>This workspace still supports the legacy shared password. To use individual accounts, configure <code>AUTH_SECRET</code>, apply the latest D1 migrations, then create the first account from the sign-in page.</p><p>The first account becomes the administrator and claims existing unassigned drawings and collections. Later accounts get their own drawings and collections.</p><p>For the shared password, update the Cloudflare Worker secret <code>APP_PASSWORD</code>. Session signing uses <code>AUTH_SECRET</code>.</p></article>
      <div class="actions"><a href="/settings">Open settings</a><button class="secondary" onclick={() => void logout()}>Sign out</button></div>
    {/if}
  </section>
</div></main>
<style>
  :global(body){margin:0;background:#f3f4f6;color:#1e293b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
  :global(.profile-page){min-height:100dvh;padding:14px;background-color:#f3f4f6;background-image:radial-gradient(#cbd5e1 1px,transparent 1px);background-size:24px 24px}
  .layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px;min-height:calc(100dvh - 28px)}
  .content{width:min(100%,1280px);min-width:0;box-sizing:border-box;margin:0 auto;padding:38px 28px 64px}.eyebrow{margin:0 0 10px;color:#94a3b8;font-size:10px;font-weight:850;letter-spacing:.12em}.content h1{margin:0 0 8px;color:#0f172a;font:400 38px Excalifont,sans-serif}.intro{margin:0 0 28px;color:#64748b;font-size:14px;line-height:1.55}
  .profile-card,.panel,.notice{margin-bottom:18px;padding:20px;border:2px solid #1e293b;border-radius:16px;background:white;box-shadow:3px 3px 0 #1e293b}.profile-card{display:flex;align-items:center;gap:16px}.avatar{display:grid;place-items:center;width:52px;height:52px;flex:0 0 auto;border:2px solid #1e293b;border-radius:14px;background:#eef2ff;color:#4f46e5;font:400 28px Excalifont,sans-serif}.identity h2,.panel h2,.notice h2{margin:0 0 5px;font-size:15px}.identity p,.panel-intro{margin:0 0 9px;color:#64748b;font-size:12px}.pill{display:inline-flex;padding:4px 8px;border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:10px;font-weight:750}
  form{display:grid;gap:8px}label{margin-top:6px;color:#334155;font-size:12px;font-weight:750}input:not([type=checkbox]){width:100%;box-sizing:border-box;padding:10px;border:2px solid #e2e8f0;border-radius:10px;background:#fff;color:#1e293b;font:13px system-ui}.check{display:flex;align-items:center;gap:8px}.check input{accent-color:#4f46e5}
  .notice p{margin:10px 0 0;color:#64748b;font-size:12px;line-height:1.6}.notice code{padding:2px 5px;border-radius:5px;background:#f1f5f9;color:#334155}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.actions a,.actions button{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border:2px solid #1e293b;border-radius:11px;background:#fff;color:#1e293b;font:750 12px system-ui;text-decoration:none;box-shadow:2px 2px 0 #1e293b;cursor:pointer}.actions .primary{background:#4f46e5;color:#fff}.actions button:disabled{opacity:.6;cursor:wait}.message{padding:10px 12px;border:2px solid;border-radius:10px;font-size:12px;font-weight:650}.error{border-color:#be123c;background:#fff1f2;color:#9f1239}.success{border-color:#059669;background:#ecfdf5;color:#065f46}
  .panel-title{display:flex;justify-content:space-between;gap:12px}.key-form{margin-top:14px;padding:14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}.scope-label{margin-top:4px;font-size:12px;font-weight:800}.scope-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.scope-grid label{display:flex;align-items:center;gap:8px;margin:0;font-size:11px;font-weight:650}.scope-grid input{accent-color:#4f46e5}.key-form button,.token-reveal button,.key-row button{justify-self:start;padding:9px 12px;border:2px solid #1e293b;border-radius:9px;background:#4f46e5;color:white;font:750 11px system-ui;box-shadow:2px 2px 0 #1e293b;cursor:pointer}.token-reveal{display:grid;gap:8px;margin-top:14px;padding:14px;border:2px solid #a7f3d0;border-radius:12px;background:#ecfdf5}.token-reveal strong{font-size:12px;color:#065f46}.token-reveal p{margin:0;color:#047857;font-size:11px}.token-reveal code{display:block;overflow-wrap:anywhere;padding:10px;border:1px solid #a7f3d0;border-radius:8px;background:white;color:#064e3b;font:11px ui-monospace,monospace}.token-reveal button,.key-row button{background:white;color:#1e293b}.key-list-title{margin:20px 0 10px;font-size:13px}.key-list{display:grid;gap:10px}.key-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid #e2e8f0}.key-info{display:grid;gap:4px;min-width:0}.key-info strong{font-size:12px}.key-info code{color:#4f46e5;font:11px ui-monospace,monospace}.key-info small{color:#64748b;font-size:10px;overflow-wrap:anywhere}.revoked{padding:5px 8px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:10px;font-weight:750}
  @media(max-width:650px){:global(.profile-page){padding:8px}.layout{grid-template-columns:minmax(0,1fr);gap:8px;min-height:calc(100dvh - 16px)}.content{padding:22px 8px 40px}.content h1{font-size:32px}}
</style>
