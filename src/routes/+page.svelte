<script lang="ts">
  import { replaceState } from '$app/navigation';
  import { confirmAction, promptAction } from '$lib/confirm';
  import { onMount, tick } from 'svelte';
  import DrawingPreview from '$lib/DrawingPreview.svelte';
  type Board = { id: string; title: string; created_at: string; updated_at: string; collection_id?: string | null; deleted_at?: string | null; is_favorite?: number };
  type Collection = { id: string; name: string };
  type CollectionShare = { token: string; permission: 'view' | 'edit'; expires_at: string | null; created_at: string };
  type ShareLink = { token: string; permission: 'view' | 'edit'; expires_at: string | null; created_at: string };
  let collections = $state<Collection[]>([]);
  let selectedCollection = $state('all');
  let view = $state<'all' | 'favorites' | 'trash'>('all');
  let search = $state('');
  let sort = $state('updated');
  let sortDirection = $state<'asc' | 'desc'>('desc');
  let selectedIds = $state<Set<string>>(new Set());
  let showBulkMoveMenu = $state(false);
  let importing = $state(false);
  let newCollectionName = $state('');
  let creatingCollection = $state(false);
  let collectionError = $state('');
  let mobileSidebarOpen = $state(false);
  let boards = $state<Board[]>([]);
  let title = $state('');
  let error = $state('');
  let loading = $state(true);
  let shareBoard = $state<Board | null>(null);
  let shares = $state<ShareLink[]>([]);
  let shareLoading = $state(false);
  let shareError = $state('');
  let permission = $state<'view' | 'edit'>('view');
  let expiresInDays = $state('never');
  let creatingShare = $state(false);
  let accountMenuOpen = $state(false);
  let shareCollection = $state<Collection | null>(null);
  let collectionShares = $state<CollectionShare[]>([]);
  let collectionShareLoading = $state(false);
  let collectionShareError = $state('');
  let collectionSharePermission = $state<'view' | 'edit'>('view');
  let collectionShareExpiry = $state('never');
  let collectionShareCreating = $state(false);

  async function load() {
    loading = true;
    try {
      const params = new URLSearchParams({ view, sort, direction: sortDirection });
      if (search.trim()) params.set('q', search.trim());
      if (selectedCollection !== 'all') params.set('collectionId', selectedCollection);
      const [drawingsResponse, collectionsResponse] = await Promise.all([
        fetch('/api/drawings?' + params.toString()), fetch('/api/collections')
      ]);
      if (!drawingsResponse.ok) throw new Error('Failed to load drawings');
      boards = await drawingsResponse.json() as Board[];
      selectedIds = new Set([...selectedIds].filter((id) => boards.some((board) => board.id === id)));
      if (collectionsResponse.ok) collections = await collectionsResponse.json() as Collection[];
    } catch (e) { error = e instanceof Error ? e.message : 'Failed to load drawings'; }
    finally { loading = false; }
  }
  function toggleSelected(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
  }

  function toggleSelectAll() {
    selectedIds = boards.length > 0 && boards.every((board) => selectedIds.has(board.id))
      ? new Set()
      : new Set(boards.map((board) => board.id));
  }

  async function renameDrawing(board: Board) {
    const nextTitle = (await promptAction('Choose a name for this drawing.', { title: 'Rename drawing', defaultValue: board.title, confirmLabel: 'Rename' }))?.trim();
    if (!nextTitle || nextTitle === board.title) return;
    const response = await fetch('/api/drawings/' + encodeURIComponent(board.id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: nextTitle }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { error = data.error || 'Could not rename drawing'; return; }
    await load();
  }

  async function duplicateDrawing(board: Board) {
    try {
      const sourceResponse = await fetch('/api/drawings/' + encodeURIComponent(board.id));
      if (!sourceResponse.ok) throw new Error('Could not read drawing to duplicate');
      const source = await sourceResponse.json() as { scene: unknown };
      const createResponse = await fetch('/api/drawings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Copy of ' + board.title, collectionId: board.collection_id ?? null }) });
      const created = await createResponse.json().catch(() => ({})) as { id?: string; error?: string };
      if (!createResponse.ok || !created.id) throw new Error(created.error || 'Could not create duplicate drawing');
      const saveResponse = await fetch('/api/drawings/' + encodeURIComponent(created.id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: source.scene }) });
      if (!saveResponse.ok) {
        await fetch('/api/drawings/' + encodeURIComponent(created.id), { method: 'DELETE' });
        throw new Error('Could not copy drawing contents');
      }
      await load();
    } catch (e) { error = e instanceof Error ? e.message : 'Could not duplicate drawing'; }
  }

  async function duplicateSelected() {
    const chosen = boards.filter((board) => selectedIds.has(board.id));
    if (!chosen.length || view === 'trash') return;
    for (const board of chosen) await duplicateDrawing(board);
    selectedIds = new Set();
    await load();
  }

  async function bulkDelete() {
    const chosen = boards.filter((board) => selectedIds.has(board.id));
    if (!chosen.length) return;
    const permanent = view === 'trash';
    if (!await confirmAction(permanent ? `Permanently delete ${chosen.length} drawing(s)? This cannot be undone.` : `Move ${chosen.length} drawing(s) to Trash?`, { title: permanent ? 'Delete drawings permanently' : 'Move drawings to Trash', confirmLabel: permanent ? 'Delete permanently' : 'Move to Trash', destructive: true })) return;
    const results = await Promise.all(chosen.map((board) => fetch('/api/drawings/' + encodeURIComponent(board.id), permanent
      ? { method: 'DELETE' }
      : { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deleted: true }) })));
    if (results.some((response) => !response.ok)) error = 'Some drawings could not be deleted';
    selectedIds = new Set();
    await load();
  }

  async function bulkMove(collectionId: string | null) {
    const chosen = boards.filter((board) => selectedIds.has(board.id));
    const results = await Promise.all(chosen.map((board) => fetch('/api/drawings/' + encodeURIComponent(board.id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ collectionId }) })));
    if (results.some((response) => !response.ok)) error = 'Some drawings could not be moved';
    selectedIds = new Set();
    showBulkMoveMenu = false;
    await load();
  }

  async function exportDrawing(board: Board) {
    try {
      const response = await fetch('/api/drawings/' + encodeURIComponent(board.id));
      if (!response.ok) throw new Error('Could not export drawing');
      const payload = await response.json() as { scene: { elements?: unknown[]; appState?: unknown; files?: unknown } };
      const file = new Blob([JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', ...(payload.scene ?? {}) }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = board.title.replace(/[\\/:*?"<>|]/g, '_') + '.excalidraw'; anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) { error = e instanceof Error ? e.message : 'Could not export drawing'; }
  }

  async function importDrawings(files: FileList | null) {
    if (!files?.length || view === 'trash') return;
    importing = true;
    error = '';
    try {
      for (const file of Array.from(files)) {
        const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
        const scene = parsed.scene && typeof parsed.scene === 'object' ? parsed.scene : parsed;
        if (!scene || typeof scene !== 'object' || !Array.isArray((scene as { elements?: unknown }).elements)) throw new Error(`Invalid drawing file: ${file.name}`);
        const targetCollection = selectedCollection !== 'all' && selectedCollection !== 'unorganized' ? selectedCollection : null;
        const createResponse = await fetch('/api/drawings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: file.name.replace(/\.(excalidraw|json|drawflare)$/i, ''), collectionId: targetCollection }) });
        const created = await createResponse.json().catch(() => ({})) as { id?: string; error?: string };
        if (!createResponse.ok || !created.id) throw new Error(created.error || `Could not import ${file.name}`);
        const saveResponse = await fetch('/api/drawings/' + encodeURIComponent(created.id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene }) });
        if (!saveResponse.ok) throw new Error(`Could not save imported drawing: ${file.name}`);
      }
      await load();
    } catch (e) { error = e instanceof Error ? e.message : 'Could not import drawings'; }
    finally { importing = false; }
  }
  async function startCreatingCollection() {
    creatingCollection = true;
    await tick();
    document.getElementById('new-collection')?.focus();
  }

  async function createCollection() {
    const name = newCollectionName.trim();
    if (!name) return;
    collectionError = '';
    const response = await fetch('/api/collections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await response.json().catch(() => ({})) as Collection & { error?: string };
    if (!response.ok) { collectionError = data.error || 'Could not create collection'; return; }
    collections = [...collections, data].sort((a, b) => a.name.localeCompare(b.name));
    selectedCollection = data.id;
    newCollectionName = '';
    creatingCollection = false;
    await load();
  }

  async function renameCollection(collection: Collection) {
    const name = (await promptAction('Choose a name for this collection.', { title: 'Rename collection', defaultValue: collection.name, confirmLabel: 'Rename' }))?.trim();
    if (!name || name === collection.name) return;
    const response = await fetch('/api/collections/' + encodeURIComponent(collection.id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { collectionError = data.error || 'Could not rename collection'; return; }
    await load();
  }

  async function deleteCollection(collection: Collection) {
    if (!await confirmAction('Delete collection "' + collection.name + '"? Drawings will move to Unorganized.', { title: 'Delete collection', confirmLabel: 'Delete collection', destructive: true })) return;
    const response = await fetch('/api/collections/' + encodeURIComponent(collection.id), { method: 'DELETE' });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { collectionError = data.error || 'Could not delete collection'; return; }
    if (selectedCollection === collection.id) selectedCollection = 'all';
    await load();
  }

  async function moveDrawing(board: Board, collectionId: string) {
    const response = await fetch('/api/drawings/' + encodeURIComponent(board.id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ collectionId: collectionId || null }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { error = data.error || 'Could not move drawing'; return; }
    await load();
  }

  async function changeView(nextView: 'all' | 'favorites' | 'trash', nextCollection = 'all') {
    view = nextView;
    selectedCollection = nextCollection;
    selectedIds = new Set();
    showBulkMoveMenu = false;
    mobileSidebarOpen = false;
    const url = new URL(location.href);
    if (nextView === 'all' && nextCollection === 'all') {
      url.searchParams.delete('view');
      url.searchParams.delete('collectionId');
    } else if (nextView === 'all' && nextCollection === 'unorganized') {
      url.searchParams.set('view', 'unorganized');
      url.searchParams.delete('collectionId');
    } else {
      url.searchParams.set('view', nextView);
      if (nextCollection !== 'all') url.searchParams.set('collectionId', nextCollection);
      else url.searchParams.delete('collectionId');
    }
    replaceState(url, {});
    await load();
  }

  async function create() {
    try {
      const body: { title: string; collectionId?: string } = { title: title.trim() || 'Untitled drawing' };
      if (selectedCollection !== 'all' && selectedCollection !== 'unorganized') body.collectionId = selectedCollection;
      const r = await fetch('/api/drawings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('Failed to create drawing');
      const data = await r.json() as { id: string };
      location.href = '/editor?id=' + encodeURIComponent(data.id) + '&new=1';
    } catch (e) { error = e instanceof Error ? e.message : 'Failed to create drawing'; }
  }

  async function remove(board: Board) {
    const inTrash = view === 'trash';
    if (!await confirmAction(inTrash ? 'Permanently delete "' + board.title + '"? This cannot be undone.' : 'Move "' + board.title + '" to trash?', { title: inTrash ? 'Delete drawing permanently' : 'Move drawing to Trash', confirmLabel: inTrash ? 'Delete permanently' : 'Move to Trash', destructive: true })) return;
    const r = await fetch('/api/drawings/' + encodeURIComponent(board.id), { method: inTrash ? 'DELETE' : 'PATCH', headers: { 'content-type': 'application/json' }, body: inTrash ? undefined : JSON.stringify({ deleted: true }) });
    if (r.ok) await load();
    else error = inTrash ? 'Failed to permanently delete drawing' : 'Failed to move drawing to trash';
  }

  async function restore(board: Board) {
    const r = await fetch('/api/drawings/' + encodeURIComponent(board.id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deleted: false }) });
    if (r.ok) await load(); else error = 'Failed to restore drawing';
  }

  async function toggleFavorite(board: Board) {
    const r = await fetch('/api/drawings/' + encodeURIComponent(board.id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isFavorite: !board.is_favorite }) });
    if (r.ok) await load(); else error = 'Failed to update favorite';
  }


  async function refreshShares() {
    if (!shareBoard) return;
    shareLoading = true;
    shareError = '';
    try {
      const r = await fetch('/api/drawings/' + encodeURIComponent(shareBoard.id) + '/shares');
      const data = await r.json() as ShareLink[] | { error?: string };
      if (!r.ok || !Array.isArray(data)) throw new Error((data as { error?: string }).error || 'Could not load share links');
      shares = data;
    } catch (e) { shareError = e instanceof Error ? e.message : 'Could not load share links'; }
    finally { shareLoading = false; }
  }

  async function openShareManager(board: Board) {
    shareBoard = board;
    shares = [];
    permission = 'view';
    expiresInDays = 'never';
    await refreshShares();
  }

  async function createShare() {
    if (!shareBoard || creatingShare) return;
    creatingShare = true;
    shareError = '';
    try {
      const body: { permission: 'view' | 'edit'; expiresInDays?: number } = { permission };
      if (expiresInDays !== 'never') body.expiresInDays = Number(expiresInDays);
      const r = await fetch('/api/drawings/' + encodeURIComponent(shareBoard.id) + '/shares', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json() as { token?: string; url?: string; error?: string };
      if (!r.ok || !data.url) throw new Error(data.error || 'Could not create share link');
      try { await navigator.clipboard.writeText(data.url); }
      catch { /* The URL remains visible in the list for manual copying. */ }
      await refreshShares();
      shareError = 'Link created. Copy it from the list below if it was not copied automatically.';
    } catch (e) { shareError = e instanceof Error ? e.message : 'Could not create share link'; }
    finally { creatingShare = false; }
  }

  async function revokeShare(share: ShareLink) {
    if (!shareBoard || !await confirmAction('Revoke this ' + share.permission + ' link? Anyone using it will lose access.', { title: 'Revoke share link', confirmLabel: 'Revoke link', destructive: true })) return;
    const r = await fetch('/api/drawings/' + encodeURIComponent(shareBoard.id) + '/shares', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: share.token }) });
    if (r.ok) shares = shares.filter((item) => item.token !== share.token);
    else shareError = 'Could not revoke share link';
  }

  async function copyShare(share: ShareLink) {
    const url = location.origin + '/share/' + share.token;
    try { await navigator.clipboard.writeText(url); shareError = 'Link copied to clipboard.'; }
    catch { await promptAction('Copy the link below if clipboard access is unavailable.', { title: 'Copy share link', defaultValue: url, confirmLabel: 'Done' }); }
  }

  async function refreshCollectionShares() {
    if (!shareCollection) return;
    collectionShareLoading = true; collectionShareError = '';
    try {
      const response = await fetch('/api/collections/' + encodeURIComponent(shareCollection.id) + '/shares');
      const data = await response.json() as CollectionShare[] | { error?: string };
      if (!response.ok || !Array.isArray(data)) throw new Error((data as { error?: string }).error || 'Could not load collection links');
      collectionShares = data;
    } catch (e) { collectionShareError = e instanceof Error ? e.message : 'Could not load collection links'; }
    finally { collectionShareLoading = false; }
  }

  async function openCollectionShare(collection: Collection) {
    shareCollection = collection; collectionShares = []; collectionSharePermission = 'view'; collectionShareExpiry = 'never';
    await refreshCollectionShares();
  }

  async function createCollectionShare() {
    if (!shareCollection || collectionShareCreating) return;
    collectionShareCreating = true; collectionShareError = '';
    try {
      const body: { permission: 'view' | 'edit'; expiresInDays?: number } = { permission: collectionSharePermission };
      if (collectionShareExpiry !== 'never') body.expiresInDays = Number(collectionShareExpiry);
      const response = await fetch('/api/collections/' + encodeURIComponent(shareCollection.id) + '/shares', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || 'Could not create collection share link');
      try { await navigator.clipboard.writeText(data.url); } catch { /* URL remains available in the list. */ }
      await refreshCollectionShares();
      collectionShareError = 'Link created. Copy it from the list below if it was not copied automatically.';
    } catch (e) { collectionShareError = e instanceof Error ? e.message : 'Could not create collection share link'; }
    finally { collectionShareCreating = false; }
  }

  async function revokeCollectionShare(share: CollectionShare) {
    if (!shareCollection || !await confirmAction('Revoke this collection link? Anyone using it will lose access.', { title: 'Revoke collection link', confirmLabel: 'Revoke link', destructive: true })) return;
    const response = await fetch('/api/collections/' + encodeURIComponent(shareCollection.id) + '/shares', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: share.token }) });
    if (response.ok) collectionShares = collectionShares.filter((item) => item.token !== share.token);
    else collectionShareError = 'Could not revoke collection link';
  }

  async function copyCollectionShare(share: CollectionShare) {
    const url = location.origin + '/collection-share/' + share.token;
    try { await navigator.clipboard.writeText(url); collectionShareError = 'Link copied to clipboard.'; }
    catch { await promptAction('Copy the link below if clipboard access is unavailable.', { title: 'Copy collection link', defaultValue: url, confirmLabel: 'Done' }); }
  }
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  function formatDate(value: string | null) {
    if (!value) return 'Never expires';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : 'Expires ' + parsed.toLocaleString();
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const requestedView = params.get('view');
    if (requestedView === 'favorites') view = 'favorites';
    else if (requestedView === 'trash') view = 'trash';
    else if (requestedView === 'unorganized') selectedCollection = 'unorganized';
    else if (params.get('collectionId')) selectedCollection = params.get('collectionId') || 'all';
    void load();
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('.search-input')?.focus(); }
      if (event.key === 'Escape') {
        accountMenuOpen = false;
        document.querySelectorAll<HTMLDetailsElement>('.board-menu[open], .collection-menu[open]').forEach((menu) => { menu.open = false; });
        showBulkMoveMenu = false;
      }
    };
    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      document.querySelectorAll<HTMLDetailsElement>('.board-menu[open], .collection-menu[open]').forEach((menu) => {
        if (!menu.contains(target)) menu.open = false;
      });
      if (target instanceof Element && !target.closest('.bulk-move-wrap')) showBulkMoveMenu = false;
    };
    window.addEventListener('keydown', handleShortcut);
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      document.removeEventListener('pointerdown', handleOutsideClick);
    };
  });
