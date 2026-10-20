<script lang="ts">
  import { confirmAction, promptAction } from '$lib/confirm';
  import WorkspaceSidebar from '$lib/WorkspaceSidebar.svelte';
  import { onMount } from 'svelte';
  type Overview = { storage: { d1: boolean; r2: boolean }; security: { sharedPasswordConfigured: boolean; mcpTokenConfigured: boolean }; counts: { drawings: number; trash: number; collections: number; shares: number; history: number }; authModel: string };
  type User = { id: string; email: string; name: string; role: 'ADMIN' | 'USER'; is_active: number; must_reset_password: number; created_at?: string };
  let overview = $state<Overview | null>(null);
  let users = $state<User[]>([]);
  let registrationEnabled = $state(false);
  let authEnabled = $state(false);
  let authSetupMessage = $state('');
  let loading = $state(true);
  let userLoading = $state(false);
  let error = $state('');
  let userError = $state('');
  let success = $state('');
  let createOpen = $state(false);
  let newName = $state('');
  let newEmail = $state('');
  let newPassword = $state('');
  let newRole = $state<'ADMIN' | 'USER'>('USER');
  let creating = $state(false);

  async function loadUsers() {
    userLoading = true; userError = '';
    try {
      const [usersResponse, settingsResponse] = await Promise.all([fetch('/api/admin/users'), fetch('/api/admin/settings')]);
      const userData = await usersResponse.json() as User[] | { error?: string };
      const settingsData = await settingsResponse.json() as { registrationEnabled?: boolean; error?: string };
      if (!usersResponse.ok || !Array.isArray(userData)) throw new Error((userData as { error?: string }).error || 'Could not load users');
      users = userData;
      if (settingsResponse.ok) registrationEnabled = settingsData.registrationEnabled === true;
    } catch (e) { userError = e instanceof Error ? e.message : 'Could not load users'; }
    finally { userLoading = false; }
  }
  onMount(async () => {
    try {
      const [modeResponse, overviewResponse] = await Promise.all([fetch('/api/auth/modes'), fetch('/api/admin/overview')]);
      const mode = await modeResponse.json() as { authEnabled?: boolean };
      authEnabled = modeResponse.ok && mode.authEnabled === true;
      if (!authEnabled) authSetupMessage = 'Account administration is unavailable while authentication is disabled. Copy .env.example to .dev.vars, set a strong AUTH_SECRET, restart the dev server, then register the first account to create the administrator.';
      const data = await overviewResponse.json() as Overview & { error?: string };
      if (!overviewResponse.ok) throw new Error(data.error || 'Could not load diagnostics');
      overview = data;
    } catch (e) { error = e instanceof Error ? e.message : 'Could not load administration'; }
    if (authEnabled) await loadUsers();
    loading = false;
  });

  async function toggleRegistration() {
    userError = ''; success = '';
    try {
      const response = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ registrationEnabled: !registrationEnabled }) });
      const data = await response.json() as { error?: string; registrationEnabled?: boolean };
      if (!response.ok) throw new Error(data.error || 'Could not update registration settings');
      registrationEnabled = data.registrationEnabled === true;
      success = registrationEnabled ? 'Self-registration enabled.' : 'Self-registration disabled.';
    } catch (e) { userError = e instanceof Error ? e.message : 'Could not update registration settings'; }
  }

  async function createUser() {
    userError = ''; success = '';
    if (newPassword.length < 8) { userError = 'Temporary password must contain at least 8 characters.'; return; }
    creating = true;
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: newName, email: newEmail, password: newPassword, role: newRole }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not create user');
      newName = ''; newEmail = ''; newPassword = ''; newRole = 'USER'; createOpen = false;
      success = 'User created. They must change the temporary password after signing in.';
      await loadUsers();
    } catch (e) { userError = e instanceof Error ? e.message : 'Could not create user'; }
    finally { creating = false; }
  }

  async function patchUser(user: User, patch: Record<string, unknown>, message: string) {
    userError = ''; success = '';
    try {
      const response = await fetch('/api/admin/users/' + encodeURIComponent(user.id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not update user');
      success = message; await loadUsers();
    } catch (e) { userError = e instanceof Error ? e.message : 'Could not update user'; await loadUsers(); }
  }

  async function resetUserPassword(user: User) {
    const password = await promptAction('Set a temporary password for ' + user.email + ' (minimum 8 characters).', { title: 'Reset user password', confirmLabel: 'Set password', inputType: 'password', minLength: 8 });
    if (password === null) return;
    if (password.length < 8) { userError = 'Temporary password must contain at least 8 characters.'; return; }
    await patchUser(user, { password }, 'Temporary password updated. The user must change it after signing in.');
  }

  async function deleteUser(user: User) {
    if (!await confirmAction('Delete account ' + user.email + '? Their drawings and collections will be transferred to your account.', { title: 'Delete account', confirmLabel: 'Delete account', destructive: true })) return;
    userError = ''; success = '';
    try {
      const response = await fetch('/api/admin/users/' + encodeURIComponent(user.id), { method: 'DELETE' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not delete user');
      success = 'User deleted.'; await loadUsers();
    } catch (e) { userError = e instanceof Error ? e.message : 'Could not delete user'; }
  }
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }
</script>
<svelte:head><title>Administration · DrawFlare</title></svelte:head>
<main class="admin-page"><div class="layout">
  <WorkspaceSidebar activePage="admin" />
  <section class="content"><p class="eyebrow">WORKSPACE</p><h1>Admin</h1><p class="intro">Manage users and access controls.</p>
    {#if loading}<div class="panel">Loading workspace administration…</div>
    {:else}
      {#if error}<div class="panel error" role="alert">{error}</div>{/if}
      {#if authSetupMessage}<div class="panel" role="status"><strong>Authentication is disabled</strong><p class="hint">{authSetupMessage}</p></div>{/if}
      {#if overview}
        <div class="stats"><article><small>Drawings</small><strong>{overview.counts.drawings}</strong></article><article><small>Collections</small><strong>{overview.counts.collections}</strong></article><article><small>Share links</small><strong>{overview.counts.shares}</strong></article><article><small>History snapshots</small><strong>{overview.counts.history}</strong></article><article><small>Trash</small><strong>{overview.counts.trash}</strong></article></div>
      {/if}
      <div class="admin-toolbar"><div><h2>User management</h2><p>Manage users and access controls.</p></div><div class="toolbar-actions"><button class="secondary" disabled={userLoading || !authEnabled} onclick={() => void loadUsers()}>{userLoading ? 'Refreshing…' : '↻ Refresh'}</button><button class="primary" disabled={!authEnabled} onclick={() => createOpen = !createOpen}>{createOpen ? 'Cancel' : '＋ New user'}</button></div></div>
      {#if userError}<p class="message error" role="alert">{userError}</p>{/if}{#if success}<p class="message success" role="status">{success}</p>{/if}
      {#if createOpen}<section class="panel create-panel"><div class="panel-heading"><div><h2>Create user</h2><p>Create a local account with a temporary password.</p></div></div><form class="create-form" onsubmit={(event) => { event.preventDefault(); void createUser(); }}><label for="new-name">Name</label><input id="new-name" bind:value={newName} maxlength="80" required /><label for="new-email">Email</label><input id="new-email" type="email" bind:value={newEmail} required /><label for="new-password">Temporary password</label><input id="new-password" type="password" bind:value={newPassword} minlength="8" maxlength="256" required /><label for="new-role">Role</label><select id="new-role" bind:value={newRole}><option value="USER">Member</option><option value="ADMIN">Administrator</option></select><button class="primary" disabled={creating}>{creating ? 'Creating…' : 'Create user'}</button></form></section>{/if}
      <section class="panel access-panel"><div class="section-heading"><div><h2>Access control</h2><p>Choose who can create an account.</p></div><span class="section-icon" aria-hidden="true">＋</span></div><div class="registration-row"><div><strong>Local sign-up</strong><p>{registrationEnabled ? 'Anyone can create a local account.' : 'New local accounts are blocked.'}</p></div><button disabled={!authEnabled} class:active={registrationEnabled} class="toggle" onclick={() => void toggleRegistration()}>{registrationEnabled ? 'Enabled' : 'Disabled'}</button></div></section>
      <section class="users-section"><div class="section-heading"><div><h2>Users</h2><p>Manage roles, account status, and password requirements.</p></div>{#if userLoading}<span class="hint">Loading…</span>{/if}</div>
        <div class="users-table-wrap"><table class="users-table"><thead><tr><th>User</th><th>Role</th><th>Active</th><th>Reset?</th><th>Actions</th></tr></thead><tbody>
          {#if !userLoading && users.length === 0}<tr><td colspan="5" class="empty-users">No users found. The first account can be created from the sign-in page.</td></tr>{/if}
          {#each users as user (user.id)}<tr><td class="table-user"><strong>{user.name}</strong><small>{user.email}</small><small>Created {user.created_at ? new Date(user.created_at + (user.created_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString() : '—'}</small></td><td><select aria-label={'Role for ' + user.email} value={user.role} onchange={(event) => void patchUser(user, { role: (event.currentTarget as HTMLSelectElement).value }, 'User role updated.')}><option value="USER">Member</option><option value="ADMIN">Admin</option></select></td><td><button class:active={user.is_active === 1} class="toggle compact-toggle" onclick={() => void patchUser(user, { isActive: user.is_active !== 1 }, user.is_active === 1 ? 'User deactivated.' : 'User activated.')}>{user.is_active === 1 ? 'Active' : 'Inactive'}</button></td><td><button class:active={user.must_reset_password === 1} class="toggle compact-toggle" onclick={() => void patchUser(user, { mustResetPassword: user.must_reset_password !== 1 }, user.must_reset_password === 1 ? 'Password reset requirement removed.' : 'Password reset required.')}>{user.must_reset_password === 1 ? 'Yes' : 'No'}</button></td><td><div class="table-actions"><button class="secondary" onclick={() => void resetUserPassword(user)}>Reset password</button><button class="danger" onclick={() => void deleteUser(user)}>Delete</button></div></td></tr>{/each}
        </tbody></table></div>
      </section>
      {#if overview}<section class="panel"><h2>Storage and security</h2><div class="status-row"><span>D1 database</span><b class:ok={overview.storage.d1}>{overview.storage.d1 ? 'Connected' : 'Missing'}</b></div><div class="status-row"><span>R2 object storage</span><b class:ok={overview.storage.r2}>{overview.storage.r2 ? 'Connected' : 'Missing'}</b></div><div class="status-row"><span>Legacy shared password</span><b class:ok={overview.security.sharedPasswordConfigured}>{overview.security.sharedPasswordConfigured ? 'Configured' : 'Not configured'}</b></div><div class="status-row"><span>MCP bearer token</span><b class:ok={overview.security.mcpTokenConfigured}>{overview.security.mcpTokenConfigured ? 'Configured' : 'Not configured'}</b></div><p class="hint">For password-reset emails, configure Worker secrets <code>RESEND_API_KEY</code> and <code>RESEND_FROM_EMAIL</code>. Existing shared-password access remains available for backward compatibility.</p></section>{/if}
    {/if}
    <div class="footer-actions"><button class="secondary" onclick={() => void logout()}>Sign out</button></div>
  </section>
</div></main>
<style>
  :global(body){margin:0;background:#f3f4f6;color:#1e293b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}:global(.admin-page){min-height:100dvh;padding:14px;background-color:#f3f4f6;background-image:radial-gradient(#cbd5e1 1px,transparent 1px);background-size:24px 24px}.layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px;min-height:calc(100dvh - 28px)}.content{width:min(100%,1280px);min-width:0;box-sizing:border-box;margin:0 auto;padding:38px 28px 64px}.eyebrow{margin:0 0 10px;color:#94a3b8;font-size:10px;font-weight:850;letter-spacing:.12em}.content h1{margin:0 0 8px;color:#0f172a;font:400 38px Excalifont,sans-serif}.intro{margin:0 0 28px;color:#64748b;font-size:14px;line-height:1.55}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:18px}.stats article,.panel{padding:18px;border:2px solid #1e293b;border-radius:14px;background:#fff;box-shadow:3px 3px 0 #1e293b}.stats small{display:block;margin-bottom:9px;color:#64748b;font-size:11px;font-weight:700}.stats strong{font:400 30px Excalifont,sans-serif}.panel{margin-bottom:16px}.panel h2{margin:0 0 5px;font-size:14px}.panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.panel-heading p,.registration-row p{margin:0;color:#64748b;font-size:12px;line-height:1.5}.primary,.secondary,.user-controls button,.create-form button{padding:8px 11px;border:2px solid #1e293b;border-radius:9px;background:#4f46e5;color:white;font:750 11px system-ui;box-shadow:2px 2px 0 #1e293b;cursor:pointer}.secondary,.user-controls button{background:white;color:#334155}.danger{color:#be123c!important}.create-form{display:grid;grid-template-columns:120px minmax(0,1fr);align-items:center;gap:9px 12px;margin:18px 0;padding:14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}.create-form label{font-size:12px;font-weight:750}.create-form input,.create-form select,.user-controls select{min-width:0;padding:8px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#1e293b;font:12px system-ui}.create-form button{grid-column:2;justify-self:start}.user-list{display:grid;gap:10px;margin-top:18px}.user-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid #e2e8f0}.user-identity{display:flex;align-items:center;gap:10px;min-width:0}.avatar{display:grid;place-items:center;width:38px;height:38px;flex:0 0 auto;border:2px solid #1e293b;border-radius:11px;background:#eef2ff;color:#4f46e5;font:400 20px Excalifont,sans-serif}.user-identity>div{display:grid;gap:3px;min-width:0}.user-identity strong{font-size:12px}.user-identity small{overflow-wrap:anywhere;color:#64748b;font-size:10px}.user-controls{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:7px}.user-controls button{padding:7px 8px;box-shadow:none}.toggle{border-color:#cbd5e1!important;background:#f1f5f9!important;color:#64748b!important;box-shadow:none!important}.toggle.active{border-color:#a7f3d0!important;background:#ecfdf5!important;color:#047857!important}.reset-flag{width:100%;text-align:right;color:#b45309;font-size:10px}.registration-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:18px;padding-top:16px;border-top:1px solid #e2e8f0}.registration-row strong{font-size:12px}.registration-row p{margin-top:4px}.status-row{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-bottom:1px solid #e2e8f0;font-size:12px}.status-row:last-of-type{border-bottom:0}.status-row b{color:#be123c;font-size:11px}.status-row b.ok{color:#047857}.hint{margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6}.hint code{padding:2px 5px;border-radius:5px;background:#f1f5f9;color:#334155}.message{padding:10px 12px;border:2px solid;border-radius:10px;font-size:12px;font-weight:650}.error{border-color:#be123c;background:#fff1f2;color:#9f1239}.success{border-color:#059669;background:#ecfdf5;color:#065f46}.footer-actions{display:flex;justify-content:flex-end;margin-top:20px}.footer-actions button{padding:10px 14px;border:2px solid #1e293b;border-radius:11px;background:white;color:#1e293b;font:750 12px system-ui;box-shadow:2px 2px 0 #1e293b;cursor:pointer}
  :global(html[data-theme="dark"] body){background:#0a0a0a;color:#e5e7eb}
  :global(html[data-theme="dark"] .admin-page){background-color:#0a0a0a;background-image:radial-gradient(#262626 1px,transparent 1px)}
  :global(html[data-theme="dark"] .content h1){color:#f5f5f5}
  :global(html[data-theme="dark"] .stats article),:global(html[data-theme="dark"] .panel){background:#171717;border-color:#525252;box-shadow:3px 3px 0 #404040}
  :global(html[data-theme="dark"] .stats small),:global(html[data-theme="dark"] .panel-heading p),:global(html[data-theme="dark"] .registration-row p),:global(html[data-theme="dark"] .user-identity small),:global(html[data-theme="dark"] .hint),:global(html[data-theme="dark"] .eyebrow){color:#a3a3a3}
  :global(html[data-theme="dark"] .user-row),:global(html[data-theme="dark"] .registration-row),:global(html[data-theme="dark"] .status-row){border-color:#333}
  :global(html[data-theme="dark"] .create-form){background:#202020;border-color:#404040}
  :global(html[data-theme="dark"] .create-form input),:global(html[data-theme="dark"] .create-form select),:global(html[data-theme="dark"] .user-controls select){background:#262626;border-color:#525252;color:#f5f5f5}
  :global(html[data-theme="dark"] .secondary),:global(html[data-theme="dark"] .user-controls button:not(.toggle)){background:#262626;border-color:#525252;color:#e5e7eb}
  :global(html[data-theme="dark"] .danger){color:#fda4af!important}
  :global(html[data-theme="dark"] .toggle){background:#262626!important;border-color:#525252!important;color:#a3a3a3!important}
  :global(html[data-theme="dark"] .toggle.active){background:#052e24!important;border-color:#047857!important;color:#6ee7b7!important}
  :global(html[data-theme="dark"] .avatar){background:#262626;border-color:#525252;color:#c4b5fd}
  :global(html[data-theme="dark"] .hint code){background:#262626;color:#e5e7eb}
  :global(html[data-theme="dark"] .footer-actions button){background:#262626;border-color:#525252;color:#e5e7eb;box-shadow:2px 2px 0 #404040}
  .primary:disabled,.secondary:disabled,.user-controls button:disabled{opacity:.55;cursor:not-allowed}
  .primary:focus-visible,.secondary:focus-visible,.user-controls button:focus-visible,.create-form input:focus-visible,.create-form select:focus-visible,.user-controls select:focus-visible,.toggle:focus-visible,.footer-actions button:focus-visible{outline:3px solid #818cf8;outline-offset:2px}
  .admin-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 24px}.admin-toolbar h2,.section-heading h2{margin:0 0 5px;font-size:16px;font-weight:800}.admin-toolbar p,.section-heading p{margin:0;color:#64748b;font-size:12px;line-height:1.5}.toolbar-actions,.table-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.access-panel{margin-bottom:22px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px}.section-icon{display:grid;place-items:center;width:40px;height:40px;border:2px solid #1e293b;border-radius:11px;background:#a7f3d0;color:#111827;font-size:22px;font-weight:800}.registration-row{margin-top:0}.users-section{margin:0 0 22px}.users-table-wrap{overflow-x:auto;border:2px solid #1e293b;border-radius:14px;background:#fff;box-shadow:3px 3px 0 #1e293b}.users-table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}.users-table th{padding:12px 14px;background:#f8fafc;color:#64748b;font-size:10px;font-weight:800;white-space:nowrap}.users-table td{padding:12px 14px;border-top:1px solid #e2e8f0;vertical-align:middle}.users-table td select{max-width:130px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#1e293b;font:12px system-ui}.table-user{min-width:180px}.table-user strong,.table-user small{display:block;overflow-wrap:anywhere}.table-user strong{margin-bottom:4px;font-size:12px}.table-user small{margin-top:3px;color:#64748b;font-size:10px}.compact-toggle{padding:6px 9px!important;font-size:10px!important;white-space:nowrap}.table-actions{min-width:155px}.table-actions button{padding:7px 8px;font-size:10px}.empty-users{padding:26px!important;color:#64748b;text-align:center}.create-panel{margin-bottom:22px}.create-panel .create-form{margin-bottom:0}
  :global(html[data-theme="dark"] .admin-toolbar p),:global(html[data-theme="dark"] .section-heading p){color:#a3a3a3}
  :global(html[data-theme="dark"] .section-icon){background:#064e3b;border-color:#525252;color:#a7f3d0}
  :global(html[data-theme="dark"] .users-table-wrap){background:#171717;border-color:#525252;box-shadow:3px 3px 0 #404040}
  :global(html[data-theme="dark"] .users-table th){background:#262626;color:#a3a3a3}
  :global(html[data-theme="dark"] .users-table td){border-color:#333}
  :global(html[data-theme="dark"] .users-table td select){background:#262626;border-color:#525252;color:#f5f5f5}
  :global(html[data-theme="dark"] .table-user small),:global(html[data-theme="dark"] .empty-users){color:#a3a3a3}
  @media(max-width:800px){.admin-toolbar{align-items:flex-start;flex-direction:column}.toolbar-actions{width:100%}.users-table{min-width:720px}}
  @media(max-width:800px){.user-row{align-items:stretch;flex-direction:column}.user-controls{justify-content:flex-start}.reset-flag{text-align:left}.create-form{grid-template-columns:minmax(0,1fr)}.create-form button{grid-column:1}}@media(max-width:650px){:global(.admin-page){padding:8px}.layout{grid-template-columns:minmax(0,1fr);gap:8px;min-height:calc(100dvh - 16px)}.content{padding:22px 8px 40px}.content h1{font-size:32px}.panel-heading{flex-direction:column}}
</style>
