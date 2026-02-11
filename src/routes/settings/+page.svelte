<script lang="ts">
	import type { PageData } from './$types.js';
	import { toastStore } from '$lib/stores/toast.js';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { onMount } from 'svelte';

	let { data }: { data: PageData } = $props();
	
	let activeTab = $state<'general' | 'connection' | 'blacklist' | 'system'>('general');
	
	// Connection Test States
	let testingQbit = $state(false);
	let testingProwlarr = $state(false);
	let testingIgdb = $state(false);

	// Log States
	let logFiles = $state<string[]>([]);
	let selectedLog = $state<string | null>(null);
	let logContent = $state<any[]>([]);
	let loadingLogs = $state(false);

	async function testConnection(type: 'qbit' | 'prowlarr' | 'igdb') {
		if (type === 'qbit') testingQbit = true;
		else if (type === 'prowlarr') testingProwlarr = true;
		else testingIgdb = true;

		try {
			const resp = await fetch(`/api/test/${type}`, { method: 'POST' });
			const result = await resp.json();
			
			const serviceName = type === 'qbit' ? 'qBittorrent' : type === 'prowlarr' ? 'Prowlarr' : 'IGDB';
			if (result.success) {
				toastStore.success(result.message, serviceName);
			} else {
				toastStore.error(result.message, serviceName);
			}
		} catch (error) {
			const serviceName = type === 'qbit' ? 'qBittorrent' : type === 'prowlarr' ? 'Prowlarr' : 'IGDB';
			toastStore.error('Network error', serviceName);
		} finally {
			if (type === 'qbit') testingQbit = false;
			else if (type === 'prowlarr') testingProwlarr = false;
			else testingIgdb = false;
		}
	}

	async function handleSave(e: Event) {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		try {
			const resp = await fetch(form.action, {
				method: 'POST',
				body: new FormData(form)
			});
			if (resp.ok) {
				toastStore.success('Settings saved successfully!');
			} else {
				toastStore.error('Failed to save settings');
			}
		} catch {
			toastStore.error('Network error');
		}
	}

	let ignoredReleases = $state<PageData['ignoredReleases']>([]);

	$effect(() => {
		ignoredReleases = data.ignoredReleases;
	});

	async function restoreIgnored(id: number) {
		try {
			const formData = new FormData();
			formData.append('id', id.toString());
			
			const resp = await fetch('?/restoreIgnored', {
				method: 'POST',
				body: formData
			});
			
			if (resp.ok) {
				toastStore.success('Release restored to library');
				ignoredReleases = ignoredReleases.filter(item => item.ignored.id !== id);
			} else {
				toastStore.error('Failed to restore release');
			}
		} catch {
			toastStore.error('Network error');
		}
	}
	
	async function loadLogFiles() {
		loadingLogs = true;
		try {
			const resp = await fetch('/api/system/logs');
			const result = await resp.json();
			logFiles = result.files || [];
			if (logFiles.length > 0 && !selectedLog) {
				loadLogContent(logFiles[0]);
			}
		} catch {
			toastStore.error('Failed to load log files');
		} finally {
			loadingLogs = false;
		}
	}
	
	async function loadLogContent(file: string) {
		selectedLog = file;
		loadingLogs = true;
		try {
			const resp = await fetch(`/api/system/logs?file=${file}`);
			const result = await resp.json();
			logContent = result.content || [];
		} catch {
			toastStore.error('Failed to read log content');
		} finally {
			loadingLogs = false;
		}
	}
	
	$effect(() => {
		if (activeTab === 'system') {
			loadLogFiles();
		}
	});
</script>

