<script lang="ts">
	import type { PageData } from './$types.js';
	import type { ScanLogDetails, ActionFeedback, ApiResponse } from '$lib/types.js';
	import { toastStore } from '$lib/stores/toast.js';
	import { fade, slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';

	let { data }: { data: PageData } = $props();
	
	// Local reactive state
	let updates = $state<PageData['updates']>([]);
	let stats = $state<PageData['stats']>({ totalGames: 0, monitoredGames: 0, pendingUpdates: 0 });
	let logs = $state<PageData['logs']>([]);

	$effect(() => {
		updates = data.updates;
		stats = data.stats;
		logs = data.logs;
	});
	
	let actionFeedback = $state<Record<number, ActionFeedback>>({});
	let showLogDetail = $state<number | null>(null);
	let logDetail = $state<ScanLogDetails | null>(null);
	let loadingLog = $state(false);
	let resettingGame = $state<number | null>(null);
	
	// Release expansion state
	let expandedGames = $state<Record<number, boolean>>({});

	async function resetGameScan(gameId: number) {
		resettingGame = gameId;
		try {
			toastStore.info('Searching for releases...', 'Rescan');
			const resp = await fetch(`/api/games/${gameId}/reset-scan`, { method: 'POST' });
			const result = await resp.json();
			if (result.success) {
				toastStore.success(`Found ${result.added || 0} new release(s)`, 'Rescan Complete');
				setTimeout(() => window.location.reload(), 1500);
			} else {
				toastStore.error(result.error || 'Rescan failed');
			}
		} catch {
			toastStore.error('Network error');
		} finally {
			resettingGame = null;
		}
	}

	async function releaseAction(releaseId: number, action: string, gameId: number) {
		// Set loading state
		actionFeedback[releaseId] = {
			type: 'loading',
			message: 'Processing...'
		};

		try {
			const resp = await fetch(`/api/releases/${releaseId}/${action}`, { method: 'POST' });
			const result: ApiResponse = await resp.json();

			if (result.success) {
				const successMsg = action === 'download' ? 'Sent to qBittorrent' : action === 'confirm' ? 'Version confirmed' : 'Release ignored';
				toastStore.success(successMsg);
				
				actionFeedback[releaseId] = {
					type: 'success',
					message: action === 'download' ? '✓ Sent' : action === 'confirm' ? '✓ Done' : '✓ Ignored'
				};
				
				// Optimistically update UI
				setTimeout(() => {
					if (action === 'download' || action === 'confirm') {
						// These actions remove all releases for this game in the backend
						const removedCount = updates.find(u => u.game.id === gameId)?.releases.length || 0;
						updates = updates.filter(u => u.game.id !== gameId);
						stats.pendingUpdates = Math.max(0, stats.pendingUpdates - removedCount);
					} else {
						// Ignore only removes one release
						updates = updates.map(u => {
							if (u.game.id === gameId) {
								return {
									...u,
									releases: u.releases.filter(r => r.id !== releaseId)
								};
							}
							return u;
						}).filter(u => u.releases.length > 0);
						stats.pendingUpdates = Math.max(0, stats.pendingUpdates - 1);
					}
					
					// Clear feedback
					delete actionFeedback[releaseId];
					actionFeedback = { ...actionFeedback };
				}, 800);
			} else {
				toastStore.error(result.error || 'Action failed');
				actionFeedback[releaseId] = {
					type: 'error',
					message: 'Failed'
				};
			}
		} catch (error) {
			toastStore.error('Network error');
			actionFeedback[releaseId] = { 
				type: 'error', 
				message: 'Error' 
			};
		}

		// Clear feedback after 3 seconds on error
		if (actionFeedback[releaseId]?.type === 'error') {
			setTimeout(() => {
				if (actionFeedback[releaseId]) {
					delete actionFeedback[releaseId];
					actionFeedback = { ...actionFeedback };
				}
			}, 3000);
		}
	}

	async function loadLogDetails(logId: number) {
		showLogDetail = logId;
		loadingLog = true;
		try {
			const resp = await fetch(`/api/scan/${logId}/details`);
			if (resp.ok) {
				logDetail = await resp.json();
			} else {
				logDetail = null;
			}
		} catch (error) {
			console.error('Failed to load log details:', error);
			logDetail = null;
		} finally {
			loadingLog = false;
		}
	}
	
	function closeLogModal() {
		showLogDetail = null;
		logDetail = null;
	}
	
	// Keyboard shortcuts
	$effect(() => {
		function handleKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape' && showLogDetail !== null) {
				closeLogModal();
			}
		}
		
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});
</script>

