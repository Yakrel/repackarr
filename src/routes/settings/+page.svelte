<script lang="ts">
	import type { PageData, ActionData } from './$types.js';
	import { toastStore } from '$lib/stores/toast.js';
	import { enhance } from '$app/forms';
	import { fade, slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { APP_VERSION_LABEL } from '$lib/version.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let activeTab = $state<'general' | 'connection' | 'blacklist' | 'system'>('general');
	let saving = $state(false);
	let resetting = $state(false);

	// Connection Test States
	let testingQbit = $state(false);
	let testingProwlarr = $state(false);
	let testingIgdb = $state(false);

	// Log States
	let logFiles = $state<string[]>([]);
	let selectedLog = $state<string | null>(null);
	let logContent = $state<any[]>([]);
	let loadingLogs = $state(false);

	$effect(() => {
		if (form?.success) {
			toastStore.success('Settings saved successfully');
		}
	});

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

	async function restoreRelease(id: number) {
		const formData = new FormData();
		formData.append('id', id.toString());
		const resp = await fetch('?/restoreIgnored', {
			method: 'POST',
			body: formData
		});
		if (resp.ok) {
			toastStore.success('Release restored to search results');
		}
	}

	async function loadLogFiles() {
		loadingLogs = true;
		try {
			const resp = await fetch('/api/system/logs');
			const result = await resp.json();
			if (resp.ok) {
				logFiles = result.files || [];
				if (logFiles.length > 0 && !selectedLog) {
					loadLogContent(logFiles[0]);
				}
			}
		} catch (error) {
			console.error('Failed to load logs:', error);
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
			if (resp.ok) {
				logContent = result.content || [];
			}
		} catch (error) {
			console.error('Failed to load log content:', error);
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

<div class="p-6 max-w-6xl mx-auto space-y-6 pb-12">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-2xl font-bold text-white">Settings</h2>
			<p class="text-sm text-slate-400 mt-1">Manage your Repackarr configuration</p>
		</div>
		{#if activeTab === 'general'}
			<form action="?/resetDefaults" method="POST" use:enhance={() => {
				resetting = true;
				return async ({ update }) => {
					await update();
					resetting = false;
					toastStore.success('Restored default filters');
				};
			}}>
				<button
					type="submit"
					disabled={resetting}
					class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg border border-slate-700 transition-colors flex items-center gap-2"
				>
					<svg class="w-4 h-4 {resetting ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
					Reset Defaults
				</button>
			</form>
		{/if}
	</div>

	<!-- Tabs Navigation -->
	<div class="flex gap-1 p-1 bg-slate-900/50 border border-slate-800 rounded-xl w-fit">
		{#each ['general', 'connection', 'blacklist', 'system'] as tab}
			<button
				onclick={() => activeTab = tab as any}
				class="px-6 py-2 rounded-lg text-sm font-medium transition-all {activeTab === tab ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'}"
			>
				{tab.charAt(0).toUpperCase() + tab.slice(1)}
			</button>
		{/each}
	</div>

	{#if activeTab === 'general'}
		<div in:fade={{ duration: 200 }} class="space-y-6">
			<form
				method="POST"
				action="?/saveSettings"
				use:enhance={() => {
					saving = true;
					return async ({ update }) => {
						await update({ reset: false });
						saving = false;
					};
				}}
				class="space-y-6"
			>
				<div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
					<div class="px-6 py-4 border-b border-slate-700 bg-slate-700/20">
						<h3 class="text-sm font-bold text-purple-400 uppercase tracking-wider">Search & Filtering</h3>
						<p class="text-xs text-slate-500 mt-1">Global filters and search preferences.</p>
					</div>
					<div class="p-6 space-y-6">
						<div class="space-y-2">
							<label for="IGNORED_KEYWORDS" class="block text-sm font-medium text-slate-300">Ignored Keywords (Global)</label>
							<textarea
								id="IGNORED_KEYWORDS"
								name="IGNORED_KEYWORDS"
								rows="5"
								class="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-slate-200 text-sm focus:ring-2 focus:ring-purple-500/50 outline-none transition-all"
								placeholder="Comma separated list of keywords..."
								value={data.settings.IGNORED_KEYWORDS}
							></textarea>
							<p class="text-[11px] text-slate-500 italic flex items-center gap-1.5">
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								Releases containing any of these keywords will be skipped.
							</p>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="space-y-2">
								<label for="ALLOWED_INDEXERS" class="block text-sm font-medium text-slate-300">Allowed Indexers</label>
								<input
									type="text"
									id="ALLOWED_INDEXERS"
									name="ALLOWED_INDEXERS"
									class="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-slate-200 text-sm focus:ring-2 focus:ring-purple-500/50 outline-none transition-all"
									value={data.settings.ALLOWED_INDEXERS}
								/>
								<p class="text-[11px] text-slate-500 italic">Indexer names as they appear in Prowlarr.</p>
							</div>

							<div class="space-y-2">
								<label for="PLATFORM_FILTER" class="block text-sm font-medium text-slate-300">Default Platform</label>
								<select
									id="PLATFORM_FILTER"
									name="PLATFORM_FILTER"
									class="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-slate-200 text-sm focus:ring-2 focus:ring-purple-500/50 outline-none transition-all appearance-none cursor-pointer"
									value={data.settings.PLATFORM_FILTER}
								>
									<option value="Windows">Windows</option>
									<option value="Linux">Linux</option>
									<option value="macOS">macOS</option>
								</select>
							</div>
						</div>
					</div>
				</div>

				<div class="flex justify-end">
					<button
						type="submit"
						disabled={saving}
						class="px-8 py-3 bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-500 hover:to-purple-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-900/20 flex items-center gap-3 disabled:opacity-50"
					>
						{#if saving}
							<svg class="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							Saving...
						{:else}
							Save Changes
						{/if}
					</button>
				</div>
			</form>
		</div>
	{:else if activeTab === 'connection'}
		<div in:fade={{ duration: 200 }} class="space-y-6">
			<!-- Connection Info Alert -->
			<div class="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
				<svg class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<p class="text-sm text-amber-200/80">
					Connection settings are managed via <strong>.env</strong> or Docker environment variables. 
					Changes to these values require a restart of the application.
				</p>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<!-- Prowlarr -->
				<div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
					<div class="px-6 py-4 border-b border-slate-700 bg-orange-500/10 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="p-2 bg-orange-500/20 rounded-lg">
								<svg class="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
								</svg>
							</div>
							<h3 class="text-lg font-bold text-white">Prowlarr</h3>
						</div>
						<button
							onclick={() => testConnection('prowlarr')}
							disabled={testingProwlarr}
							class="px-3 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 text-xs font-bold rounded-lg border border-orange-500/30 transition-all flex items-center gap-2"
						>
							{#if testingProwlarr}
								<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{/if}
							Test
						</button>
					</div>
					<div class="p-6 space-y-4">
						<div class="space-y-1">
							<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">URL</span>
							<div class="text-sm text-slate-300 font-mono bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-700/50 truncate">
								{data.settings.PROWLARR_URL || 'Not Set'}
							</div>
						</div>
						<div class="space-y-1">
							<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">API Key</span>
							<div class="text-sm text-slate-300 font-mono bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-700/50">
								{data.settings.PROWLARR_API_KEY || 'Not Set'}
							</div>
						</div>
					</div>
				</div>

				<!-- qBittorrent -->
				<div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
					<div class="px-6 py-4 border-b border-slate-700 bg-blue-500/10 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="p-2 bg-blue-500/20 rounded-lg">
								<svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
								</svg>
							</div>
							<h3 class="text-lg font-bold text-white">qBittorrent</h3>
						</div>
						<button
							onclick={() => testConnection('qbit')}
							disabled={testingQbit}
							class="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-bold rounded-lg border border-blue-500/30 transition-all flex items-center gap-2"
						>
							{#if testingQbit}
								<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{/if}
							Test
						</button>
					</div>
					<div class="p-6 space-y-4">
						<div class="space-y-1">
							<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Host</span>
							<div class="text-sm text-slate-300 font-mono bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-700/50 truncate">
								{data.settings.QBIT_HOST || 'Not Set'}
							</div>
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-1">
								<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">User</span>
								<div class="text-sm text-slate-300 font-mono bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-700/50">
									{data.settings.QBIT_USERNAME || 'Not Set'}
								</div>
							</div>
							<div class="space-y-1">
								<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</span>
								<div class="text-sm text-slate-300 font-mono bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-700/50">
									{data.settings.QBIT_CATEGORY}
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- IGDB -->
				<div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
					<div class="px-6 py-4 border-b border-slate-700 bg-emerald-500/10 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="p-2 bg-emerald-500/20 rounded-lg">
								<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
								</svg>
							</div>
							<h3 class="text-lg font-bold text-white">IGDB</h3>
						</div>
						<button
							onclick={() => testConnection('igdb')}
							disabled={testingIgdb}
							class="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-bold rounded-lg border border-emerald-500/30 transition-all flex items-center gap-2"
						>
							{#if testingIgdb}
								<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{/if}
							Test
						</button>
					</div>
					<div class="p-6 space-y-4">
						<div class="space-y-1">
							<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Client ID</span>
							<div class="text-sm text-slate-300 font-mono bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-700/50 truncate">
								{data.settings.IGDB_CLIENT_ID || 'Not Set'}
							</div>
						</div>
						<div class="space-y-1">
							<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</span>
							<div class="text-sm {data.settings.IGDB_CLIENT_ID ? 'text-emerald-400' : 'text-slate-500'} font-bold">
								{data.settings.IGDB_CLIENT_ID ? '✓ Configured & Active' : '✗ Not Configured'}
							</div>
						</div>
					</div>
				</div>
				
				<!-- System Config -->
				<div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
					<div class="px-6 py-4 border-b border-slate-700 bg-slate-700/30">
						<div class="flex items-center gap-3">
							<div class="p-2 bg-slate-700/50 rounded-lg">
								<svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							</div>
							<h3 class="text-lg font-bold text-white">System</h3>
						</div>
					</div>
					<div class="p-6 space-y-4">
						<div class="space-y-1">
							<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sync Interval</span>
							<div class="text-sm text-slate-300 font-mono bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-700/50">
								Runs once on startup, then every {data.settings.CRON_INTERVAL_MINUTES} minutes
							</div>
						</div>
						<div class="space-y-1">
							<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Version</span>
							<div class="text-sm text-slate-300 font-mono">{APP_VERSION_LABEL}</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	{:else if activeTab === 'blacklist'}
		<div in:fade={{ duration: 200 }} class="space-y-6">
			<div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
				<div class="px-6 py-4 border-b border-slate-700 bg-red-500/10 flex items-center justify-between">
					<div>
						<h3 class="text-lg font-bold text-white">User Ignored Titles</h3>
						<p class="text-xs text-slate-400 mt-1">Releases you have manually excluded from search results.</p>
					</div>
				</div>
				<div class="overflow-x-auto">
					{#if data.ignoredReleases.length === 0}
						<div class="p-12 text-center text-slate-500 italic">No manually ignored titles</div>
					{:else}
						<table class="w-full text-left">
							<thead>
								<tr class="bg-slate-900/50 border-b border-slate-700">
									<th class="px-6 py-3 text-xs font-bold text-slate-400 uppercase">Game</th>
									<th class="px-6 py-3 text-xs font-bold text-slate-400 uppercase">Release Title</th>
									<th class="px-6 py-3 text-xs font-bold text-slate-400 uppercase">Ignored Date</th>
									<th class="px-6 py-3 text-xs font-bold text-slate-400 uppercase text-right">Action</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-700/50">
								{#each data.ignoredReleases as { ignored, gameTitle }}
									<tr class="hover:bg-slate-700/30 transition-colors group">
										<td class="px-6 py-4">
											<span class="text-sm font-bold text-purple-400">{gameTitle}</span>
										</td>
										<td class="px-6 py-4">
											<div class="text-xs text-slate-300 font-mono max-w-md truncate" title={ignored.releaseTitle}>
												{ignored.releaseTitle}
											</div>
										</td>
										<td class="px-6 py-4">
											<span class="text-xs text-slate-500">{new Date(ignored.ignoredAt).toLocaleDateString()}</span>
										</td>
										<td class="px-6 py-4 text-right">
											<button
												onclick={() => restoreRelease(ignored.id)}
												class="p-2 text-slate-500 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-all"
												title="Restore this release"
											>
												<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
												</svg>
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			</div>
		</div>
	{:else if activeTab === 'system'}
		<div in:fade={{ duration: 200 }} class="space-y-6">
			<!-- Indexer Stats -->
			<div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
				<div class="px-6 py-4 border-b border-slate-700 bg-indigo-500/10 flex items-center gap-3">
					<div class="p-2 bg-indigo-500/20 rounded-lg">
						<svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
						</svg>
					</div>
					<h3 class="text-lg font-bold text-white">Indexer Statistics</h3>
				</div>
				<div class="p-6">
					{#if data.stats.length === 0}
						<p class="text-slate-500 text-sm text-center py-4 italic">No release data found yet.</p>
					{:else}
						<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
							{#each data.stats as stat}
								<div class="bg-slate-900/50 border border-slate-700/50 p-4 rounded-xl flex items-center justify-between">
									<div class="min-w-0">
										<div class="text-[10px] text-slate-500 uppercase font-bold tracking-wider truncate">{stat.indexer}</div>
										<div class="text-xl font-bold text-white mt-1">{stat.count}</div>
									</div>
									<div class="w-2 h-8 bg-indigo-500/20 rounded-full overflow-hidden shrink-0">
										<div 
											class="bg-indigo-500 w-full rounded-full transition-all duration-1000" 
											style="height: {Math.min(100, (stat.count / Math.max(...data.stats.map(s => s.count))) * 100)}%"
										></div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- Logs Viewer -->
			<div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl h-[600px] flex flex-col">
				<div class="px-6 py-4 border-b border-slate-700 bg-slate-700/30 flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div class="p-2 bg-slate-700/50 rounded-lg">
							<svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
							</svg>
						</div>
						<h3 class="text-lg font-bold text-white">System Logs</h3>
					</div>
					<div class="flex gap-2">
						<select
							bind:value={selectedLog}
							onchange={() => selectedLog && loadLogContent(selectedLog)}
							class="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:ring-2 focus:ring-purple-500/50 outline-none transition-all cursor-pointer"
						>
							{#each logFiles as file}
								<option value={file}>{file}</option>
							{/each}
						</select>
						<button
							onclick={() => selectedLog && loadLogContent(selectedLog)}
							class="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-all"
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
								class="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-white text-xs font-bold flex items-center gap-2 transition-all shadow-lg shadow-purple-900/20"
								title="Download log file"
							>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
								</svg>
								Download
							</a>
						{/if}
					</div>
				</div>

				<div class="flex-1 overflow-auto p-4 bg-slate-950/50 font-mono text-[11px] leading-relaxed">
					{#if loadingLogs}
						<div class="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
							<svg class="w-8 h-8 animate-spin text-purple-500/50" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							<span>Loading logs...</span>
						</div>
					{:else if logContent.length === 0}
						<div class="flex items-center justify-center h-full text-slate-500 italic">No logs found in this file</div>
					{:else}
						<div class="space-y-0.5">
							{#each logContent as line}
								<div class="hover:bg-white/5 px-2 py-0.5 rounded flex gap-4 transition-colors">
									<span class="text-slate-500 shrink-0">{new Date(line.timestamp).toLocaleTimeString()}</span>
									<span class="shrink-0 w-16 font-bold uppercase
										{line.level === 'info' ? 'text-blue-400' : 
										 line.level === 'error' ? 'text-red-400' : 
										 line.level === 'warn' ? 'text-amber-400' : 'text-slate-400'}">
										[{line.level}]
									</span>
									<span class="text-slate-300 break-all whitespace-pre-wrap">{line.message}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