<svelte:head>
	<title>Settings - Repackarr</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-8">
	<div class="max-w-5xl mx-auto space-y-6">
		<!-- Header -->
		<div class="mb-8">
			<h2 class="text-3xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
				Settings
			</h2>
			<p class="text-slate-400 mt-1">Configure your Repackarr instance</p>
		</div>

		<!-- Tabs -->
		<div class="flex gap-2 border-b border-slate-700/50 mb-6">
			<button
				onclick={() => activeTab = 'general'}
				class="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative {activeTab === 'general' ? 'text-white bg-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}"
			>
				General
				{#if activeTab === 'general'}
					<div class="absolute bottom-0 left-0 w-full h-0.5 bg-violet-500"></div>
				{/if}
			</button>
			<button
				onclick={() => activeTab = 'connection'}
				class="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative {activeTab === 'connection' ? 'text-white bg-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}"
			>
				Connections
				{#if activeTab === 'connection'}
					<div class="absolute bottom-0 left-0 w-full h-0.5 bg-violet-500"></div>
				{/if}
			</button>
			<button
				onclick={() => activeTab = 'blacklist'}
				class="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative {activeTab === 'blacklist' ? 'text-white bg-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}"
			>
				Blacklist
				{#if activeTab === 'blacklist'}
					<div class="absolute bottom-0 left-0 w-full h-0.5 bg-violet-500"></div>
				{/if}
			</button>
			<button
				onclick={() => activeTab = 'system'}
				class="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative {activeTab === 'system' ? 'text-white bg-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}"
			>
				System
				{#if activeTab === 'system'}
					<div class="absolute bottom-0 left-0 w-full h-0.5 bg-violet-500"></div>
				{/if}
			</button>
		</div>

		{#if activeTab === 'general'}
			<div in:fade={{ duration: 200 }} class="space-y-6">
				<form
					method="POST"
					action="?/saveSettings"
					class="space-y-6"
					onsubmit={handleSave}
				>
					<!-- Scan Settings -->
					<div class="bg-gradient-to-br from-slate-800/90 to-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
						<div class="bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 px-6 py-4 border-b border-slate-700/50">
							<div class="flex items-center gap-3">
								<div class="p-2 bg-violet-500/20 rounded-lg">
									<svg class="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
									</svg>
								</div>
								<h3 class="text-lg font-semibold text-white">Scan Settings</h3>
							</div>
						</div>
						<div class="p-6">
							<label for="interval" class="block text-sm font-medium text-slate-300 mb-2">
								Scan Interval (minutes)
							</label>
							<input
								type="number"
								id="interval"
								name="CRON_INTERVAL_MINUTES"
								value={data.settings.CRON_INTERVAL_MINUTES}
								min="5"
								max="1440"
								class="w-full max-w-xs px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent transition-all"
								placeholder="360"
							/>
							<p class="text-xs text-slate-500 mt-2">How often to scan for new game releases</p>
						</div>
					</div>

					<!-- Filtering -->
					<div class="bg-gradient-to-br from-slate-800/90 to-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
						<div class="bg-gradient-to-r from-rose-500/10 to-pink-500/10 px-6 py-4 border-b border-slate-700/50">
							<div class="flex items-center gap-3">
								<div class="p-2 bg-rose-500/20 rounded-lg">
									<svg class="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
									</svg>
								</div>
								<h3 class="text-lg font-semibold text-white">Filtering</h3>
							</div>
						</div>
						<div class="p-6 space-y-5">
							<div>
								<label for="platforms" class="block text-sm font-medium text-slate-300 mb-2">
									Platform Filter
								</label>
								<input
									type="text"
									id="platforms"
									name="PLATFORM_FILTER"
									value={data.settings.PLATFORM_FILTER}
									class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-transparent transition-all"
									placeholder="Windows, Linux, macOS"
								/>
								<p class="text-xs text-slate-500 mt-2">Comma-separated platform names</p>
							</div>
							<div>
								<label for="keywords" class="block text-sm font-medium text-slate-300 mb-2">
									Ignored Keywords
								</label>
								<input
									type="text"
									id="keywords"
									name="IGNORED_KEYWORDS"
									value={data.settings.IGNORED_KEYWORDS}
									class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-transparent transition-all"
									placeholder="OST, Soundtrack, Update Only"
								/>
								<p class="text-xs text-slate-500 mt-2">Releases containing these will be ignored</p>
							</div>
							<div>
								<label for="indexers" class="block text-sm font-medium text-slate-300 mb-2">
									Allowed Indexers
								</label>
								<input
									type="text"
									id="indexers"
									name="ALLOWED_INDEXERS"
									value={data.settings.ALLOWED_INDEXERS}
									class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-transparent transition-all"
									placeholder="1337x, RARBG, TorrentGalaxy"
								/>
								<p class="text-xs text-slate-500 mt-2">Only use these indexers (leave empty for all)</p>
							</div>
						</div>
					</div>
					
					<button
						type="submit"
						class="w-full px-8 py-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-lg font-semibold rounded-2xl transition-all shadow-2xl hover:shadow-violet-500/25 flex items-center justify-center gap-3"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
						Save General Settings
					</button>
				</form>
			</div>
		{/if}

		{#if activeTab === 'blacklist'}
			<div in:fade={{ duration: 200 }} class="space-y-6">
				<!-- Ignored Releases -->
				<div class="bg-gradient-to-br from-slate-800/90 to-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
					<div class="bg-gradient-to-r from-amber-500/10 to-orange-500/10 px-6 py-4 border-b border-slate-700/50">
						<div class="flex items-center gap-3">
							<div class="p-2 bg-amber-500/20 rounded-lg">
								<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
								</svg>
							</div>
							<h3 class="text-lg font-semibold text-white">Ignored Releases</h3>
						</div>
					</div>

					{#if ignoredReleases.length === 0}
						<div class="p-12 text-center">
							<svg class="w-16 h-16 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
							</svg>
							<p class="text-slate-400 text-sm">No ignored releases</p>
						</div>
					{:else}
						<div class="divide-y divide-slate-700/30">
							{#each ignoredReleases as item (item.ignored.id)}
								<div 
									class="px-6 py-4 flex items-center justify-between hover:bg-slate-700/20 transition-colors"
									animate:flip={{ duration: 300 }}
									out:fade
								>
									<div class="flex-1">
										<p class="text-sm font-medium text-slate-200 mb-1">{item.ignored.releaseTitle}</p>
										<div class="flex items-center gap-2 text-xs text-slate-400">
											<span>{item.gameTitle}</span>
											<span>•</span>
											<span>{new Date(item.ignored.ignoredAt).toLocaleDateString()}</span>
										</div>
									</div>
									<button
										type="button"
										onclick={() => restoreIgnored(item.ignored.id)}
										class="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-600 hover:to-teal-500 text-white text-sm font-medium rounded-lg transition-all shadow-lg hover:shadow-emerald-500/25"
									>
										Restore
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if activeTab === 'connection'}
			<div in:fade={{ duration: 200 }} class="space-y-6">
				<form
					method="POST"
					action="?/saveSettings"
					class="space-y-6"
					onsubmit={handleSave}
				>
					<!-- qBittorrent -->
					<div class="bg-gradient-to-br from-slate-800/90 to-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
						<div class="bg-gradient-to-r from-green-500/10 to-emerald-500/10 px-6 py-4 border-b border-slate-700/50">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="p-2 bg-green-500/20 rounded-lg">
										<svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
										</svg>
									</div>
									<h3 class="text-lg font-semibold text-white">qBittorrent</h3>
								</div>
								<button
									type="button"
									onclick={() => testConnection('qbit')}
									class="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white text-sm font-medium rounded-lg transition-all shadow-lg hover:shadow-green-500/25 flex items-center gap-2"
									disabled={testingQbit}
								>
									{#if testingQbit}
										<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
									{:else}
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
										</svg>
									{/if}
									Test Connection
								</button>
							</div>
						</div>
						<div class="p-6 space-y-5">
							<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
								<div>
									<label for="qbit_host" class="block text-sm font-medium text-slate-300 mb-2">
										Host URL
									</label>
									<input
										type="url"
										id="qbit_host"
										name="QBIT_HOST"
										value={data.settings.QBIT_HOST}
										required
										class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-transparent transition-all"
										placeholder="http://localhost:8080"
									/>
								</div>
								<div>
									<label for="qbit_category" class="block text-sm font-medium text-slate-300 mb-2">
										Category
									</label>
									<input
										type="text"
										id="qbit_category"
										name="QBIT_CATEGORY"
										value={data.settings.QBIT_CATEGORY}
										required
										class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-transparent transition-all"
										placeholder="games"
									/>
								</div>
							</div>
							<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
								<div>
									<label for="qbit_username" class="block text-sm font-medium text-slate-300 mb-2">
										Username
									</label>
									<input
										type="text"
										id="qbit_username"
										name="QBIT_USERNAME"
										value={data.settings.QBIT_USERNAME}
										required
										autocomplete="username"
										class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-transparent transition-all"
										placeholder="admin"
									/>
								</div>
								<div>
									<label for="qbit_password" class="block text-sm font-medium text-slate-300 mb-2">
										Password
									</label>
									<input
										type="password"
										id="qbit_password"
										name="QBIT_PASSWORD"
										value={data.settings.QBIT_PASSWORD}
										required
										autocomplete="current-password"
										class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-transparent transition-all font-mono"
										placeholder="••••••••••••••••"
									/>
								</div>
							</div>
						</div>
					</div>

					<!-- Prowlarr -->
					<div class="bg-gradient-to-br from-slate-800/90 to-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
						<div class="bg-gradient-to-r from-orange-500/10 to-amber-500/10 px-6 py-4 border-b border-slate-700/50">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="p-2 bg-orange-500/20 rounded-lg">
										<svg class="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
										</svg>
									</div>
									<h3 class="text-lg font-semibold text-white">Prowlarr</h3>
								</div>
								<button
									type="button"
									onclick={() => testConnection('prowlarr')}
									class="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-sm font-medium rounded-lg transition-all shadow-lg hover:shadow-orange-500/25 flex items-center gap-2"
									disabled={testingProwlarr}
								>
									{#if testingProwlarr}
										<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
									{:else}
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
										</svg>
									{/if}
									Test Connection
								</button>
							</div>
						</div>
						<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
							<div>
								<label for="prowlarr_url" class="block text-sm font-medium text-slate-300 mb-2">
									URL
								</label>
								<input
									type="url"
									id="prowlarr_url"
									name="PROWLARR_URL"
									value={data.settings.PROWLARR_URL}
									required
									class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-transparent transition-all"
									placeholder="http://localhost:9696"
								/>
							</div>
							<div>
								<label for="prowlarr_key" class="block text-sm font-medium text-slate-300 mb-2">
									API Key
								</label>
								<input
									type="password"
									id="prowlarr_key"
									name="PROWLARR_API_KEY"
									value={data.settings.PROWLARR_API_KEY}
									required
									class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-transparent transition-all font-mono"
									placeholder="••••••••••••••••"
								/>
							</div>
						</div>
					</div>

					<!-- IGDB -->
					<div class="bg-gradient-to-br from-slate-800/90 to-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
						<div class="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 px-6 py-4 border-b border-slate-700/50">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="p-2 bg-blue-500/20 rounded-lg">
										<svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
										</svg>
									</div>
									<div>
										<h3 class="text-lg font-semibold text-white">IGDB</h3>
										<p class="text-xs text-slate-400">Optional - for game metadata</p>
									</div>
								</div>
								<button
									type="button"
									onclick={() => testConnection('igdb')}
									class="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white text-sm font-medium rounded-lg transition-all shadow-lg hover:shadow-blue-500/25 flex items-center gap-2"
									disabled={testingIgdb}
								>
									{#if testingIgdb}
										<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
									{:else}
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
										</svg>
									{/if}
									Test Connection
								</button>
							</div>
						</div>
						<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
							<div>
								<label for="igdb_id" class="block text-sm font-medium text-slate-300 mb-2">
									Client ID
								</label>
								<input
									type="text"
									id="igdb_id"
									name="IGDB_CLIENT_ID"
									value={data.settings.IGDB_CLIENT_ID}
									class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all font-mono"
									placeholder="Your client ID"
								/>
							</div>
							<div>
								<label for="igdb_secret" class="block text-sm font-medium text-slate-300 mb-2">
									Client Secret
								</label>
								<input
									type="password"
									id="igdb_secret"
									name="IGDB_CLIENT_SECRET"
									value={data.settings.IGDB_CLIENT_SECRET}
									class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all font-mono"
									placeholder="••••••••••••••••"
								/>
							</div>
						</div>
					</div>

					<button
						type="submit"
						class="w-full px-8 py-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-lg font-semibold rounded-2xl transition-all shadow-2xl hover:shadow-violet-500/25 flex items-center justify-center gap-3"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
						Save Connection Settings
					</button>
				</form>
			</div>
		{/if}

		{#if activeTab === 'system'}
			<div in:fade={{ duration: 200 }} class="space-y-6">
				<!-- Indexer Stats -->
				<div class="bg-gradient-to-br from-slate-800/90 to-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
					<div class="bg-gradient-to-r from-indigo-500/10 to-blue-500/10 px-6 py-4 border-b border-slate-700/50">
						<div class="flex items-center gap-3">
							<div class="p-2 bg-indigo-500/20 rounded-lg">
								<svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
								</svg>
							</div>
							<h3 class="text-lg font-semibold text-white">Indexer Statistics</h3>
						</div>
					</div>
					<div class="p-6">
						{#if !data.stats || data.stats.length === 0}
							<p class="text-slate-400 text-sm text-center py-4">No release data found yet.</p>
						{:else}
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								{#each data.stats as stat}
									<div class="bg-slate-900/50 border border-slate-700/50 p-4 rounded-xl flex items-center justify-between">
										<div>
											<div class="text-xs text-slate-400 uppercase font-bold tracking-wider">{stat.indexer}</div>
											<div class="text-2xl font-bold text-white mt-1">{stat.count}</div>
										</div>
										<div class="p-3 bg-indigo-500/10 rounded-full">
											<svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
											</svg>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Logs -->
				<div class="bg-gradient-to-br from-slate-800/90 to-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden h-[600px] flex flex-col">
				<div class="bg-gradient-to-r from-slate-500/10 to-gray-500/10 px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div class="p-2 bg-slate-500/20 rounded-lg">
							<svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
							</svg>
						</div>
						<h3 class="text-lg font-semibold text-white">System Logs</h3>
					</div>
					<div class="flex gap-2">
						<select
							bind:value={selectedLog}
							onchange={() => selectedLog && loadLogContent(selectedLog)}
							class="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-500"
						>
							{#each logFiles as file}
								<option value={file}>{file}</option>
							{/each}
						</select>
						<button
							onclick={() => selectedLog && loadLogContent(selectedLog)}
							class="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm"
							title="Refresh logs"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
						</button>
						{#if selectedLog}
							<a
								href="/api/system/logs?file={selectedLog}&download=true"
								download
								class="px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-sm flex items-center gap-2"
								title="Download log file"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
								</svg>
								Download
							</a>
						{/if}
					</div>
				</div>
				
				<div class="flex-1 overflow-auto p-4 bg-slate-950 font-mono text-xs text-slate-300">
					{#if loadingLogs}
						<div class="flex items-center justify-center h-full text-slate-500 gap-2">
							<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							Loading logs...
						</div>
					{:else if logContent.length === 0}
						<div class="flex items-center justify-center h-full text-slate-500">No logs found</div>
					{:else}
						<div class="space-y-1">
							{#each logContent as line}
								<div class="hover:bg-white/5 px-2 py-0.5 rounded flex gap-3">
									<span class="text-slate-500 shrink-0">{new Date(line.timestamp).toLocaleTimeString()}</span>
									<span class="shrink-0 w-16 font-bold uppercase
										{line.level === 'info' ? 'text-blue-400' : 
										 line.level === 'error' ? 'text-red-400' : 
										 line.level === 'warn' ? 'text-amber-400' : 'text-slate-400'}">
										[{line.level}]
									</span>
									<span class="break-all whitespace-pre-wrap">{line.message}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
			</div>
		{/if}
	</div>
</div>
