<script lang="ts">
  import { confirmAction } from '$lib/confirm';
  import WorkspaceSidebar from '$lib/WorkspaceSidebar.svelte';
  import { onMount } from 'svelte';
  import { resetImageCompressionMemo } from '$lib/imageCompression';
  import { IMAGE_COMPRESSION_ENABLED_KEY, MIN_IMAGE_COMPRESSION_THRESHOLD_MB, MAX_IMAGE_COMPRESSION_THRESHOLD_MB, readImageCompressionEnabled, readImageCompressionThresholdMb, writeImageCompressionThresholdMb } from '$lib/imageCompressionSettings';
  import { createDrawFlareArchive, readDrawFlareArchive, readLegacyZip, type WorkspaceBackup } from '$lib/backupArchive';
  type Preferences = { uiTheme: 'light' | 'dark' | 'system'; theme: 'light' | 'dark' | 'system'; background: string; gridSize: number; autosaveSeconds: number; editorAutoHide: boolean; compactSidebar: boolean };
  const defaults: Preferences = { uiTheme: 'light', theme: 'light', background: '#ffffff', gridSize: 0, autosaveSeconds: 1, editorAutoHide: false, compactSidebar: false };
  let preferences = $state<Preferences>({ ...defaults });
  let backupBusy = $state(false);
  let backupMessage = $state('');
  let backupError = $state('');
  let exportMessage = $state('');
  let exportError = $state('');
  let backupInput: HTMLInputElement;
  let showAdvanced = $state(false);
  let error = $state('');
  let updateChannel = $state<'stable' | 'prerelease'>('stable');
  let updateInfo = $state<{ latestVersion: string; name: string; url: string; publishedAt: string | null } | null>(null);
  let updateLoading = $state(false);
  let updateError = $state('');
  let authEnabled = $state(false);
  let sharedPasswordEnabled = $state(false);
  let userAccountsEnabled = $state(false);
  let registrationEnabled = $state(false);
  let userCount = $state(0);
  let authMode = $state('environment');
  const appVersion = import.meta.env.VITE_APP_VERSION || '0.1.0';
  const buildLabel = import.meta.env.VITE_APP_BUILD_LABEL || '';
  let legacyBusy = $state(false);
  let legacyInput: HTMLInputElement;
  let advancedMessage = $state('');
  let imageCompression = $state(true);
  let imageCompressionThresholdMb = $state(0.25);
  type ApiKey = { id: string; name: string; prefix: string; scopes: string; last_used_at: string | null; revoked_at: string | null; created_at: string };
  let apiKeys = $state<ApiKey[]>([]);
  let keysLoading = $state(false);
  let keyName = $state('');
  let keyScopes = $state<string[]>(['drawings:read', 'drawings:write', 'collections:read', 'collections:write']);
  let keyBusy = $state(false);
  let revealedToken = $state('');
  let keyMessage = $state('');
  let keyError = $state('');
  type LanguageOption = { code: string; label: string };
  let langCode = $state('en');
  let languageOptions = $state<LanguageOption[]>([{ code: 'en', label: 'English' }]);
  function updateLanguage(code: string) {
    langCode = code;
    try { localStorage.setItem('drawflare-lang', code); } catch { error = 'Could not save language preference in this browser.'; }
    document.documentElement.lang = code;
  }
  let uiLocale = $state<'en' | 'zh-CN'>('en');
  function updateUiLocale(code: string) {
    uiLocale = code === 'zh-CN' ? 'zh-CN' : 'en';
    try { localStorage.setItem('drawflare-ui-locale', uiLocale); } catch { error = 'Could not save language preference in this browser.'; }
    location.reload();
  }
  async function exportBackup() {
    backupBusy = true; exportError = ''; exportMessage = '';
    try {
      const response = await fetch('/api/backup');
      if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error || 'Could not export backup'); }
      const payload = await response.json() as WorkspaceBackup;
      const archive = createDrawFlareArchive(payload);
      const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([archiveBuffer], { type: 'application/zip' }));
      const link = document.createElement('a'); link.href = url; link.download = 'drawflare-backup-' + new Date().toISOString().slice(0, 10) + '.drawflare'; link.click();
      URL.revokeObjectURL(url); exportMessage = 'Workspace backup exported as .drawflare.';
    } catch (e) { exportError = e instanceof Error ? e.message : 'Could not export backup'; }
    finally { backupBusy = false; }
  }
  async function postBackup(payload: WorkspaceBackup) {
    const response = await fetch('/api/backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({})) as { error?: string; importedCollections?: number; importedDrawings?: number };
    if (!response.ok) throw new Error(data.error || 'Could not import backup');
    return data;
  }
  async function importBackup(file: File | undefined) {
    if (!file) return;
    backupBusy = true; backupError = ''; backupMessage = '';
    try {
      let payload: WorkspaceBackup;
      if (/\.drawflare$/i.test(file.name)) payload = readDrawFlareArchive(new Uint8Array(await file.arrayBuffer()));
      else payload = JSON.parse(await file.text()) as WorkspaceBackup;
      if (payload.format !== 'drawflare-backup' || payload.version !== 1 || !Array.isArray(payload.collections) || !Array.isArray(payload.drawings)) throw new Error('Unsupported backup. Choose a valid .drawflare backup or DrawFlare backup JSON file.');
      const exportedAt = payload.exportedAt ? new Date(payload.exportedAt).toLocaleString() : 'Unknown';
      const approved = await confirmAction(`This will merge ${payload.collections.length} collection(s) and ${payload.drawings.length} drawing(s) from a Format v1 backup exported at ${payload.exportedAt || 'an unknown date'}.`, { title: 'Import backup?', confirmLabel: 'Import' });
      if (!approved) return;
      const data = await postBackup(payload);
      backupMessage = `Imported ${data.importedDrawings ?? 0} drawings and ${data.importedCollections ?? 0} collections.`;
    } catch (e) { backupError = e instanceof Error ? e.message : 'Could not import backup'; }
    finally { backupBusy = false; if (backupInput) backupInput.value = ''; }
  }
  async function checkForUpdates(channel = updateChannel) {
    updateLoading = true;
    updateError = '';
    try {
      const response = await fetch('/api/updates?channel=' + encodeURIComponent(channel));
      const data = await response.json() as { latestVersion?: string; name?: string; url?: string; publishedAt?: string | null; error?: string };
      if (!response.ok || !data.latestVersion || !data.url) throw new Error(data.error || 'Could not check for updates');
      updateInfo = { latestVersion: data.latestVersion, name: data.name || data.latestVersion, url: data.url, publishedAt: data.publishedAt ?? null };
    } catch (e) { updateError = e instanceof Error ? e.message : 'Could not check for updates'; }
    finally { updateLoading = false; }
  }
  async function createImportedDrawing(title: string, scene: Record<string, unknown>) {
    const createResponse = await fetch('/api/drawings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
    const created = await createResponse.json().catch(() => ({})) as { id?: string; error?: string };
    if (!createResponse.ok || !created.id) throw new Error(created.error || 'Could not create drawing');
    const saveResponse = await fetch('/api/drawings/' + encodeURIComponent(created.id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, scene: { elements: scene.elements, appState: scene.appState && typeof scene.appState === 'object' ? scene.appState : {}, files: scene.files && typeof scene.files === 'object' ? scene.files : {} }, expectedRevision: 1 }) });
    const saved = await saveResponse.json().catch(() => ({})) as { error?: string };
    if (!saveResponse.ok) { await fetch('/api/drawings/' + encodeURIComponent(created.id), { method: 'DELETE' }).catch(() => undefined); throw new Error(saved.error || 'Could not save imported drawing'); }
  }
  async function importLegacy(files: File[] | undefined) {
    if (!files?.length) return;
    advancedMessage = '';
    if (files.some((file) => file.size > 50 * 1024 * 1024)) { advancedMessage = 'A selected file exceeds the 50 MB import limit.'; if (legacyInput) legacyInput.value = ''; return; }
    if (files.some((file) => /\.(sqlite|db)$/i.test(file.name))) { advancedMessage = 'SQLite database import is not available in the Cloudflare Worker/D1 adaptation. Export that database from the upstream DrawFlare instance as a .drawflare backup, then import the backup here.'; if (legacyInput) legacyInput.value = ''; return; }
    if (!await confirmAction('Import the selected backup or drawing files? Existing drawings will not be overwritten; imported drawings are added as copies.', { title: 'Import files', confirmLabel: 'Import files' })) { if (legacyInput) legacyInput.value = ''; return; }
    legacyBusy = true;
    try {
      let imported = 0;
      for (const file of files) {
        if (/\.drawflare$/i.test(file.name)) {
          const data = await postBackup(readDrawFlareArchive(new Uint8Array(await file.arrayBuffer())));
          imported += data.importedDrawings ?? 0;
          continue;
        }
        if (/\.zip$/i.test(file.name)) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let backup: WorkspaceBackup | null = null;
          try { backup = readDrawFlareArchive(bytes); } catch { /* A regular legacy ZIP may not contain an DrawFlare manifest. */ }
          if (backup) {
            const data = await postBackup(backup);
            imported += data.importedDrawings ?? 0;
            continue;
          }
          const legacyScenes = readLegacyZip(bytes);
          for (const drawing of legacyScenes) { await createImportedDrawing(drawing.name, drawing.scene); imported += 1; }
          continue;
        }
        const payload = JSON.parse(await file.text()) as Record<string, unknown>;
        if (payload.format === 'drawflare-backup') {
          const data = await postBackup(payload as unknown as WorkspaceBackup);
          imported += data.importedDrawings ?? 0;
          continue;
        }
        const nested = payload.scene && typeof payload.scene === 'object' ? payload.scene as Record<string, unknown> : payload;
        if (!Array.isArray(nested.elements)) throw new Error('Unsupported file: ' + file.name + '. Choose .excalidraw or scene JSON.');
        const title = file.name.replace(/\.(excalidraw|json)$/i, '').slice(0, 160) || 'Imported drawing';
        await createImportedDrawing(title, nested); imported += 1;
      }
      advancedMessage = `Imported ${imported} drawing(s).`;
    } catch (e) { advancedMessage = e instanceof Error ? e.message : 'Could not import file'; }
    finally { legacyBusy = false; if (legacyInput) legacyInput.value = ''; }
  }
  function toggleImageCompression() {
    imageCompression = !imageCompression;
    try { localStorage.setItem(IMAGE_COMPRESSION_ENABLED_KEY, String(imageCompression)); } catch { /* Keep the in-memory preference. */ }
    resetImageCompressionMemo();
  }
  function updateImageCompressionThreshold(value: number) {
    imageCompressionThresholdMb = writeImageCompressionThresholdMb(value);
    resetImageCompressionMemo();
  }
  onMount(() => {
    try {
      const raw = localStorage.getItem('excali_preferences');
      if (raw) preferences = { ...defaults, ...JSON.parse(raw) } as Preferences;
      const savedChannel = localStorage.getItem('drawflare-update-channel');
      if (savedChannel === 'prerelease') updateChannel = 'prerelease';
      imageCompression = readImageCompressionEnabled();
      imageCompressionThresholdMb = readImageCompressionThresholdMb();
      const savedLanguage = localStorage.getItem('drawflare-lang');
      if (savedLanguage) langCode = savedLanguage;
      const savedUiLocale = localStorage.getItem('drawflare-ui-locale');
      if (savedUiLocale === 'zh-CN') uiLocale = 'zh-CN';
      document.documentElement.lang = langCode;
      void import('@excalidraw/excalidraw').then((module) => {
        languageOptions = module.languages.map((language) => ({ code: language.code, label: language.label }));
        if (!languageOptions.some((language) => language.code === langCode)) langCode = 'en';
      }).catch(() => undefined);
      document.documentElement.dataset.compactSidebar = preferences.compactSidebar ? 'true' : 'false';
      applyTheme();
    } catch { error = 'Could not read saved preferences.'; }
    void fetch('/api/auth/modes').then(async (response) => {
      if (response.ok) {
        const data = await response.json() as { authEnabled?: boolean; sharedPasswordEnabled?: boolean; userAccountsEnabled?: boolean; registrationEnabled?: boolean; userCount?: number };
        authEnabled = data.authEnabled === true;
        if (authEnabled) void loadApiKeys();
        sharedPasswordEnabled = data.sharedPasswordEnabled === true;
        userAccountsEnabled = data.userAccountsEnabled === true;
        registrationEnabled = data.registrationEnabled === true;
        userCount = data.userCount ?? 0;
        authMode = sharedPasswordEnabled && userAccountsEnabled ? 'Shared password + accounts' : sharedPasswordEnabled ? 'Shared password' : userAccountsEnabled ? 'User accounts' : 'Public workspace';
      }
    }).catch(() => undefined);
    void checkForUpdates(updateChannel);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => { if (preferences.uiTheme === 'system') applyTheme(); };
    media.addEventListener('change', syncSystemTheme);
    return () => media.removeEventListener('change', syncSystemTheme);
  });
  function applyTheme() {
    const dark = preferences.uiTheme === 'dark' || (preferences.uiTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0a0a0a' : '#f8fafc');
  }
  function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    preferences[key] = value;
    try {
      localStorage.setItem('excali_preferences', JSON.stringify(preferences));
      error = '';
    } catch { error = 'Could not save preferences in this browser.'; }
    if (key === 'uiTheme') applyTheme();
    if (key === 'compactSidebar') document.documentElement.dataset.compactSidebar = value ? 'true' : 'false';
  }
  async function loadApiKeys() {
    keysLoading = true;
    try {
      const response = await fetch('/api/profile/api-keys');
      const data = await response.json() as ApiKey[] | { error?: string };
      if (!response.ok || !Array.isArray(data)) throw new Error((data as { error?: string }).error || 'Could not load API keys');
      apiKeys = data;
    } catch (e) { keyError = e instanceof Error ? e.message : 'Could not load API keys'; }
    finally { keysLoading = false; }
  }
  async function createApiKey() {
    if (!keyName.trim() || keyScopes.length === 0) { keyError = 'Give the key a name and select at least one permission.'; return; }
    keyBusy = true; keyError = ''; keyMessage = ''; revealedToken = '';
    try {
      const response = await fetch('/api/profile/api-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: keyName, scopes: keyScopes }) });
      const data = await response.json() as { error?: string; token?: string };
      if (!response.ok || !data.token) throw new Error(data.error || 'Could not create API key');
      revealedToken = data.token; keyName = ''; keyMessage = 'API key created. Copy it now; the full token will not be shown again.'; await loadApiKeys();
    } catch (e) { keyError = e instanceof Error ? e.message : 'Could not create API key'; }
    finally { keyBusy = false; }
  }
  async function revokeApiKey(key: ApiKey) {
    if (!await confirmAction('Revoke API key “' + key.name + '”? Any MCP client using it will lose access.', { title: 'Revoke API key', confirmLabel: 'Revoke key', destructive: true })) return;
    try {
      const response = await fetch('/api/profile/api-keys/' + encodeURIComponent(key.id), { method: 'DELETE' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not revoke API key');
      keyMessage = 'API key revoked.'; await loadApiKeys();
    } catch (e) { keyError = e instanceof Error ? e.message : 'Could not revoke API key'; }
  }
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }
</script>

<svelte:head><title>Settings · DrawFlare</title></svelte:head>
<main class="settings-page">
  <div class="settings-layout">
    <WorkspaceSidebar activePage="settings" />
    <section class="content">
      <h1>Settings</h1>

      {#if authEnabled}
        <section class="settings-card api-key-card">
          <div class="api-title"><div class="setting-icon emerald"><span aria-hidden="true">⌘</span></div><div><h2>API Keys</h2><p>Tokens for apps and scripts</p></div></div>
          <form class="key-form" onsubmit={(event) => { event.preventDefault(); void createApiKey(); }}>
            <div class="key-create"><div><label for="settings-key-name">API key name</label><p>Example: Backup script</p></div><input id="settings-key-name" bind:value={keyName} maxlength="80" placeholder="Key name" required /><button class="primary" disabled={keyBusy}>{keyBusy ? 'Creating…' : 'Create API Key'}</button></div>
            <span class="scope-label">Scopes</span>
            <div class="scope-grid"><label><input type="checkbox" value="drawings:read" bind:group={keyScopes} /> Read drawings</label><label><input type="checkbox" value="drawings:write" bind:group={keyScopes} /> Write drawings</label><label><input type="checkbox" value="collections:read" bind:group={keyScopes} /> Read collections</label><label><input type="checkbox" value="collections:write" bind:group={keyScopes} /> Write collections</label></div>
          </form>
          {#if revealedToken}<div class="token-reveal"><strong>Copy this token now</strong><p>It will not be displayed again after you leave this page.</p><code>{revealedToken}</code><button class="secondary" onclick={() => { void navigator.clipboard.writeText(revealedToken).then(() => keyMessage = 'API key copied to clipboard.').catch(() => keyError = 'Clipboard access failed; select and copy the token manually.'); }}>Copy token</button></div>{/if}
          {#if keyMessage}<p class="message success" role="status">{keyMessage}</p>{/if}{#if keyError}<p class="message error" role="alert">{keyError}</p>{/if}
          {#if keysLoading}<p class="key-empty">Loading API keys…</p>{:else if apiKeys.length === 0}<p class="key-empty">No API keys have been created yet.</p>{:else}<div class="key-list">{#each apiKeys as key (key.id)}<article class="key-row"><div class="key-info"><strong>{key.name}</strong><code>{key.prefix}••••••••</code><small>{key.scopes.split(',').join(' · ')}</small><small>Last used: {key.last_used_at ? new Date(key.last_used_at.replace(' ', 'T') + (key.last_used_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : 'Never'}</small></div>{#if key.revoked_at}<span class="revoked">Revoked</span>{:else}<button class="secondary" onclick={() => void revokeApiKey(key)}>Revoke</button>{/if}</article>{/each}</div>{/if}
        </section>
      {:else}
        <section class="settings-card api-key-card">
          <div class="api-title"><div class="setting-icon emerald"><span aria-hidden="true">⌘</span></div><div><h2>API Keys</h2><p>Tokens for apps and scripts</p></div></div>
          <p class="key-empty">Enable account authentication to create personal API keys. <a href="/profile">Open account setup</a>.</p>
        </section>
      {/if}


      <section class="settings-card main-settings">
        <div class="setting-row">
          <div class="setting-icon emerald"><span aria-hidden="true">文</span></div>
          <div class="setting-copy"><h3>Language</h3><p>Choose the language used by the Excalidraw editor.</p></div>
          <select aria-label="Editor language" value={langCode} onchange={(event) => updateLanguage((event.currentTarget as HTMLSelectElement).value)}>
            {#each languageOptions as language (language.code)}<option value={language.code}>{language.label}</option>{/each}
          </select>
        </div>
        <div class="setting-row">
          <div class="setting-icon amber"><span aria-hidden="true">◐</span></div>
          <div class="setting-copy"><h3>Appearance</h3></div>
          <label class="toggle-control" aria-label="Toggle dark mode"><input type="checkbox" checked={preferences.uiTheme === 'dark'} onchange={(event) => updatePreference('uiTheme', (event.currentTarget as HTMLInputElement).checked ? 'dark' : 'light')} /><span></span></label>
        </div>
        <div class="setting-row">
          <div class="setting-icon cyan"><span aria-hidden="true">◉</span></div>
          <div class="setting-copy"><h3>Auto-hide editor header</h3><p>{preferences.editorAutoHide ? 'Hide by default' : 'Keep visible by default'}</p></div>
          <label class="toggle-control" aria-label="Toggle editor header auto-hide"><input type="checkbox" checked={preferences.editorAutoHide} onchange={(event) => updatePreference('editorAutoHide', (event.currentTarget as HTMLInputElement).checked)} /><span></span></label>
        </div>
        <div class="setting-row">
          <div class="setting-icon violet"><span aria-hidden="true">◫</span></div>
          <div class="setting-copy"><h3>Compact sidebar</h3><p>Keep account actions in the avatar menu</p></div>
          <label class="toggle-control" aria-label="Toggle compact sidebar"><input type="checkbox" checked={preferences.compactSidebar} onchange={(event) => updatePreference('compactSidebar', (event.currentTarget as HTMLInputElement).checked)} /><span></span></label>
        </div>
        <div class="setting-row">
          <div class="setting-icon blue"><span aria-hidden="true">ϟ</span></div>
          <div class="setting-copy"><h3>Optimized images</h3><p>{imageCompression ? `Compress images over ${imageCompressionThresholdMb} MB` : 'Original quality'}</p></div>
          <div class="compression-control"><label><input aria-label="Image compression threshold in MB" type="number" min={MIN_IMAGE_COMPRESSION_THRESHOLD_MB} max={MAX_IMAGE_COMPRESSION_THRESHOLD_MB} step="0.05" value={imageCompressionThresholdMb} disabled={!imageCompression} onchange={(event) => updateImageCompressionThreshold(Number((event.currentTarget as HTMLInputElement).value))} /> <span>MB</span></label><label class="toggle-control" aria-label="Toggle image optimization"><input type="checkbox" checked={imageCompression} onchange={toggleImageCompression} /><span></span></label></div>
        </div>
        <div class="setting-row">
          <div class="setting-icon indigo"><span aria-hidden="true">▤</span></div>
          <div class="setting-copy"><h3>Export backup</h3></div>
          <div class="backup-actions"><button class="primary" onclick={() => void exportBackup()} disabled={backupBusy}>{backupBusy ? 'Working…' : 'Export'}</button></div>
        </div>
        {#if exportMessage}<p class="message success" role="status">{exportMessage}</p>{/if}
        {#if exportError}<p class="message error" role="alert">{exportError}</p>{/if}
        <div class="setting-row">
          <div class="setting-icon emerald"><span aria-hidden="true">↻</span></div>
          <div class="setting-copy"><h3>Updates</h3><p>{#if updateLoading}Checking GitHub Releases…{:else if updateInfo}<a href={updateInfo.url} target="_blank" rel="noreferrer">Latest: {updateInfo.latestVersion}</a>{:else if updateError}{updateError}{:else}Check for upstream releases{/if}</p></div>
          <div class="backup-actions"><select aria-label="Update channel" value={updateChannel} onchange={(event) => { updateChannel = (event.currentTarget as HTMLSelectElement).value === 'prerelease' ? 'prerelease' : 'stable'; try { localStorage.setItem('drawflare-update-channel', updateChannel); } catch {} void checkForUpdates(updateChannel); }}><option value="stable">Stable</option><option value="prerelease">Prerelease</option></select><button class="secondary" disabled={updateLoading} onclick={() => void checkForUpdates()}>{updateLoading ? 'Checking…' : 'Check'}</button></div>
        </div>
        {#if updateError}<p class="message error" role="alert">{updateError}</p>{/if}
        <div class="setting-row extra-setting">
          <div class="setting-icon violet"><span aria-hidden="true">◒</span></div>
          <div class="setting-copy"><h3>Default canvas theme</h3><p>Theme used when opening a drawing.</p></div>
          <select aria-label="Default canvas theme" value={preferences.theme} onchange={(event) => updatePreference('theme', (event.currentTarget as HTMLSelectElement).value as Preferences['theme'])}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select>
        </div>
        <div class="setting-row extra-setting">
          <div class="setting-icon cyan"><span aria-hidden="true">▧</span></div>
          <div class="setting-copy"><h3>Default canvas background</h3><p>Background color for new drawings.</p></div>
          <label class="color-control" for="background"><input id="background" type="color" value={preferences.background} oninput={(event) => updatePreference('background', (event.currentTarget as HTMLInputElement).value)} /><span>{preferences.background.toUpperCase()}</span></label>
        </div>
        <div class="setting-row extra-setting">
          <div class="setting-icon emerald"><span aria-hidden="true">▦</span></div>
          <div class="setting-copy"><h3>Grid size</h3><p>Show a grid on the canvas by default.</p></div>
          <select aria-label="Grid size" value={preferences.gridSize} onchange={(event) => updatePreference('gridSize', Number((event.currentTarget as HTMLSelectElement).value))}><option value={0}>Off</option><option value={10}>10 px</option><option value={20}>20 px</option><option value={40}>40 px</option></select>
        </div>
        <div class="setting-row extra-setting">
          <div class="setting-icon blue"><span aria-hidden="true">↻</span></div>
          <div class="setting-copy"><h3>Autosave delay</h3><p>Wait this long after edits before saving.</p></div>
          <select aria-label="Autosave delay" value={preferences.autosaveSeconds} onchange={(event) => updatePreference('autosaveSeconds', Number((event.currentTarget as HTMLSelectElement).value))}><option value={1}>1 second</option><option value={2}>2 seconds</option><option value={3}>3 seconds</option></select>
        </div>
        <div class="setting-row extra-setting">
          <div class="setting-icon emerald"><span aria-hidden="true">文</span></div>
          <div class="setting-copy"><h3>Workspace interface language</h3><p>Language for workspace navigation.</p></div>
          <select aria-label="Workspace interface language" value={uiLocale} onchange={(event) => updateUiLocale((event.currentTarget as HTMLSelectElement).value)}><option value="en">English</option><option value="zh-CN">简体中文</option></select>
        </div>
      </section>

      <details class="settings-card advanced" bind:open={showAdvanced}>
        <summary><span>Advanced</span><span aria-hidden="true">›</span></summary>
        <div class="advanced-content">
          <div class="setting-row backup-row">
            <div class="setting-icon blue"><span aria-hidden="true">⇩</span></div>
            <div class="setting-copy"><h3>Import backup</h3><p>Verify a .drawflare archive before merging it into this workspace. Existing drawings are kept.</p></div>
            <div class="backup-actions"><button class="secondary" disabled={backupBusy} onclick={() => backupInput?.click()}>{backupBusy ? 'Verifying…' : 'Choose file'}</button><input bind:this={backupInput} class="backup-input" type="file" accept=".drawflare,application/json,.json" onchange={(event) => void importBackup((event.currentTarget as HTMLInputElement).files?.[0])} /></div>
          </div>
          {#if backupMessage}<p class="message success" role="status">{backupMessage}</p>{/if}
          {#if backupError}<p class="message error" role="alert">{backupError}</p>{/if}
          <div class="setting-row backup-row">
            <div class="setting-icon amber"><span aria-hidden="true">⇧</span></div>
            <div class="setting-copy"><h3>Legacy import</h3><p>Import .excalidraw, scene JSON, ZIP archives, or .drawflare backups. SQLite files need conversion to a portable backup first.</p></div>
            <div class="backup-actions"><button class="secondary" disabled={legacyBusy} onclick={() => legacyInput?.click()}>{legacyBusy ? 'Importing…' : 'Choose files'}</button><input bind:this={legacyInput} class="backup-input" type="file" multiple accept=".drawflare,.excalidraw,.json,.zip,.sqlite,.db,application/json" onchange={(event) => void importLegacy(Array.from((event.currentTarget as HTMLInputElement).files ?? []))} /></div>
          </div>
          {#if advancedMessage}<p class="message" role="status">{advancedMessage}</p>{/if}
          <div class="setting-row advanced-row">
            <div class="setting-icon" style="background:#cbd5e1"><span aria-hidden="true">♧</span></div>
            <div class="setting-copy"><h3>Authentication {authEnabled ? 'on' : 'off'}</h3><p>{authEnabled ? `Managed by Cloudflare · ${authMode}` : 'Configure Worker environment to enable authentication'}</p></div>
            {#if authEnabled && userAccountsEnabled}<a class="action-link" href="/admin">Manage</a>{:else}<span class="status-pill">{authEnabled ? 'Enabled' : 'Disabled'}</span>{/if}
          </div>
          <div class="auth-details">
            <div class="info-row"><span>Individual accounts</span><strong>{userAccountsEnabled ? `Enabled · ${userCount} account(s)` : 'Not configured'}</strong></div>
            <div class="info-row"><span>Shared password</span><strong>{sharedPasswordEnabled ? 'Configured' : 'Not configured'}</strong></div>
            <div class="info-row"><span>Self-registration</span><strong>{registrationEnabled ? 'Enabled' : 'Disabled'}</strong></div>
            {#if authEnabled}<p>Authentication is controlled by Cloudflare Worker secrets and D1. Change the Worker environment and redeploy to update the authentication mode.</p>{:else}<p>Configure AUTH_SECRET and either APP_PASSWORD or D1 user accounts in the Worker environment before enabling account-based access.</p>{/if}
          </div>
          <div class="setting-row advanced-row">
            <div class="setting-icon" style="background:#d1d5db"><span aria-hidden="true">ⓘ</span></div>
            <div class="setting-copy"><h3>Version</h3>{#if buildLabel}<p class="build-label">{buildLabel}</p>{/if}</div>
            <span class="version-pill">{appVersion}</span>
          </div>
          <h3 class="instance-heading">Instance information</h3>
          <div class="info-row"><span>Application</span><strong>DrawFlare on Cloudflare Workers</strong></div>
          <div class="info-row"><span>Backup format</span><strong>.drawflare ZIP · manifest v1</strong></div>
          <div class="info-row"><span>Storage</span><strong>Cloudflare D1 + optional R2</strong></div>
          <p>Backups contain drawing content from this workspace. Store exported files somewhere secure.</p>
        </div>
      </details>
      {#if error}<p class="message error" role="alert">{error}</p>{/if}
    </section>
  </div>
</main>

<style>
  :global(body){margin:0;background:#f3f4f6;color:#1e293b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
  :global(.settings-page){min-height:100dvh;padding:14px;background-color:#f3f4f6;background-image:radial-gradient(#cbd5e1 1px,transparent 1px);background-size:24px 24px}
:global(.settings-layout){display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px;min-height:calc(100dvh - 28px)}
  .content{width:min(100%,980px);min-width:0;box-sizing:border-box;margin:0 auto;padding:38px 28px 64px}
  .content h1{margin:0 0 8px;color:#0f172a;font:400 42px 'Excalifont',sans-serif}
  .settings-card{display:grid;gap:0;margin:0 0 22px;padding:18px;border:2px solid #1e293b;border-radius:18px;background:#fff;box-shadow:3px 3px 0 #1e293b}
  .setting-row{display:flex;align-items:center;gap:14px;min-width:0;padding:15px 2px;border-top:1px solid #e2e8f0}
  .api-key-card{padding:0;overflow:hidden}.api-title{display:flex;align-items:center;gap:12px;padding:18px 18px 10px}.api-title h2{margin:0 0 3px;font-size:16px;font-weight:850}.api-title p,.key-create p{margin:0;color:#64748b;font-size:11px}.key-form{margin:0 18px 0;padding:12px 0 14px;border-bottom:1px solid #e2e8f0}.key-create{display:grid;grid-template-columns:minmax(120px,1fr) minmax(120px,180px) auto;align-items:center;gap:10px}.key-create label{font-size:12px;font-weight:800}.key-create input{min-width:0;padding:9px 11px;border:2px solid #e2e8f0;border-radius:10px;font:12px system-ui}.key-create button{padding:9px 12px;border:2px solid #1e293b;border-radius:10px;background:#a5b4fc;color:#111827;font:800 11px system-ui;box-shadow:2px 2px 0 #1e293b;cursor:pointer}.scope-label{display:block;margin:10px 0 7px;font-size:11px;font-weight:800}.scope-grid{display:flex;flex-wrap:wrap;gap:7px}.scope-grid label{display:flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid #e2e8f0;border-radius:8px;color:#475569;font-size:10px;font-weight:700}.scope-grid input{accent-color:#059669}.key-empty{margin:0;padding:14px 18px;color:#64748b;font-size:12px}.key-empty a{color:#4f46e5;font-weight:750}.token-reveal{display:grid;gap:7px;margin:12px 18px;padding:12px;border:2px solid #a7f3d0;border-radius:10px;background:#ecfdf5;font-size:12px}.token-reveal p{margin:0;color:#64748b}.token-reveal code{overflow-wrap:anywhere;padding:8px;border-radius:7px;background:white}.token-reveal button,.key-row button{justify-self:start;padding:7px 10px;border:2px solid #1e293b;border-radius:8px;background:#fff;font:750 11px system-ui;cursor:pointer}.key-list{display:grid}.key-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-top:1px solid #e2e8f0}.key-info{display:grid;gap:4px;min-width:0}.key-info strong{font-size:12px}.key-info code,.key-info small{overflow-wrap:anywhere;color:#64748b;font-size:10px}.revoked{color:#be123c;font-size:11px;font-weight:800}

  .main-settings{padding:0;overflow:hidden;gap:0}.main-settings>.setting-row{padding:14px 18px;margin:0}.main-settings>.setting-row:first-child{border-top:0}.main-settings>.message{margin:8px 16px}.main-settings .setting-copy h3{font-size:13px}.main-settings .backup-actions{margin-left:auto}.main-settings .backup-actions button{min-width:70px;background:#4f46e5;color:#fff;border-color:#1e293b}.main-settings .extra-setting{background:#fafafa}.main-settings .extra-setting:first-of-type{border-top:1px dashed #cbd5e1}
  .toggle-control{display:flex;align-items:center;gap:8px;cursor:pointer}.toggle-control input{position:absolute;width:1px;height:1px;opacity:0}.toggle-control span{position:relative;display:block;box-sizing:border-box;width:42px;height:24px;flex:0 0 42px;border:2px solid #1e293b;border-radius:999px;background:#e2e8f0;transition:background .15s ease}.toggle-control span:after{position:absolute;top:50%;left:2px;box-sizing:border-box;width:14px;height:14px;border:1.5px solid #1e293b;border-radius:50%;background:#fff;content:"";transform:translateY(-50%);transition:left .15s ease}.toggle-control input:checked+span{background:#6ee7b7}.toggle-control input:checked+span:after{left:22px;transform:translateY(-50%)}.toggle-control input:focus-visible+span{outline:3px solid #a5b4fc;outline-offset:2px}.compression-control>label:first-child{display:flex;align-items:center;gap:6px}.compression-control input[type=number]{width:76px;padding:8px;border:2px solid #e2e8f0;border-radius:10px;background:#fff;color:#1e293b;font:700 12px system-ui}

  .setting-icon{display:grid;flex:0 0 44px;width:44px;height:44px;place-items:center;border:2px solid #1e293b;border-radius:12px;color:#111827;font-size:22px;font-weight:800}
  .amber{background:#fbbf24}.violet{background:#a78bfa}.cyan{background:#67e8f9}.emerald{background:#6ee7b7}.blue{background:#60a5fa}.indigo{background:#a5b4fc}
  .setting-copy{flex:1;min-width:0}.setting-copy h3{margin:0 0 4px;font-size:13px;font-weight:800;color:#0f172a}.setting-copy p{margin:0;color:#64748b;font-size:12px;line-height:1.5}
  select{width:auto;min-width:118px;max-width:42%;padding:9px 34px 9px 11px;border:2px solid #cbd5e1;border-radius:10px;background-color:#fff;color:#1e293b;font:700 12px system-ui;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364758b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;cursor:pointer}
  select:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #a5b4fc;outline-offset:2px}
  .color-control{display:flex;align-items:center;gap:8px;margin:0;color:#64748b;font:800 11px ui-monospace,monospace}.color-control input{width:38px;height:34px;padding:2px;border:2px solid #1e293b;border-radius:9px;background:#fff;cursor:pointer}
  .backup-row{flex-wrap:wrap}.backup-actions{display:flex;flex-wrap:wrap;gap:8px}.backup-actions button{padding:9px 12px;border:2px solid #1e293b;border-radius:10px;font:800 11px system-ui;cursor:pointer;box-shadow:2px 2px 0 #1e293b}.primary{background:#a7f3d0;color:#111827}.secondary{background:#fff;color:#1e293b}.backup-actions button:disabled{opacity:.55;cursor:wait}.backup-input{display:none}
  .action-link{display:inline-flex;align-items:center;justify-content:center;padding:9px 12px;border:2px solid #1e293b;border-radius:10px;background:#a5b4fc;color:#111827;text-decoration:none;font:800 11px system-ui;box-shadow:2px 2px 0 #1e293b;white-space:nowrap}
  .compression-control{display:flex;align-items:center;gap:12px}.compression-control input:disabled{opacity:.5}
  .message{margin:12px 0 0;padding:10px 12px;border:2px solid;border-radius:10px;font-size:12px;font-weight:650}.error{border-color:#be123c;background:#fff1f2;color:#9f1239}.success{border-color:#059669;background:#ecfdf5;color:#065f46}
  .advanced{display:block;padding:0;overflow:hidden}.advanced summary{padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none;font-size:14px;font-weight:850}.advanced summary::-webkit-details-marker{display:none}.advanced[open] summary{padding-bottom:14px;border-bottom:1px solid #e2e8f0}.advanced-content{display:grid;gap:10px;padding:14px 18px 18px}.advanced-content h3{margin:0;font-size:13px}.advanced-row{padding:12px 0}.advanced-row .setting-icon{flex-basis:40px;width:40px;height:40px}.status-pill,.version-pill{padding:5px 9px;border:2px solid #1e293b;border-radius:999px;font-size:10px;font-weight:850;white-space:nowrap}.instance-heading{padding-top:8px;border-top:1px solid #e2e8f0}.auth-details{display:grid;gap:9px;padding:0 0 10px 52px}.build-label{color:#ef4444!important;font-weight:800}.advanced-content p{margin:0;color:#64748b;font-size:12px;line-height:1.6}.info-row{display:flex;justify-content:space-between;gap:16px;font-size:12px}.info-row span{color:#64748b}.info-row strong{text-align:right}
  :global(html[data-theme="dark"] body){background:#0a0a0a;color:#e5e7eb}
  :global(html[data-theme="dark"] .settings-page){background-color:#0a0a0a;background-image:radial-gradient(#262626 1px,transparent 1px)}
  :global(html[data-theme="dark"] .content h1),:global(html[data-theme="dark"] .setting-copy h3){color:#f5f5f5}
  :global(html[data-theme="dark"] .settings-card){background:#171717;border-color:#525252;box-shadow:3px 3px 0 #404040}
  :global(html[data-theme="dark"] .setting-row){border-color:#333}
  :global(html[data-theme="dark"] .setting-icon){border-color:#525252}
  :global(html[data-theme="dark"] select){background-color:#262626;color:#f5f5f5;border-color:#525252}
  :global(html[data-theme="dark"] .secondary){background:#262626;color:#f5f5f5;border-color:#525252}
  :global(html[data-theme="dark"] .backup-actions button){border-color:#525252;box-shadow:2px 2px 0 #404040}
:global(html[data-theme="dark"] .main-settings .extra-setting){background:#202020}:global(html[data-theme="dark"] .key-form){border-color:#333}:global(html[data-theme="dark"] .scope-grid label){border-color:#444;color:#ddd}
  @media(max-width:900px){:global(.settings-layout){grid-template-columns:220px minmax(0,1fr)}.content{padding:30px 18px 48px}}
  @media(max-width:650px){.key-create{grid-template-columns:minmax(0,1fr)}.key-create button{justify-self:start}.scope-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.main-settings>.setting-row{padding:12px}.compression-control{gap:7px}.compression-control input[type=number]{width:60px}:global(.settings-page){padding:8px}:global(.settings-layout){grid-template-columns:minmax(0,1fr);gap:8px;min-height:calc(100dvh - 16px)}.content{padding:22px 8px 40px}.content h1{font-size:34px}.setting-row{gap:10px}.setting-icon{flex-basis:38px;width:38px;height:38px;font-size:19px}.setting-copy p{font-size:11px}.setting-row select{min-width:95px;max-width:38%;font-size:11px}.backup-actions{width:100%;padding-left:48px}.backup-actions button{flex:1}.info-row{align-items:flex-start}.info-row strong{max-width:60%}}
</style>
