<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  onMount(() => { void goto('/', { replaceState: true }); });
</script>
<svelte:head><title>Dashboard · DrawFlare</title></svelte:head>
<div class="redirect" role="status">Opening dashboard…</div>
<style>.redirect{min-height:100dvh;display:grid;place-items:center;color:#64748b;font:14px system-ui,sans-serif}</style>
