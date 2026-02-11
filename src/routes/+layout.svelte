<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import ToastContainer from '$lib/components/ui/ToastContainer.svelte';
	import { toastStore } from '$lib/stores/toast.js';

	let { children } = $props();

	const navItems = [
		{ href: '/', label: 'Dashboard', icon: 'home' },
		{ href: '/library', label: 'Library', icon: 'library' },
		{ href: '/settings', label: 'Settings', icon: 'settings' }
	];
	const appVersion = '0.1.0';
	const changelog = [{ version: appVersion, notes: [] as string[] }];

	let scanning = $state(false);
	let showChangelog = $state(false);
	
	// Progress tracking
	let scanProgress = $state({
		isScanning: false,
		phase: '',
		currentStep: 0,
		totalSteps: 0,
		currentItem: '',
		percent: 0,
		startedAt: null as string | null
	});
	let eventSource: EventSource | null = null;

	function getIcon(icon: string) {
		const icons: Record<string, string> = {
			home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
			library: 'M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z',
			settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z'
		};
		return icons[icon] || icons.home;
	}

	function startProgressTracking() {
		if (eventSource) {
			eventSource.close();
		}
		
		eventSource = new EventSource('/api/scan/progress');
		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				scanProgress = data;
				
				if (!data.isScanning && eventSource) {
					eventSource.close();
					eventSource = null;
				}
			} catch (error) {
				console.error('Error parsing progress:', error);
			}
		};
		
		eventSource.onerror = () => {
			if (eventSource) {
				eventSource.close();
				eventSource = null;
			}
		};
	}

	async function handleSync() {
		scanning = true;
		startProgressTracking();
		try {
			const resp = await fetch('/api/sync-library', { method: 'POST' });
			const result = await resp.json();
			if (result.success) {
				const count = result.added || 0;
				if (count > 0) {
					toastStore.success(`Synced ${count} game${count !== 1 ? 's' : ''}`, 'Sync Library');
				} else {
					toastStore.info('Library is up to date', 'Sync Library');
				}
				setTimeout(() => window.location.reload(), 1500);
			} else {
				toastStore.error(result.message || 'Sync failed', 'Sync Library');
			}
		} catch {
			toastStore.error('Network error', 'Sync Library');
		} finally {
			scanning = false;
		}
	}

	async function handleCheckUpdates() {
		scanning = true;
		startProgressTracking();
		try {
			const resp = await fetch('/api/check-updates', { method: 'POST' });
			const result = await resp.json();
			if (result.success) {
				toastStore.success('Update check complete', 'Check Updates');
				setTimeout(() => window.location.reload(), 2000);
			} else {
				toastStore.error(result.error || 'Search failed', 'Check Updates');
			}
		} catch {
			toastStore.error('Network error', 'Check Updates');
		} finally {
			scanning = false;
		}
	}

	async function handleFullScan() {
		scanning = true;
		startProgressTracking();
		try {
			const resp = await fetch('/api/scan?type=full', { method: 'POST' });
			const result = await resp.json();
			if (!result.success) {
				toastStore.error(result.error || 'Scan failed', 'Full Scan');
			} else {
				toastStore.success('Full scan complete', 'Full Scan');
				setTimeout(() => window.location.reload(), 1500);
			}
		} catch {
			toastStore.error('Network error', 'Full Scan');
		} finally {
			scanning = false;
		}
	}

	function closeChangelog() {
		showChangelog = false;
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
	<!-- Sidebar -->
	<nav class="fixed top-0 left-0 h-full w-64 bg-gradient-to-b from-slate-900/95 to-slate-950/95 backdrop-blur-xl border-r border-slate-700/50 flex flex-col z-50 shadow-2xl">
		<!-- Logo -->
		<div class="p-6 border-b border-slate-700/50">
			<div class="flex items-center gap-3 mb-2">
				<div class="relative w-12 h-12 rounded-full shadow-lg shadow-purple-900/50">
					<svg viewBox="0 0 64 64" class="w-full h-full">
						<defs>
							<linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
								<stop offset="0%" style="stop-color:#1a1625;stop-opacity:1" />
								<stop offset="50%" style="stop-color:#2d1b4e;stop-opacity:1" />
								<stop offset="100%" style="stop-color:#4a1d7e;stop-opacity:1" />
							</linearGradient>
							<linearGradient id="iconGrad" x1="0%" y1="0%" x2="100%" y2="100%">
								<stop offset="0%" style="stop-color:#c4b5fd;stop-opacity:1" />
								<stop offset="100%" style="stop-color:#a78bfa;stop-opacity:1" />
							</linearGradient>
						</defs>
						<circle cx="32" cy="32" r="32" fill="url(#bgGrad)"/>
						<g transform="translate(32, 32)">
							<rect x="-12" y="-10" width="24" height="20" rx="2" fill="none" stroke="url(#iconGrad)" stroke-width="2.5" stroke-linejoin="round"/>
							<line x1="-12" y1="0" x2="12" y2="0" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round"/>
							<line x1="0" y1="-10" x2="0" y2="10" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round"/>
							<g transform="translate(0, 2)">
								<line x1="0" y1="-6" x2="0" y2="3" stroke="#c4b5fd" stroke-width="2" stroke-linecap="round"/>
								<path d="M -3,0 L 0,3 L 3,0" fill="none" stroke="#c4b5fd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							</g>
						</g>
					</svg>
				</div>
				<div>
					<h1 class="text-xl font-bold bg-gradient-to-r from-purple-300 via-purple-200 to-slate-300 bg-clip-text text-transparent">
						Repackarr
					</h1>
					<p class="text-xs text-slate-500">Automated Repack Manager</p>
				</div>
			</div>
		</div>

		<!-- Navigation -->
		<div class="flex-1 p-4 space-y-2">
			{#each navItems as item}
				<a
					href={item.href}
					class="group flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-gradient-to-r hover:from-purple-500/10 hover:to-purple-700/10 transition-all relative overflow-hidden"
				>
					<div class="absolute inset-0 bg-gradient-to-r from-purple-500/0 to-purple-700/0 group-hover:from-purple-500/5 group-hover:to-purple-700/5 transition-all"></div>
					<svg class="w-5 h-5 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d={getIcon(item.icon)} />
					</svg>
					<span class="relative z-10">{item.label}</span>
				</a>
			{/each}
		</div>

		<!-- Version -->
		<div class="p-4 border-t border-slate-700/50">
			<button
				onclick={() => (showChangelog = true)}
				class="w-full flex items-center justify-center py-1 text-slate-500 hover:text-slate-300 transition"
				title="View changelog"
			>
				<span class="text-xs font-mono font-medium text-current">v{appVersion}</span>
			</button>
		</div>
	</nav>

	<!-- Main Content -->
	<main class="ml-64 min-h-screen">
		<!-- Top Action Bar -->
		<div class="sticky top-0 z-40 bg-gradient-to-r from-slate-900/95 to-slate-950/95 backdrop-blur-xl border-b border-slate-700/50">
			<div class="px-6 py-3 flex items-center justify-end gap-2">
				<!-- Sync Button -->
				<button
					onclick={handleSync}
					disabled={scanning}
					class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-600/50 text-sm font-medium text-slate-300 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
					title="Sync library from qBittorrent"
				>
					{#if scanning}
						<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
					{:else}
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
					{/if}
					<span>Sync</span>
				</button>

				<!-- Check Updates Button -->
				<button
					onclick={handleCheckUpdates}
					disabled={scanning}
					class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-600/50 text-sm font-medium text-slate-300 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
					title="Search Prowlarr for updates"
				>
					{#if scanning}
						<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
					{:else}
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
						</svg>
					{/if}
					<span>Search</span>
				</button>

				<!-- Full Scan Button -->
				<button
					onclick={handleFullScan}
					disabled={scanning}
					class="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white text-sm font-semibold transition-all shadow-lg shadow-purple-600/25 hover:shadow-purple-600/40 disabled:opacity-50 disabled:cursor-not-allowed"
					title="Full scan: Sync + Search"
				>
					{#if scanning}
						<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
					{:else}
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
					{/if}
					<span>Full Scan</span>
				</button>
			</div>
			
			<!-- Progress Bar -->
			{#if browser && scanProgress.isScanning}
				<div class="px-6 pb-3">
					<div class="bg-slate-800/50 rounded-lg p-3 border border-purple-500/30">
						<div class="flex items-center justify-between mb-2">
							<div class="flex items-center gap-3">
								<svg class="w-4 h-4 text-purple-400 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								<div>
									<div class="text-sm font-medium text-white">{scanProgress.phase}</div>
									{#if scanProgress.currentItem}
										<div class="text-xs text-slate-400">{scanProgress.currentItem}</div>
									{/if}
								</div>
							</div>
							<div class="text-sm font-semibold text-purple-400">
								{scanProgress.percent}%
							</div>
						</div>
						<div class="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
							<div 
								class="bg-gradient-to-r from-purple-500 to-purple-700 h-full transition-all duration-300 ease-out"
								style="width: {scanProgress.percent}%"
							></div>
						</div>
						{#if scanProgress.totalSteps > 0}
							<div class="text-xs text-slate-500 mt-1.5 text-center">
								{scanProgress.currentStep} / {scanProgress.totalSteps} items
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Page Content -->
		{@render children()}
	</main>
</div>

{#if showChangelog}
	<div
		class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Changelog"
		onclick={(e) => {
			if (e.target === e.currentTarget) closeChangelog();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') closeChangelog();
		}}
		tabindex="-1"
	>
		<div class="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
			<div class="px-5 py-4 border-b border-slate-700/70 flex items-center justify-between gap-4">
				<h3 class="text-lg font-semibold text-white">Changelog</h3>
				<button
					onclick={closeChangelog}
					class="p-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
					title="Close changelog"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="p-5 max-h-[60vh] overflow-y-auto space-y-3">
				{#each changelog as entry}
					<div class="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
						<div class="flex items-center gap-2 mb-2">
							<span class="inline-flex items-center px-2 py-0.5 rounded-md border border-slate-600 text-xs font-mono text-slate-200">
								v{entry.version}
							</span>
							{#if entry.version === appVersion}
								<span class="text-xs text-slate-400">Current</span>
							{/if}
						</div>
						{#if entry.notes.length > 0}
							<ul class="list-disc pl-5 text-sm text-slate-300 space-y-1">
								{#each entry.notes as note}
									<li>{note}</li>
								{/each}
							</ul>
						{:else}
							<div class="text-sm text-slate-400">Initial release.</div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="px-5 py-3 border-t border-slate-700/70 flex justify-end bg-slate-900/70">
				<button
					onclick={closeChangelog}
					class="px-3 py-1.5 text-xs rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600/70 transition"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}

<ToastContainer />