<svelte:head>
	<title>Dashboard - Repackarr</title>
</svelte:head>

<div class="p-6 space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-bold text-white">Dashboard</h2>
	</div>

	<!-- Stats Cards -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
		<div class="bg-slate-800 rounded-xl border border-slate-700 p-5">
			<div class="text-sm text-slate-400 mb-1">Total Games</div>
			<div class="text-3xl font-bold text-white">{stats.totalGames}</div>
		</div>
		<div class="bg-slate-800 rounded-xl border border-slate-700 p-5">
			<div class="text-sm text-slate-400 mb-1">Monitored</div>
			<div class="text-3xl font-bold text-emerald-400">{stats.monitoredGames}</div>
		</div>
		<div class="bg-slate-800 rounded-xl border border-slate-700 p-5">
			<div class="text-sm text-slate-400 mb-1">Pending Updates</div>
			<div class="text-3xl font-bold text-amber-400">{stats.pendingUpdates}</div>
		</div>
	</div>

	<!-- Pending Updates -->
	<div class="bg-slate-800 rounded-xl border border-slate-700">
		<div class="px-5 py-4 border-b border-slate-700">
			<h3 class="text-lg font-semibold text-white">Pending Updates</h3>
		</div>

		{#if updates.length === 0}
			<div class="p-12 text-center">
				<div class="flex flex-col items-center gap-4 text-slate-400">
					<svg class="w-20 h-20 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<div>
						<p class="text-xl font-semibold text-white">All up to date!</p>
						<p class="text-sm mt-2">No pending updates found. Your games are current.</p>
						{#if stats.totalGames === 0}
							<a href="/library" class="inline-block mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors">
								Add Your First Game
							</a>
						{/if}
					</div>
				</div>
			</div>
		{:else}
			<div class="divide-y divide-slate-700">
				{#each updates as { game, releases } (game.id)}
					{@const visibleReleases = expandedGames[game.id] ? releases : releases.slice(0, 5)}
					<div class="p-4" animate:flip={{ duration: 300 }} out:slide>
						<div class="flex items-center gap-3 mb-3">
							{#if game.coverUrl}
								<img
									src={game.coverUrl}
									alt={game.title}
									class="w-10 h-14 rounded object-cover"
								/>
							{/if}
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 min-w-0">
									<h4 class="font-semibold text-white truncate min-w-0">{game.title}</h4>
									{#if game.steamAppId}
										<a
											href="https://steamdb.info/app/{game.steamAppId}/patchnotes/"
											target="_blank"
											rel="noopener noreferrer"
											class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-[10px] font-semibold text-emerald-300 hover:text-emerald-200 transition"
											title="View patch notes on SteamDB"
										>
											Patch Notes
										</a>
									{/if}
								</div>
								<span
									class="text-xs text-slate-400"
									title={game.currentVersion && game.currentVersionDate !== '1970-01-01T00:00:00.000Z'
										? `This value is detected from qBittorrent sync or set with the Installed action.\nLocal version: v${game.currentVersion}\nLast detected: ${new Date(game.currentVersionDate).toLocaleString()}`
										: 'No local version has been detected yet.\nThis game may be manually tracked or not synced from qBittorrent yet.'}
								>
									Local version:
									{#if game.currentVersion && game.currentVersionDate !== '1970-01-01T00:00:00.000Z'}
										<span class="mx-1">v{game.currentVersion}</span>
										• Last detected: {new Date(game.currentVersionDate).toLocaleDateString()}
									{:else}
										<span class="mx-1">Not detected</span>
									{/if}
								</span>
							</div>
							<button
								onclick={() => resetGameScan(game.id)}
								disabled={resettingGame === game.id}
								class="p-2 bg-slate-700/50 hover:bg-purple-600/30 text-slate-400 hover:text-purple-400 rounded-lg transition-all disabled:opacity-50"
								title="Force rescan for this game"
							>
								<svg class="w-4 h-4 {resettingGame === game.id ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
								</svg>
							</button>
						</div>

						<div class="space-y-2">
							{#each visibleReleases as release (release.id)}
								<div
									class="flex items-center justify-between bg-slate-700/50 rounded-lg px-3 py-2"
									animate:flip={{ duration: 300 }}
									out:fade
								>
									<div class="flex-1 min-w-0">
										{#if release.infoUrl}
											<a 
												href={release.infoUrl} 
												target="_blank" 
												rel="noopener noreferrer"
												class="text-sm text-slate-200 hover:text-emerald-400 truncate transition-colors block"
												title={release.rawTitle}
											>
												{release.rawTitle}
											</a>
										{:else}
											<p class="text-sm text-slate-200 truncate" title={release.rawTitle}>
												{release.rawTitle}
											</p>
										{/if}
										<p class="text-xs text-slate-400">
											{release.indexer} • {release.size || '?'} •
											{new Date(release.uploadDate).toLocaleDateString()}
											• {release.seeders ?? '?'} seed{release.seeders === 1 ? '' : 's'}
											• {release.leechers ?? '?'} leecher{release.leechers === 1 ? '' : 's'}
											{#if release.parsedVersion}
												• v{release.parsedVersion}
											{/if}
											{#if release.recommendationTier === 'high'}
												<span
													class="ml-2 inline-flex items-center px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/15 text-[10px] font-semibold text-emerald-300"
													title={`${release.recommendationReason || 'Scored recommendation'} • Score ${release.recommendationScore} • Version ${release.versionState}`}
												>
													Recommended
												</span>
											{:else if release.recommendationTier === 'medium'}
												<span
													class="ml-2 inline-flex items-center px-1.5 py-0.5 rounded border border-blue-500/40 bg-blue-500/15 text-[10px] font-semibold text-blue-300"
													title={`${release.recommendationReason || 'Scored recommendation'} • Score ${release.recommendationScore} • Version ${release.versionState}`}
												>
													Good Match
												</span>
											{/if}
										</p>
									</div>
									<div class="flex gap-1.5 ml-3 shrink-0">
									{#if actionFeedback[release.id]}
										<span
											class="text-xs font-bold {actionFeedback[release.id].type === 'success'
												? 'text-emerald-400'
												: actionFeedback[release.id].type === 'loading'
												? 'text-blue-400 animate-pulse'
												: 'text-red-400'}"
										>
											{actionFeedback[release.id].message}
										</span>
									{:else}
										{#if release.infoUrl || release.magnetUrl}
											<button
												onclick={() => releaseAction(release.id, 'download', game.id)}
												class="group relative px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white text-xs font-medium rounded-lg transition-all shadow-md hover:shadow-emerald-500/50 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
												title="Send to qBittorrent"
												disabled={actionFeedback[release.id]?.type === 'loading'}
											>
												<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
												</svg>
												Download
											</button>
										{/if}
										<button
											onclick={() => releaseAction(release.id, 'confirm', game.id)}
											class="group relative px-3 py-1.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white text-xs font-medium rounded-lg transition-all shadow-md hover:shadow-blue-500/50 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
											title="Mark as you have this version"
											disabled={actionFeedback[release.id]?.type === 'loading'}
										>
											<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
											</svg>
											Installed
										</button>
										<button
											onclick={() => releaseAction(release.id, 'ignore', game.id)}
											class="group relative px-3 py-1.5 bg-gradient-to-r from-red-600/80 to-red-700/80 hover:from-red-600 hover:to-red-700 text-white text-xs font-medium rounded-lg transition-all shadow-md hover:shadow-red-500/30 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
											title="Permanently ignore this specific release"
											disabled={actionFeedback[release.id]?.type === 'loading'}
										>
											<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
											</svg>
											Ignore
										</button>
									{/if}
								</div>
								</div>
							{/each}

							{#if releases.length > 5}
								<button
									onclick={() => expandedGames[game.id] = !expandedGames[game.id]}
									class="w-full py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors flex items-center justify-center gap-2"
								>
									{#if expandedGames[game.id]}
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
										</svg>
										Show Less
									{:else}
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
										</svg>
										Show {releases.length - 5} More Releases
									{/if}
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Activity Log -->
	<div class="bg-slate-800 rounded-xl border border-slate-700">
		<div class="px-5 py-4 border-b border-slate-700">
			<h3 class="text-lg font-semibold text-white">Recent Activity</h3>
		</div>

		{#if logs.length === 0}
			<div class="p-8 text-center text-slate-400">No scan history yet</div>
		{:else}
			<div class="divide-y divide-slate-700">
				{#each logs as log}
					<button
						class="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors text-left"
						onclick={() => loadLogDetails(log.id)}
					>
						<div>
							<span
								class="inline-block w-2 h-2 rounded-full mr-2 {log.status === 'success'
									? 'bg-emerald-400'
									: 'bg-amber-400'}"
							></span>
							<span class="text-sm text-slate-300">
								{new Date(log.startedAt).toLocaleString()} •
								{log.gamesProcessed} games •
								{log.updatesFound} updates found
							</span>
						</div>
						<span class="text-xs text-slate-400">{log.durationSeconds.toFixed(1)}s</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- Log Detail Modal -->
{#if showLogDetail !== null}
	<div
		class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) {
				closeLogModal();
			}
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				closeLogModal();
			}
		}}
		role="dialog"
		aria-modal="true"
		aria-labelledby="log-detail-title"
		tabindex="-1"
	>
		<div class="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
			<div class="px-6 py-4 border-b border-slate-700 flex items-center justify-between sticky top-0 bg-slate-800 z-10">
				<h3 id="log-detail-title" class="text-lg font-bold text-white">Scan Details</h3>
				<button
					onclick={closeLogModal}
					class="p-1 hover:bg-slate-700 rounded-lg transition"
					aria-label="Close dialog"
				>
					<svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="p-6 space-y-4">
				{#if loadingLog}
					<div class="text-center text-slate-400 py-8">
						<div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
						<p class="mt-2">Loading...</p>
					</div>
				{:else if !logDetail}
					<div class="text-center text-slate-400 py-8">Failed to load scan details</div>
				{:else}
					<!-- Log Info -->
					<div class="grid grid-cols-2 gap-3">
						<div class="bg-slate-700/50 rounded-lg p-3">
							<div class="text-xs text-slate-400">Status</div>
							<div class="text-sm font-medium {logDetail.log.status === 'success' ? 'text-emerald-400' : 'text-amber-400'}">{logDetail.log.status}</div>
						</div>
						<div class="bg-slate-700/50 rounded-lg p-3">
							<div class="text-xs text-slate-400">Duration</div>
							<div class="text-sm font-medium text-white">{logDetail.log.durationSeconds.toFixed(1)}s</div>
						</div>
						<div class="bg-slate-700/50 rounded-lg p-3">
							<div class="text-xs text-slate-400">Games Processed</div>
							<div class="text-sm font-medium text-white">{logDetail.log.gamesProcessed}</div>
						</div>
						<div class="bg-slate-700/50 rounded-lg p-3">
							<div class="text-xs text-slate-400">Updates Found</div>
							<div class="text-sm font-medium text-white">{logDetail.log.updatesFound}</div>
						</div>
					</div>

					<!-- Errors -->
					{#if logDetail.details?.errors?.length}
						<div>
							<h4 class="text-sm font-semibold text-red-400 mb-2">Errors</h4>
							<div class="space-y-1">
								{#each logDetail.details.errors as err}
									<div class="text-xs text-red-300 bg-red-500/10 rounded px-3 py-2">{err}</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Skip Summary -->
					{#if logDetail.skipSummary?.length}
						<div>
							<h4 class="text-sm font-semibold text-slate-300 mb-2">Skipped Releases by Game</h4>
							<div class="space-y-2">
								{#each logDetail.skipSummary as gameSummary}
									<div class="bg-slate-700/30 rounded-lg p-3">
										<div class="flex items-center justify-between mb-1">
											<span class="text-sm font-medium text-white">{gameSummary.game}</span>
											<span class="text-xs text-slate-400">{gameSummary.items?.length || 0} skipped</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}