</script>
<svelte:head><title>Dashboard · DrawFlare</title></svelte:head>
<main class="library-page">
  <header class="mobile-header">
    <button class="mobile-menu-toggle" aria-label={mobileSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileSidebarOpen} onclick={() => mobileSidebarOpen = !mobileSidebarOpen}>{#if mobileSidebarOpen}✕{:else}☰{/if}</button>
    <a href="/" class="mobile-brand"><span class="brand-mark"><img src="/drawflare-logo.svg" alt="" /></span><span>DrawFlare</span></a>
  </header>
  {#if mobileSidebarOpen}<button class="mobile-sidebar-backdrop" aria-label="Close navigation menu" onclick={() => mobileSidebarOpen = false}></button>{/if}
  <aside class="sidebar" class:mobile-open={mobileSidebarOpen}>
    <a href="/" class="sidebar-brand" aria-label="DrawFlare home"><span class="brand-mark"><img src="/drawflare-logo.svg" alt="" /></span><span class="brand-name">DrawFlare</span></a>
    <div class="sidebar-scroll">
    <div class="sidebar-section-label">LIBRARY</div>
    <button class:active={view === 'all' && selectedCollection === 'all'} class="nav-item" onclick={() => void changeView('all')}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> <span>All drawings</span></button>
    <button class:active={view === 'favorites'} class="nav-item" onclick={() => void changeView('favorites')}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3z"/></svg> <span>Favorites</span></button>
    <button class:active={view === 'all' && selectedCollection === 'unorganized'} class="nav-item" onclick={() => void changeView('all', 'unorganized')}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v13H3zM3 7l2-4h14l2 4M9 11h6"/></svg> <span>Unorganized</span></button>
    <div class="sidebar-section-label collection-label"><span>COLLECTIONS</span><button aria-label="Create collection" title="Create collection" onclick={() => void startCreatingCollection()}>＋</button></div>
    {#if creatingCollection}<form class="collection-create" onsubmit={(event) => { event.preventDefault(); void createCollection(); }}><input id="new-collection" bind:value={newCollectionName} maxlength="80" placeholder="Collection name" aria-label="New collection name" onkeydown={(event) => { if (event.key === 'Escape') { creatingCollection = false; newCollectionName = ''; } }} onblur={() => { if (!newCollectionName.trim()) creatingCollection = false; }} /></form>{/if}
    {#if collectionError}<p class="collection-error" role="alert">{collectionError}</p>{/if}
    {#each collections as collection (collection.id)}
      <div class="collection-row" class:active={view === 'all' && selectedCollection === collection.id}><button class="nav-item collection-item" onclick={() => void changeView('all', collection.id)}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> <span>{collection.name}</span></button><details class="collection-menu"><summary aria-label={'Actions for ' + collection.name}>⋯</summary><div><button onclick={() => void openCollectionShare(collection)}>Share collection</button><button onclick={() => void renameCollection(collection)}>Rename</button><button onclick={() => void deleteCollection(collection)}>Delete</button></div></details></div>
    {/each}
    </div>
    <div class="sidebar-bottom">
      <div class="account-menu-wrap">
        {#if accountMenuOpen}<button class="menu-backdrop" aria-label="Close account menu" onclick={() => accountMenuOpen = false}></button><div class="account-menu"><button onclick={() => { accountMenuOpen = false; location.href = '/?view=trash'; }}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-11 0 1 14h12l1-14M10 10v6m4-6v6"/></svg> <span>Trash</span></button><button onclick={() => { accountMenuOpen = false; location.href = '/profile'; }}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg> <span>Profile</span></button><button onclick={() => { accountMenuOpen = false; location.href = '/settings'; }}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1 0 2z"/></svg> <span>Settings</span></button><button onclick={() => { accountMenuOpen = false; location.href = '/admin'; }}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/></svg> <span>Administration</span></button><button class="logout-item" onclick={() => void logout()}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></svg> <span>Sign out</span></button></div>{/if}
        <button class="account-trigger" aria-expanded={accountMenuOpen} onclick={() => accountMenuOpen = !accountMenuOpen}><span class="account-avatar">E</span><span class="account-copy"><strong>Workspace</strong><small>Shared-password mode</small></span><span class="account-chevron">⌃</span></button>
      </div>
    </div>
  </aside>

  <section class="library-content">
    <div class="page-heading">
      <div>
        <h1>{view === 'trash' ? 'Trash' : view === 'favorites' ? 'Favorites' : selectedCollection === 'unorganized' ? 'Unorganized' : collections.find((item) => item.id === selectedCollection)?.name || 'All drawings'}</h1>
      </div>
    </div>

    <div class="dashboard-toolbar">
      <div class="search-wrap"><span aria-hidden="true">⌕</span><input class="search-input" bind:value={search} oninput={() => void load()} placeholder="Search drawings..." aria-label="Search drawings" /><kbd>⌘ K</kbd></div>
      <div class="toolbar-controls">
        <select bind:value={sort} onchange={() => { sortDirection = sort === 'name' ? 'asc' : 'desc'; void load(); }} aria-label="Sort drawings"><option value="updated">Date modified</option><option value="created">Date created</option><option value="name">Name</option></select>
        <button class="button icon-button" title={sortDirection === 'asc' ? 'Sort descending' : 'Sort ascending'} aria-label={sortDirection === 'asc' ? 'Sort descending' : 'Sort ascending'} onclick={() => { sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'; void load(); }}>{sortDirection === 'asc' ? '↑' : '↓'}</button>
        <button class="button icon-button" title={boards.length > 0 && boards.every((board) => selectedIds.has(board.id)) ? 'Deselect all' : 'Select all'} aria-label="Select all drawings" disabled={boards.length === 0} onclick={toggleSelectAll}>{boards.length > 0 && boards.every((board) => selectedIds.has(board.id)) ? '☑' : '□'}</button>
        <button class="button icon-button danger-icon" title={view === 'trash' ? 'Delete permanently' : 'Move selected to trash'} aria-label={view === 'trash' ? 'Delete selected permanently' : 'Move selected to trash'} disabled={selectedIds.size === 0} onclick={() => void bulkDelete()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2m-9 0 1 14h10l1-14M10 10v6m4-6v6"/></svg></button>
        <button class="button icon-button" title="Duplicate selected" aria-label="Duplicate selected" disabled={selectedIds.size === 0 || view === 'trash'} onclick={() => void duplicateSelected()}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
        <div class="bulk-move-wrap">
          <button class="button icon-button" title="Move selected" aria-label="Move selected" disabled={selectedIds.size === 0 || view === 'trash'} onclick={() => showBulkMoveMenu = !showBulkMoveMenu}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3zM12 12h7m-3-3 3 3-3 3"/></svg></button>
          {#if showBulkMoveMenu}<div class="bulk-move-menu"><strong>Move {selectedIds.size} drawings to</strong><button onclick={() => void bulkMove(null)}>Unorganized</button>{#each collections.filter((item) => item.id !== 'trash') as collection (collection.id)}<button onclick={() => void bulkMove(collection.id)}>{collection.name}</button>{/each}</div><button class="bulk-menu-backdrop" aria-label="Close move menu" onclick={() => showBulkMoveMenu = false}></button>{/if}
        </div>
        <input class="import-input" id="drawing-import" type="file" accept=".excalidraw,.json,.drawflare" multiple onchange={(event) => { void importDrawings((event.currentTarget as HTMLInputElement).files); (event.currentTarget as HTMLInputElement).value = ''; }} />
        <button class="button button-secondary import-button" disabled={view === 'trash' || importing} onclick={() => document.getElementById('drawing-import')?.click()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/></svg>{importing ? 'Importing…' : 'Import drawings'}</button>
        <button class="button button-primary new-drawing" disabled={view === 'trash'} onclick={() => void create()}><span aria-hidden="true">＋</span> New Drawing</button>
      </div>
    </div>

    {#if error}<p class="error-banner" role="alert">{error}</p>{/if}

    {#if loading}
      <div class="state-panel" role="status"><span class="state-icon" aria-hidden="true">◌</span><p>Loading drawings…</p></div>
    {:else if boards.length === 0}
      <div class="state-panel empty-state">
        <span class="state-icon" aria-hidden="true">▱</span>
        <h3>No drawings yet</h3>
        <p>Create your first drawing to get started.</p>
      </div>
    {:else}
      <div class="list">
        {#each boards as board (board.id)}
          <article class:board-selected={selectedIds.has(board.id)} class="board-row">
            <label class="board-select" title="Select drawing"><input type="checkbox" checked={selectedIds.has(board.id)} onchange={() => toggleSelected(board.id)} aria-label={'Select ' + board.title} /></label>
            <a class="board-link" href={'/editor?id=' + encodeURIComponent(board.id)}>
              <span class="board-icon"><DrawingPreview id={board.id} title={board.title} /></span>
              <span class="board-info"><strong>{board.title}</strong><small>Updated {new Date(board.updated_at).toLocaleString()}</small></span>
              <span class="open-indicator" aria-hidden="true">↗</span>
            </a>
            <div class="board-actions">
              <details class="board-menu">
                <summary aria-label={'Actions for ' + board.title} title="Drawing actions">⋯</summary>
                <div class="board-menu-panel">
                  {#if view !== 'trash'}
                    <button onclick={() => void renameDrawing(board)}>✎ Rename</button>
                    <button onclick={() => void duplicateDrawing(board)}>▢ Duplicate / Copy</button>
                    <button onclick={() => void exportDrawing(board)}>↓ Export drawing</button>
                    <button onclick={() => void toggleFavorite(board)}>{board.is_favorite ? '★ Remove favorite' : '☆ Add to favorites'}</button>
                    <label for={'move-' + board.id}>Move to collection</label>
                    <select id={'move-' + board.id} class="move-select" aria-label={'Move ' + board.title + ' to collection'} value={board.collection_id ?? ''} onchange={(event) => void moveDrawing(board, (event.currentTarget as HTMLSelectElement).value)}><option value="">Unorganized</option>{#each collections as collection (collection.id)}<option value={collection.id}>{collection.name}</option>{/each}</select>
                    <button onclick={() => void openShareManager(board)}>↗ Share</button>
                  {:else}
                    <button onclick={() => void restore(board)}>↶ Restore drawing</button>
                    <button onclick={() => void exportDrawing(board)}>↓ Export drawing</button>
                  {/if}
                  <button class="danger-action" onclick={() => void remove(board)}>{view === 'trash' ? '♲ Delete forever' : '♲ Move to trash'}</button>
                </div>
              </details>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if shareBoard}
    <div class="overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) shareBoard = null; }}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div class="dialog-heading">
          <div><h2 id="share-title">Share drawing</h2><p>{shareBoard.title}</p></div>
          <button class="button button-secondary close" aria-label="Close" onclick={() => shareBoard = null}>×</button>
        </div>
        <div class="share-form">
          <label for="permission">Access</label>
          <select id="permission" bind:value={permission}><option value="view">Can view</option><option value="edit">Can edit</option></select>
          <label for="expiry">Expiration</label>
          <select id="expiry" bind:value={expiresInDays}><option value="never">Never</option><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select>
          <button class="button button-primary" onclick={() => void createShare()} disabled={creatingShare}>{creatingShare ? 'Creating…' : 'Create share link'}</button>
        </div>
        {#if shareError}<p class="share-message" role="status">{shareError}</p>{/if}
        <h3>Active links</h3>
        {#if shareLoading}<p class="muted-message">Loading links…</p>
        {:else if shares.length === 0}<p class="muted-message">No active links. Create one above.</p>
        {:else}
          <div class="share-list">
            {#each shares as share (share.token)}
              <div class="share-item">
                <div class="share-meta"><strong>{share.permission === 'edit' ? 'Can edit' : 'Can view'}</strong><small>{formatDate(share.expires_at)}</small><input readonly value={location.origin + '/share/' + share.token} aria-label="Share URL" onclick={(event) => (event.currentTarget as HTMLInputElement).select()} /></div>
                <div class="share-actions"><button class="button button-secondary" onclick={() => void copyShare(share)}>Copy</button><button class="button button-danger" onclick={() => void revokeShare(share)}>Revoke</button></div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
  {#if shareCollection}
    <div class="overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) shareCollection = null; }}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="share-collection-title">
        <div class="dialog-heading"><div><h2 id="share-collection-title">Share collection</h2><p>{shareCollection.name}</p></div><button class="button button-secondary close" aria-label="Close" onclick={() => shareCollection = null}>×</button></div>
        <div class="share-form"><label for="collection-share-permission">Access</label><select id="collection-share-permission" bind:value={collectionSharePermission}><option value="view">Can view</option><option value="edit">Can edit</option></select><label for="collection-share-expiry">Expiration</label><select id="collection-share-expiry" bind:value={collectionShareExpiry}><option value="never">Never</option><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select><button class="button button-primary" onclick={() => void createCollectionShare()} disabled={collectionShareCreating}>{collectionShareCreating ? 'Creating…' : 'Create collection link'}</button></div>
        {#if collectionShareError}<p class="share-message" role="status">{collectionShareError}</p>{/if}
        <h3>Active links</h3>
        {#if collectionShareLoading}<p class="muted-message">Loading links…</p>{:else if collectionShares.length === 0}<p class="muted-message">No active links. Create one above.</p>{:else}<div class="share-list">{#each collectionShares as share (share.token)}<div class="share-item"><div class="share-meta"><strong>{share.permission === 'edit' ? 'Can edit' : 'Can view'}</strong><small>{formatDate(share.expires_at)}</small><input readonly value={location.origin + '/collection-share/' + share.token} aria-label="Collection share URL" onclick={(event) => (event.currentTarget as HTMLInputElement).select()} /></div><div class="share-actions"><button class="button button-secondary" onclick={() => void copyCollectionShare(share)}>Copy</button><button class="button button-danger" onclick={() => void revokeCollectionShare(share)}>Revoke</button></div></div>{/each}</div>{/if}
      </div>
    </div>
  {/if}
</main>
<style>
  .library-page { --ink: #1e293b; --muted: #64748b; --accent: #4f46e5; min-height: 100dvh; display: grid; grid-template-columns: 260px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 14px; padding: 14px; color: var(--ink); background-color: #f3f4f6; background-image: radial-gradient(#cbd5e1 1px, transparent 1px); background-size: 24px 24px; }
  .sidebar { position: sticky; top: 14px; display: flex; flex-direction: column; min-width: 0; height: calc(100dvh - 28px); padding: 16px 10px 10px; border: 2px solid var(--ink); border-radius: 16px; background: #fff; box-shadow: 1.5px 1.5px 0 rgb(30 41 59 / 0.9); overflow: hidden; }
  .sidebar-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
  .sidebar-brand { display: flex; align-items: center; gap: 10px; margin: 0 6px 26px; padding: 4px 5px; color: var(--ink); text-decoration: none; }
  .brand-mark { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border: 2px solid var(--ink); border-radius: 12px; background: #eef2ff; box-shadow: 1.5px 1.5px 0 var(--ink); }
  .brand-mark img { width: 34px; height: 34px; object-fit: contain; }
  .brand-name { font: 400 23px 'Excalifont', sans-serif; letter-spacing: -.025em; white-space: nowrap; }
  .beta { align-self: flex-start; margin: 4px 0 0 auto; color: #ef4444; font-size: 10px; font-weight: 800; }
  .sidebar-bottom { margin-top: auto; padding-top: 12px; border-top: 1px solid #e2e8f0; }
  .account-menu-wrap { position: relative; }
  .account-trigger { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 8px; border: 0; border-radius: 11px; background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
  .account-trigger:hover { background: #f1f5f9; }
  .account-avatar { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; border: 2px solid var(--ink); border-radius: 12px; background: #fcd34d; box-shadow: 1.5px 1.5px 0 var(--ink); font: 400 21px 'Excalifont', sans-serif; }
  .account-copy { display: grid; flex: 1; min-width: 0; gap: 2px; }
  .account-copy strong { font-size: 12px; font-weight: 800; }
  .account-copy small { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .account-chevron { color: var(--muted); transform: rotate(180deg); }
  .menu-backdrop { position: fixed; inset: 0; z-index: 25; border: 0; background: transparent; }
  .account-menu { position: absolute; z-index: 26; right: 0; bottom: calc(100% + 8px); left: 0; padding: 5px; border: 2px solid var(--ink); border-radius: 12px; background: #fff; box-shadow: 2px 2px 0 var(--ink); }
  .account-menu button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: #475569; text-align: left; font: 650 12px system-ui; cursor: pointer; }
  .account-menu button:hover { background: #eef2ff; color: #3730a3; }
  .account-menu .logout-item { margin-top: 4px; border-top: 1px solid #e2e8f0; border-radius: 0 0 7px 7px; color: #be123c; }
  .dashboard-toolbar { display: flex; align-items: center; gap: 10px; margin: 0 0 28px; }
  .search-wrap { position: relative; display: flex; flex: 1 1 220px; align-items: center; min-width: 160px; }
  .search-wrap > span { position: absolute; left: 12px; top: 3px; color: #94a3b8; font-size: 25px; }
  .search-wrap .search-input { width: 100%; padding-left: 39px; padding-right: 46px; min-height: 42px; border: 2px solid #1e293b; box-shadow: 2px 2px 0 #1e293b; }
  .search-wrap kbd { position: absolute; right: 9px; padding: 2px 5px; border: 1px solid #cbd5e1; border-radius: 5px; background: #f1f5f9; color: #64748b; font-size: 10px; }
  .new-drawing { min-height: 42px; padding: 8px 20px; white-space: nowrap; border-radius: 12px; box-shadow: 2px 2px 0 var(--ink); }
  .new-drawing:hover:not(:disabled) { box-shadow: 4px 4px 0 var(--ink); }
  .sidebar-section-label { display: flex; align-items: center; justify-content: space-between; margin: 2px 10px 9px; color: #94a3b8; font-size: 10px; font-weight: 850; letter-spacing: .1em; }
  .collection-label { margin-top: 24px; }
  .collection-label button { border: 0; background: transparent; color: var(--ink); font-size: 17px; cursor: pointer; }
  .nav-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 38px; margin: 2px 0; padding: 8px 10px; border: 2px solid transparent; border-radius: 10px; background: transparent; color: #475569; text-align: left; text-decoration: none; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
  .nav-icon { width: 18px; height: 18px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .nav-item span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav-item:hover { border-color: #1e293b; background: #f8fafc; }
  .nav-item.active { border-color: var(--ink); background: #eef2ff; color: #3730a3; box-shadow: 1.5px 1.5px 0 var(--ink); }
  .collection-create { margin: 0 5px 8px; }
  .collection-create input { width: 100%; padding: 8px 9px; font-size: 12px; border-width: 1px; border-radius: 8px; }
  .collection-error { margin: 4px 8px; color: #be123c; font-size: 11px; }
  .collection-item { flex: 1; min-width: 0; margin: 0; padding-left: 14px; border-color: transparent; }
  .collection-row { display: flex; align-items: center; gap: 2px; margin: 2px 0; padding: 0 3px 0 0; border: 2px solid transparent; border-radius: 10px; transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease; }
  .collection-row:hover, .collection-row:focus-within { border-color: #1e293b; background: #f8fafc; }
  .collection-row.active { border-color: var(--ink); background: #eef2ff; box-shadow: 1.5px 1.5px 0 var(--ink); }
  .collection-row .nav-item:hover, .collection-row.active .nav-item, .collection-row.active .nav-item:hover { border-color: transparent; background: transparent; color: #3730a3; box-shadow: none; }
  .collection-menu { position: relative; flex: 0 0 auto; opacity: 0; transition: opacity 140ms ease; }
  .collection-row:hover .collection-menu, .collection-row:focus-within .collection-menu, .collection-menu[open] { opacity: 1; }
  .collection-menu summary { display: grid; place-items: center; width: 25px; height: 30px; border-radius: 7px; color: #64748b; font-size: 17px; cursor: pointer; list-style: none; }
  .collection-menu summary::-webkit-details-marker { display: none; }
  .collection-menu[open] summary, .collection-menu summary:hover { background: #e0e7ff; color: #3730a3; }
  .collection-menu > div { position: absolute; z-index: 20; top: 28px; right: 0; display: grid; min-width: 150px; padding: 4px; border: 1px solid #1e293b; border-radius: 12px; background: #fff; box-shadow: 1.5px 1.5px 0 rgb(30 41 59 / 0.9); }
  .collection-menu button { padding: 8px; border: 0; border-radius: 5px; background: transparent; color: #334155; text-align: left; font: 650 12px system-ui; cursor: pointer; }
  .collection-menu button:hover { background: #eef2ff; }
  @media (hover: none) { .collection-menu { opacity: 1; } }
  .sidebar-bottom { margin-top: auto; padding-top: 18px; border-top: 1px solid #e2e8f0; }
  .library-content { width: min(100%, 1280px); min-width: 0; margin: 0 auto; padding: 38px 28px 64px; }
  .page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
  h1 { margin: 0 0 7px; font-family: 'Excalifont', sans-serif; font-size: 36px; line-height: 1.2; font-weight: 400; letter-spacing: -.025em; color: #0f172a; }
  p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
  input, select { min-width: 0; padding: 9px 11px; border: 2px solid #e2e8f0; border-radius: 12px; background: #fff; color: var(--ink); font: inherit; font-size: 13px; outline: none; }
  input:focus-visible, select:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px rgb(99 102 241 / 0.2); }
  input::placeholder { color: #94a3b8; }
  .button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 7px; min-height: 38px; padding: 7px 12px; border: 2px solid var(--ink); border-radius: 12px; background: #fff; color: var(--ink); font: inherit; font-size: 13px; font-weight: 700; line-height: 1.2; box-shadow: 1.5px 1.5px 0 rgb(30 41 59 / 0.9); cursor: pointer; transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease; }
  .button:hover:not(:disabled) { transform: translateY(-1px); }
  .button:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
  .button:focus-visible { outline: 3px solid rgb(99 102 241 / 0.35); outline-offset: 2px; }
  .button:disabled { opacity: .5; cursor: wait; box-shadow: none; }
  .button-primary { border-color: var(--ink); background: var(--accent); color: #fff; }
  .button-primary:hover:not(:disabled) { background: #6366f1; }
  .button-secondary { border-color: var(--ink); background: #fff; color: var(--ink); }
  .button-secondary:hover:not(:disabled) { background: #eef2ff; }
  .button-danger { border-color: var(--ink); background: #fff; color: #be123c; }
  .button-danger:hover:not(:disabled) { background: #fff1f2; }
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(245px, 1fr)); align-items: stretch; gap: 18px; }
  .board-row { position: relative; display: flex; flex-direction: column; min-width: 0; overflow: visible; padding: 0; border: 2px solid var(--ink); border-radius: 16px; background: #fff; box-shadow: 2px 2px 0 rgb(30 41 59 / 0.9); transition: transform 160ms ease, box-shadow 160ms ease; }
  .board-row:hover { transform: translate(-1px, -2px); box-shadow: 4px 4px 0 rgb(30 41 59 / 0.9); }
  .board-link { display: flex; flex: 1; flex-direction: column; align-items: stretch; gap: 0; min-width: 0; overflow: hidden; border-radius: 14px; color: inherit; text-decoration: none; }
  .board-link:focus-visible { outline: 3px solid #6366f1; outline-offset: -5px; border-radius: 12px; }
  .board-icon { display: grid; flex: 0 0 auto; place-items: center; width: 100%; height: 146px; border: 0; border-bottom: 2px solid var(--ink); border-radius: 0; background-color: #f8fafc; background-image: linear-gradient(to right, rgb(148 163 184 / 0.16) 1px, transparent 1px), linear-gradient(to bottom, rgb(148 163 184 / 0.16) 1px, transparent 1px); background-size: 22px 22px; color: #6366f1; }
  .board-info { display: grid; flex: 1; min-width: 0; gap: 6px; padding: 14px 15px 17px; }
  .board-info strong { overflow: hidden; color: #1e293b; font-size: 15px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
  .board-info small { color: var(--muted); font-size: 11px; font-weight: 600; }
  .open-indicator { display: none; }
  .board-actions { position: absolute; z-index: 5; top: 8px; right: 8px; opacity: 0; transition: opacity 140ms ease; }
  .board-row:hover .board-actions, .board-row:focus-within .board-actions, .board-menu[open] { opacity: 1; }
  .board-menu { position: relative; }
  .board-menu summary { display: grid; place-items: center; width: 32px; height: 32px; border: 2px solid var(--ink); border-radius: 10px; background: #fff; color: #334155; box-shadow: 2px 2px 0 var(--ink); font-size: 20px; font-weight: 800; line-height: 1; list-style: none; cursor: pointer; }
  .board-menu summary::-webkit-details-marker { display: none; }
  .board-menu[open] summary, .board-menu summary:hover { background: #eef2ff; color: #3730a3; }
  .board-menu-panel { position: absolute; top: 38px; right: 0; display: grid; gap: 3px; width: 190px; padding: 4px; border: 1px solid #1e293b; border-radius: 12px; background: #fff; box-shadow: 1.5px 1.5px 0 rgb(30 41 59 / 0.9); }
  .board-menu-panel button { width: 100%; padding: 8px 9px; border: 0; border-radius: 7px; background: transparent; color: #475569; text-align: left; font: 650 12px system-ui; cursor: pointer; }
  .board-menu-panel button:hover { background: #eef2ff; color: #3730a3; }
  .board-menu-panel label { margin: 3px 5px 0; color: #94a3b8; font-size: 10px; font-weight: 800; }
  .board-menu-panel .move-select { width: 100%; min-height: 32px; padding: 6px 7px; border-width: 1px; border-radius: 8px; font-size: 11px; }
  .board-menu-panel .danger-action { margin-top: 4px; border-top: 1px solid #e2e8f0; border-radius: 0 0 7px 7px; color: #be123c; }
  .board-menu-panel .danger-action:hover { background: #fff1f2; color: #9f1239; }
  .state-panel { display: grid; justify-items: center; gap: 10px; padding: 44px 20px; border: 2px dashed #94a3b8; border-radius: 16px; background: rgb(255 255 255 / 0.75); text-align: center; }
  .state-panel p { font-size: 13px; }
  .state-icon { display: grid; place-items: center; width: 48px; height: 48px; border: 2px solid var(--ink); border-radius: 14px; background: #eef2ff; color: var(--accent); font-size: 26px; box-shadow: 2px 2px 0 rgb(30 41 59 / 0.9); }
  .empty-state h3 { margin: 2px 0 0; font-size: 15px; font-weight: 800; color: var(--ink); }
  .error-banner { margin: 0 0 18px; padding: 10px 12px; border: 2px solid #be123c; border-radius: 12px; background: #fff1f2; color: #9f1239; font-size: 13px; font-weight: 600; box-shadow: 2px 2px 0 rgb(30 41 59 / 0.25); }
  .overlay { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / 0.48); overflow-y: auto; }
  .dialog { box-sizing: border-box; width: min(100%, 560px); max-height: min(85dvh, 800px); overflow-y: auto; margin: auto; padding: 22px; border: 2px solid var(--ink); border-radius: 18px; background: #fff; box-shadow: 5px 5px 0 rgb(30 41 59 / 0.9); }
  .dialog-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .dialog h2 { margin: 0 0 5px; font-family: 'Excalifont', sans-serif; font-size: 25px; font-weight: 400; letter-spacing: -.025em; }
  .dialog-heading p { margin: 0 0 20px; overflow-wrap: anywhere; }
  .dialog h3 { margin: 22px 0 12px; font-size: 13px; font-weight: 800; }
  .close { width: 34px; min-height: 34px; padding: 0; font-size: 21px; }
  .share-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; padding: 14px; border: 2px solid #e2e8f0; border-radius: 14px; background: #f8fafc; }
  .share-form label { align-self: end; color: #475569; font-size: 12px; font-weight: 800; }
  .share-form button { grid-column: 1 / -1; margin-top: 4px; }
  .share-list { display: grid; gap: 10px; }
  .share-item { display: flex; align-items: center; gap: 12px; padding: 11px; border: 2px solid #e2e8f0; border-radius: 12px; background: #fff; }
  .share-meta { display: grid; flex: 1; min-width: 0; gap: 5px; }
  .share-meta strong { color: #1e293b; font-size: 12px; font-weight: 800; }
  .share-meta small { color: var(--muted); font-size: 11px; }
  .share-meta input { width: 100%; box-sizing: border-box; padding: 7px 8px; background: #f8fafc; font-size: 11px; }
  .share-actions { display: flex; gap: 6px; }
  .share-actions .button { min-height: 32px; padding: 5px 9px; font-size: 12px; }
  .share-message { margin: 12px 0; color: #475569; font-size: 12px; }
  .muted-message { margin: 12px 0; color: var(--muted); font-size: 13px; }
  .toolbar-controls{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;min-width:0}
  .toolbar-controls>select{min-height:42px;max-width:170px;border-color:#1e293b;box-shadow:2px 2px 0 #1e293b}
  .toolbar-controls .button{min-height:42px}
  .icon-button{width:42px;height:42px;min-width:42px;padding:7px;color:#4f46e5;font-size:20px}
  .icon-button svg,.import-button svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .icon-button.danger-icon{color:#be123c}
  .icon-button:disabled{color:#94a3b8}
  .import-button{white-space:nowrap;color:#4338ca}
  .import-input{display:none}
  .bulk-move-wrap{position:relative}
  .bulk-move-menu{position:absolute;z-index:31;top:48px;right:0;display:grid;gap:3px;width:220px;max-height:280px;overflow:auto;padding:4px;border:1px solid #1e293b;border-radius:12px;background:#fff;box-shadow:1.5px 1.5px 0 rgb(30 41 59 / .9)}
  .bulk-move-menu strong{padding:7px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
  .bulk-move-menu button{padding:8px 9px;border:0;border-radius:7px;background:transparent;color:#334155;text-align:left;font-size:12px;font-weight:650;cursor:pointer}
  .bulk-move-menu button:hover{background:#eef2ff}
  .bulk-menu-backdrop{position:fixed;inset:0;z-index:30;border:0;background:transparent}
  .board-selected{outline:3px solid #6366f1;outline-offset:1px}
  .board-select{position:absolute;z-index:6;top:10px;left:10px;display:grid;place-items:center;width:30px;height:30px;border:2px solid #1e293b;border-radius:9px;background:#fff;box-shadow:2px 2px 0 #1e293b;opacity:0;cursor:pointer}
  .board-row:hover .board-select,.board-row:focus-within .board-select,.board-selected .board-select{opacity:1}
  .board-select input{width:16px;height:16px;margin:0;padding:0;border:0;accent-color:#4f46e5;box-shadow:none;cursor:pointer}
  .board-menu-panel{max-height:min(70vh,430px);overflow-y:auto}
  .dashboard-toolbar{align-items:flex-start;flex-wrap:wrap}
  .search-wrap{flex:1 1 250px}
  @media (hover:none){.board-select{opacity:1}}
  @media (max-width: 900px){.toolbar-controls{justify-content:flex-start;width:100%}.dashboard-toolbar{align-items:stretch}.search-wrap{flex-basis:100%}}
  .mobile-header { display: none; }
  .mobile-sidebar-backdrop { display: none; }
  .mobile-menu-toggle { display: grid; place-items: center; width: 40px; height: 40px; border: 2px solid var(--ink); border-radius: 11px; background: #fff; color: var(--ink); font-size: 20px; box-shadow: 2px 2px 0 var(--ink); }
  .mobile-brand { display: flex; align-items: center; gap: 9px; color: var(--ink); font: 400 21px 'Excalifont', sans-serif; text-decoration: none; }
  @media (max-width: 600px) {
    .library-page { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 8px; padding: 8px; }
    .mobile-header { display: flex; grid-column: 1; align-items: center; justify-content: space-between; min-width: 0; padding: 4px 5px; }
    .mobile-menu-toggle { flex: 0 0 auto; cursor: pointer; }
    .mobile-brand { gap: 8px; }
    .mobile-brand .brand-mark { width: 32px; height: 32px; }
    .mobile-brand .brand-mark img { width: 28px; height: 28px; }
    .mobile-sidebar-backdrop { display: block; position: fixed; z-index: 39; inset: 0; width: 100%; height: 100%; border: 0; background: rgb(15 23 42 / .42); backdrop-filter: blur(2px); }
    .sidebar { position: fixed; z-index: 40; top: 12px; bottom: 12px; left: 12px; display: flex; flex-direction: column; align-items: stretch; gap: 0; width: min(290px, calc(100vw - 48px)); height: auto; padding: 16px 10px 10px; border: 2px solid var(--ink); border-radius: 16px; background: #fff; overflow: hidden; transform: translateX(calc(-100% - 20px)); transition: transform 180ms ease; box-shadow: 3px 3px 0 rgb(30 41 59 / .35); }
    .sidebar.mobile-open { transform: translateX(0); }
    .sidebar-brand { flex: 0 0 auto; margin: 0 6px 26px; }
    .sidebar-scroll { display: block; flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; }
    .brand-name { font-size: 23px; }
    .brand-mark { width: 38px; height: 38px; }
    .brand-mark img { width: 34px; height: 34px; }
    .beta { display: inline; }
    .sidebar-section-label { display: flex; }
    .collection-label { margin-top: 24px; }
    .collection-create { display: block; margin: 0 5px 8px; }
    .collection-error { display: block; }
    .collection-create input { min-height: 38px; }
    .collection-row { display: flex; flex: initial; }
    .collection-menu { display: block; }
    .nav-item { flex: initial; width: 100%; min-height: 38px; margin: 2px 0; padding: 8px 10px; white-space: normal; }
    .nav-item span { flex: 1; max-width: none; }
    .sidebar-bottom { display: block; flex: 0 0 auto; margin: auto 0 0; padding: 12px 0 0; border-top: 1px solid #e2e8f0; }
    .account-copy { display: grid; }
    .account-trigger { width: 100%; padding: 9px 8px; }
    .account-menu { right: 0; left: 0; width: auto; }
    .library-content { grid-column: 1; padding: 16px 8px 40px; }
    .dashboard-toolbar { margin: 0 0 24px; flex-wrap: wrap; }
    h1 { font-size: 30px; }
    .new-drawing { flex: 1 1 100%; width: 100%; }
    .list { grid-template-columns: 1fr; gap: 14px; }
    .board-icon { height: 132px; }
    .board-actions { opacity: 1; }
    .dialog { padding: 16px; }
    .share-item { align-items: stretch; flex-direction: column; }
    .share-actions .button { flex: 1; }
    .share-form { gap: 8px; padding: 11px; }
  }
  :global(html[data-theme="dark"]) .collection-menu > div, :global(html[data-theme="dark"]) .board-menu-panel, :global(html[data-theme="dark"]) .bulk-move-menu, :global(html[data-theme="dark"]) .account-menu { background: #171717 !important; color: #fafafa !important; border-color: #404040 !important; box-shadow: 2px 2px 0 #404040 !important; }
  :global(html[data-theme="dark"]) .collection-menu button, :global(html[data-theme="dark"]) .board-menu-panel button, :global(html[data-theme="dark"]) .bulk-move-menu button, :global(html[data-theme="dark"]) .account-menu button { background: transparent !important; color: #d4d4d4 !important; }
  :global(html[data-theme="dark"]) .collection-menu button:hover, :global(html[data-theme="dark"]) .board-menu-panel button:hover, :global(html[data-theme="dark"]) .bulk-move-menu button:hover, :global(html[data-theme="dark"]) .account-menu button:hover { background: #262626 !important; color: #a5b4fc !important; }
  :global(html[data-theme="dark"]) .collection-row:hover, :global(html[data-theme="dark"]) .collection-row:focus-within { border-color: #525252; background: #262626; }
  :global(html[data-theme="dark"]) .collection-row.active { border-color: #525252; background: #262626; box-shadow: 1.5px 1.5px 0 #404040; }
  :global(html[data-theme="dark"]) .nav-item.active { border-color: #525252; background: #262626; box-shadow: 1.5px 1.5px 0 #404040; }
  :global(html[data-theme="dark"]) .nav-item:not(.collection-item):hover { border-color: #525252; background: #262626; }
  :global(html[data-theme="dark"]) .collection-row .nav-item:hover, :global(html[data-theme="dark"]) .collection-row.active .nav-item, :global(html[data-theme="dark"]) .collection-row.active .nav-item:hover { color: #c7d2fe; }
  :global(html[data-theme="dark"]) .collection-menu[open] summary, :global(html[data-theme="dark"]) .collection-menu summary:hover { background: #404040; color: #c7d2fe; }
  :global(html[data-theme="dark"]) .menu-backdrop, :global(html[data-theme="dark"]) .bulk-menu-backdrop { background: transparent !important; border: 0 !important; box-shadow: none !important; backdrop-filter: none !important; }
  :global(html[data-theme="dark"]) .toolbar-controls > select { background-color: #262626 !important; color: #fafafa !important; border-color: #404040 !important; box-shadow: 2px 2px 0 #404040 !important; color-scheme: dark; }
  :global(html[data-theme="dark"]) .toolbar-controls .icon-button { background: #262626 !important; color: #c7d2fe !important; border-color: #404040 !important; box-shadow: 2px 2px 0 #404040 !important; }
  :global(html[data-theme="dark"]) .toolbar-controls .icon-button:hover:not(:disabled) { background: #333333 !important; color: #e0e7ff !important; border-color: #6366f1 !important; }
  :global(html[data-theme="dark"]) .toolbar-controls .icon-button:disabled { background: #262626 !important; color: #737373 !important; border-color: #404040 !important; opacity: .65; }
  :global(html[data-theme="dark"]) .toolbar-controls .icon-button.danger-icon { color: #fb7185 !important; }
  :global(html[data-theme="dark"]) .toolbar-controls .import-button { background: #262626 !important; color: #c7d2fe !important; border-color: #404040 !important; box-shadow: 2px 2px 0 #404040 !important; }
  :global(html[data-theme="dark"]) .toolbar-controls .import-button:hover:not(:disabled) { background: #333333 !important; color: #e0e7ff !important; }
  :global(html[data-theme="dark"]) .toolbar-controls .new-drawing { background: #4f46e5 !important; color: #ffffff !important; border-color: #6366f1 !important; box-shadow: 2px 2px 0 #404040 !important; }
  :global(html[data-theme="dark"]) .toolbar-controls .new-drawing:hover:not(:disabled) { background: #6366f1 !important; }
  :global(html[data-theme="dark"]) .toolbar-controls .button:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
  :global(html[data-theme="dark"]) .board-select { background: #262626 !important; border-color: #404040 !important; box-shadow: 2px 2px 0 #404040 !important; color-scheme: dark; }
  :global(html[data-theme="dark"]) .board-select input { background-color: #262626 !important; accent-color: #6366f1; color-scheme: dark; }
  :global(html[data-theme="dark"]) .board-menu summary { background: #262626 !important; color: #c7d2fe !important; border-color: #404040 !important; box-shadow: 2px 2px 0 #404040 !important; }
  :global(html[data-theme="dark"]) .board-menu[open] summary, :global(html[data-theme="dark"]) .board-menu summary:hover { background: #333333 !important; color: #e0e7ff !important; border-color: #6366f1 !important; }
  :global(html[data-theme="dark"]) .board-icon { background-color: #171717; background-image: linear-gradient(to right, rgb(115 115 115 / .12) 1px, transparent 1px), linear-gradient(to bottom, rgb(115 115 115 / .12) 1px, transparent 1px); border-bottom-color: #404040; color: #a5b4fc; }
  :global(html[data-theme="dark"]) .mobile-menu-toggle { background: #262626; color: #fafafa; border-color: #525252; box-shadow: 2px 2px 0 #404040; }
  :global(html[data-theme="dark"]) .mobile-brand { color: #fafafa; }
  :global(html[data-theme="dark"]) .sidebar .brand-mark, :global(html[data-theme="dark"]) .mobile-brand .brand-mark { background: #262626; border-color: #525252; box-shadow: 1.5px 1.5px 0 #404040; }
  :global(html[data-theme="dark"]) .sidebar .brand-mark img, :global(html[data-theme="dark"]) .mobile-brand .brand-mark img { filter: invert(1) hue-rotate(180deg); }
</style>