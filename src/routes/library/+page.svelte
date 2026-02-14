<script lang="ts">
	import type { PageData } from './$types.js';
	import type { SkipInfo } from '$lib/types.js';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { toastStore } from '$lib/stores/toast.js';
	import { goto } from '$app/navigation';

	let { data }: { data: PageData } = $props();
	
	// Modal states
	let confirmModal = $state<{
		show: boolean;
		title: string;
		message: string;
		type: 'danger' | 'warning' | 'primary';
		confirmText?: string;
		onConfirm: () => void;
	} | null>(null);

	let showAddModal = $state(false);
	let editGameId = $state<number | null>(null);
	let addingGame = $state(false);
	// Removed local addMessage state
	let resettingGame = $state<number | null>(null);
	// Removed local resetMessage state
	let showSkippedFor = $state<number | null>(null);
	let skippedReleases = $state<SkipInfo[]>([]);
	let loadingSkipped = $state(false);
	
	// Add game form state
	let gameTitle = $state('');
	let searchQuery = $state('');
	let mode = $state<'download_now' | 'track_only'>('download_now');
	let platformFilter = $state('Windows');
	let suggestions = $state<Array<{ name: string; display: string }>>([]);
	let showSuggestions = $state(false);
	let autocompleteTimeout: ReturnType<typeof setTimeout> | null = null;
	let abortController: AbortController | null = null;
	const localCache = new Map<string, Array<{ name: string; display: string }>>();
	let isSearching = $state(false);
	
	// Edit game autocomplete state
	let editSuggestions = $state<Array<{ name: string; display: string }>>([]);
	let showEditSuggestions = $state(false);
	let editAutocompleteTimeout: ReturnType<typeof setTimeout> | null = null;
	let editAbortController: AbortController | null = null;
	const editLocalCache = new Map<string, Array<{ name: string; display: string }>>();
	let isEditingSearching = $state(false);

	// qBittorrent status polling
	let qbitStatus = $state<Record<number, {
		progress: number;
		state: string;
		dlspeed: string;
		eta: string;
		rawEta: number;
	}>>({});

	async function fetchQbitStatus() {
		try {
			const resp = await fetch('/api/qbit/status');
			if (resp.ok) {
				qbitStatus = await resp.json();
			}
		} catch (error) {
			console.error('Failed to fetch qbit status:', error);
		}
	}

	$effect(() => {
		fetchQbitStatus();
		const interval = setInterval(fetchQbitStatus, 5000);
		return () => clearInterval(interval);
	});
	
	// Helper functions for modal close
	function closeAddModal() {
		showAddModal = false;
		gameTitle = '';
		searchQuery = '';
		suggestions = [];
	}

	function closeSkippedModal() {
		showSkippedFor = null;
		skippedReleases = [];
	}
	
	// Search & Filter state
	let librarySearchQuery = $state('');
	let filterStatus = $state<'all' | 'monitored' | 'unmonitored' | 'updates'>('all');
	
	// Filtered games
	let filteredGames = $derived.by(() => {
		let games = data.games;
		
		// Apply search filter
		if (librarySearchQuery.trim()) {
			const query = librarySearchQuery.toLowerCase();
			games = games.filter(g => 
				g.title.toLowerCase().includes(query) ||
				g.searchQuery.toLowerCase().includes(query)
			);
		}
		
		// Apply status filter
		if (filterStatus === 'monitored') {
			games = games.filter(g => g.status === 'monitored');
		} else if (filterStatus === 'unmonitored') {
			games = games.filter(g => g.status !== 'monitored');
		} else if (filterStatus === 'updates') {
			games = games.filter(g => g.updateCount > 0);
		}
		
		return games;
	});
	
	// Keyboard shortcuts
	$effect(() => {
		function handleKeydown(e: KeyboardEvent) {
			// Esc to close modals
			if (e.key === 'Escape') {
				if (showAddModal) {
					showAddModal = false;
					gameTitle = '';
					searchQuery = '';
				}
				if (editGameId) {
					editGameId = null;
				}
				if (showSkippedFor !== null) {
					showSkippedFor = null;
					skippedReleases = [];
				}
			}
		}
		
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	function getEditGame() {
		if (!editGameId) return null;
		return data.games.find((g) => g.id === editGameId) || null;
	}

	async function handleAddGame(e: Event) {
		e.preventDefault();
		if (addingGame) return; // Prevent double submission
		
		addingGame = true;

		const formData = new FormData(e.target as HTMLFormElement);
		const searchNow = formData.get('search_now') === 'on';
		
		try {
			const resp = await fetch('?/addGame', {
				method: 'POST',
				body: formData
			});

			const result = await resp.json();
			
			if (result.type === 'success') {
				const foundCount = result.data?.foundReleases || 0;
				const redirectToDashboard = result.data?.redirectToDashboard;
				const message = result.data?.message;
				
				if (redirectToDashboard) {
					const successMsg = foundCount > 0 
						? `Game added! Found ${foundCount} releases. You can see them on the Dashboard.`
						: 'Game added! Searching for releases in the background...';
					
					toastStore.success(successMsg, 'Add Game');
					setTimeout(() => goto('/'), 1500);
				} else {
					toastStore.info(message || 'Game added to monitored list.', 'Add Game');
					showAddModal = false;
					setTimeout(() => window.location.reload(), 1500);
				}
				
				// Clear form
				gameTitle = '';
				searchQuery = '';
				platformFilter = 'Windows';
			} else if (result.type === 'failure') {
				toastStore.error(result.data?.error || 'Failed to add game');
				addingGame = false; // Re-enable button on error
			}
		} catch (error) {
			toastStore.error('Network error');
			addingGame = false; // Re-enable button on error
		}
	}

	async function handleDeleteGame(gameId: number, gameName: string) {
		confirmModal = {
			show: true,
			title: 'Delete Game',
			message: `Are you sure you want to delete "${gameName}" and all its releases? This action cannot be undone.`,
			type: 'danger',
			confirmText: 'Delete',
			onConfirm: async () => {
				confirmModal = null;
				try {
					const formData = new FormData();
					formData.append('id', gameId.toString());
					
					const resp = await fetch('?/deleteGame', {
						method: 'POST',
						body: formData
					});
					
								const result = await resp.json();
								if (result.type === 'success') {
									window.location.href = '/library'; // Clean redirect
								}
							} catch (error) {
								console.error('Delete error:', error);
								toastStore.error('Failed to delete game');
							}
						}		};
	}

	async function handleToggleMonitor(gameId: number) {
		try {
			const formData = new FormData();
			formData.append('id', gameId.toString());
			
			const resp = await fetch('?/toggleMonitor', {
				method: 'POST',
				body: formData
			});
			
			const result = await resp.json();
			if (result.type === 'success') {
				window.location.href = '/library'; // Clean redirect
			}
		} catch (error) {
			console.error('Toggle error:', error);
		}
	}

	async function handleTitleInput(e: Event) {
		const input = e.target as HTMLInputElement;
		gameTitle = input.value;
		const query = gameTitle.toLowerCase();
		
		if (gameTitle) {
			searchQuery = gameTitle.toLowerCase();
		}

		if (autocompleteTimeout) clearTimeout(autocompleteTimeout);
		
		if (gameTitle.length < 2) {
			suggestions = [];
			showSuggestions = false;
			return;
		}

		// --- SMART PREDICTIVE FILTERING ---
		// Find the closest prefix in our cache to show something INSTANTLY
		let bestPrefix = "";
		for (const key of localCache.keys()) {
			const [keyQuery, keyPlatform] = key.split(':');
			if (keyPlatform === platformFilter && query.startsWith(keyQuery)) {
				if (keyQuery.length > bestPrefix.length) bestPrefix = keyQuery;
			}
		}

		if (bestPrefix) {
			const prefixResults = localCache.get(`${bestPrefix}:${platformFilter}`) || [];
			const filtered = prefixResults.filter(s => s.name.toLowerCase().includes(query));
			if (filtered.length > 0) {
				suggestions = filtered;
				showSuggestions = true;
				// If we have an exact match in cache, we can skip the network call
				if (localCache.has(`${query}:${platformFilter}`)) return;
			}
		}
		// ----------------------------------

		autocompleteTimeout = setTimeout(async () => {
			if (abortController) abortController.abort();
			abortController = new AbortController();
			isSearching = true;

			try {
				const cacheKey = `${query}:${platformFilter}`;
				const resp = await fetch(`/api/games/autocomplete?q=${encodeURIComponent(gameTitle)}&platform=${encodeURIComponent(platformFilter)}`, {
					signal: abortController.signal
				});
				const data = await resp.json();
				const newSuggestions = data.suggestions || [];
				
				suggestions = newSuggestions;
				if (newSuggestions.length > 0) {
					localCache.set(cacheKey, newSuggestions);
				}
				showSuggestions = suggestions.length > 0;
			} catch (err: any) {
				if (err.name !== 'AbortError') console.error('Autocomplete error:', err);
			} finally {
				isSearching = false;
			}
		}, 200);
	}

	function selectSuggestion(suggestion: { name: string; display: string }) {
		gameTitle = suggestion.name;
		searchQuery = suggestion.name.toLowerCase();
		suggestions = [];
		showSuggestions = false;
	}

	async function handleEditTitleInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const title = input.value;
		const query = title.toLowerCase();
		
		if (editAutocompleteTimeout) clearTimeout(editAutocompleteTimeout);
		
		if (title.length < 2) {
			editSuggestions = [];
			showEditSuggestions = false;
			return;
		}

		// --- SMART PREDICTIVE FILTERING FOR EDIT ---
		let bestPrefix = "";
		for (const key of editLocalCache.keys()) {
			if (query.startsWith(key)) {
				if (key.length > bestPrefix.length) bestPrefix = key;
			}
		}

		if (bestPrefix) {
			const prefixResults = editLocalCache.get(bestPrefix) || [];
			const filtered = prefixResults.filter(s => s.name.toLowerCase().includes(query));
			if (filtered.length > 0) {
				editSuggestions = filtered;
				showEditSuggestions = true;
				if (editLocalCache.has(query)) return;
			}
		}
		// -------------------------------------------

		editAutocompleteTimeout = setTimeout(async () => {
			if (editAbortController) editAbortController.abort();
			editAbortController = new AbortController();
			isEditingSearching = true;

			try {
				const resp = await fetch(`/api/games/autocomplete?q=${encodeURIComponent(title)}`, {
					signal: editAbortController.signal
				});
				const data = await resp.json();
				const newSuggestions = data.suggestions || [];
				
				editSuggestions = newSuggestions;
				if (newSuggestions.length > 0) {
					editLocalCache.set(query, newSuggestions);
				}
				showEditSuggestions = editSuggestions.length > 0;
			} catch (err: any) {
				if (err.name !== 'AbortError') console.error('Autocomplete error:', err);
			} finally {
				isEditingSearching = false;
			}
		}, 200);
	}

	function selectEditSuggestion(suggestion: { name: string; display: string }) {
		const titleInput = document.getElementById('edit_title') as HTMLInputElement;
		const queryInput = document.getElementById('edit_query') as HTMLInputElement;
		if (titleInput) titleInput.value = suggestion.name;
		if (queryInput) queryInput.value = suggestion.name.toLowerCase();
		editSuggestions = [];
		showEditSuggestions = false;
	}

	async function resetGameScan(gameId: number) {
		resettingGame = gameId;
		try {
			const resp = await fetch(`/api/games/${gameId}/reset-scan`, { method: 'POST' });
			const result = await resp.json();
			if (result.success) {
				toastStore.success(`Rescan complete: ${result.added || 0} new release(s) found`, 'Sync Library');
				setTimeout(() => window.location.reload(), 2000);
			} else {
				toastStore.error(result.error || 'Rescan failed. Please try again.', 'Sync Library');
			}
		} catch {
			toastStore.error('Network error. Check your connection.', 'Sync Library');
		} finally {
			resettingGame = null;
		}
	}

	async function loadSkippedReleases(gameId: number) {
		showSkippedFor = gameId;
		loadingSkipped = true;
		skippedReleases = [];
		try {
			const resp = await fetch(`/api/games/${gameId}/skipped`);
			const result = await resp.json();
			skippedReleases = result.skipped || [];
		} catch {
			skippedReleases = [];
		} finally {
			loadingSkipped = false;
		}
	}

	async function forceAddRelease(skip: SkipInfo) {
		if (!showSkippedFor) return;
		
		// Show immediate feedback
		toastStore.info('Adding release...', 'Restore Release');
		
		try {
			const resp = await fetch('/api/releases/force-add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					gameId: showSkippedFor,
					title: skip.title,
					indexer: skip.indexer,
					magnetUrl: skip.magnetUrl,
					infoUrl: skip.infoUrl,
					size: skip.size,
					date: skip.date
				})
			});
			
			const result = await resp.json();
			if (result.success) {
				// Show success feedback
				toastStore.success('Release restored successfully!', 'Restore Release');
				// Remove from skipped list
				skippedReleases = skippedReleases.filter(r => r.title !== skip.title);
				setTimeout(() => {
					if (skippedReleases.length === 0) {
						showSkippedFor = null;
					}
					window.location.reload();
				}, 1500);
			} else {
				toastStore.error(result.error || 'Failed to restore release', 'Restore Release');
			}
		} catch {
			toastStore.error('Network error. Check your connection.', 'Restore Release');
		}
	}

	async function handleEditGame(e: Event) {
		e.preventDefault();
		
		const formData = new FormData(e.target as HTMLFormElement);
		
		try {
			const resp = await fetch('?/updateGame', {
				method: 'POST',
				body: formData
			});
			
			const result = await resp.json();
			
			if (result.type === 'success') {
				toastStore.success('Game updated successfully!', 'Update Game');
				editGameId = null;
				setTimeout(() => {
					window.location.reload();
				}, 1500);
			} else {
				toastStore.error(result.data?.error || 'Failed to update game. Please try again.', 'Update Game');
			}
		} catch {
			toastStore.error('Network error. Check your connection.', 'Update Game');
		}
	}
</script>

<svelte:head>
	<title>Library - Repackarr</title>
</svelte:head>

<div class="p-6 space-y-6">

	<div class="flex items-center justify-between gap-4">
		<h2 class="text-2xl font-bold text-white">Game Library</h2>
		
		<div class="flex items-center gap-3 flex-1 max-w-2xl">
			<!-- Search Bar -->
			<div class="relative flex-1">
				<input
					type="text"
					bind:value={librarySearchQuery}
					placeholder="Search games..."
					class="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:border-purple-500 transition-colors"
				/>
				<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
			</div>
			
			<!-- Filter Dropdown -->
			<select
				bind:value={filterStatus}
				class="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 transition-colors cursor-pointer"
			>
				<option value="all">All Games</option>
				<option value="monitored">Monitored</option>
				<option value="unmonitored">Unmonitored</option>
				<option value="updates">Has Updates</option>
			</select>
		</div>
		
		<button
			onclick={() => (showAddModal = true)}
			class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
			</svg>
			Add Game
		</button>
	</div>

	<!-- Stats -->
	<div class="grid grid-cols-3 gap-4">
		<div class="bg-slate-800 rounded-xl border border-slate-700 p-4 text-center">
			<div class="text-2xl font-bold text-white">{data.stats.totalGames}</div>
			<div class="text-xs text-slate-400">Total</div>
		</div>
		<div class="bg-slate-800 rounded-xl border border-slate-700 p-4 text-center">
			<div class="text-2xl font-bold text-emerald-400">{data.stats.monitoredGames}</div>
			<div class="text-xs text-slate-400">Monitored</div>
		</div>
		<div class="bg-slate-800 rounded-xl border border-slate-700 p-4 text-center">
			<div class="text-2xl font-bold text-amber-400">{data.stats.pendingUpdates}</div>
			<div class="text-xs text-slate-400">Updates</div>
		</div>
	</div>

	<!-- Games Table -->
	<div class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
		{#if data.games.length === 0}
			<div class="p-8 text-center text-slate-400">
				<p class="text-lg">No games in library</p>
				<p class="text-sm mt-1">Add games manually or sync from qBittorrent</p>
			</div>
		{:else}
			<table class="w-full">
				<thead>
					<tr class="border-b border-slate-700 text-left">
						<th class="px-4 py-3 text-xs font-medium text-slate-400 uppercase">Game</th>
						<th class="px-4 py-3 text-xs font-medium text-slate-400 uppercase">Owned Version</th>
						<th class="px-4 py-3 text-xs font-medium text-slate-400 uppercase">Status</th>
						<th class="px-4 py-3 text-xs font-medium text-slate-400 uppercase">Updates</th>
						<th class="px-4 py-3 text-xs font-medium text-slate-400 uppercase">Links</th>
						<th class="px-4 py-3 text-xs font-medium text-slate-400 uppercase">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-700/50">
					{#if filteredGames.length === 0}
						<tr>
							<td colspan="6" class="px-4 py-16 text-center">
								<div class="flex flex-col items-center gap-4 text-slate-400">
									<svg class="w-16 h-16 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
									</svg>
									<div>
										<p class="text-lg font-medium">No games found</p>
										{#if librarySearchQuery || filterStatus !== 'all'}
											<p class="text-sm mt-1">Try adjusting your search or filters</p>
										{:else}
											<p class="text-sm mt-1">Add your first game to get started!</p>
										{/if}
									</div>
								</div>
							</td>
						</tr>
					{:else}
						{#each filteredGames as game}
						<tr class="hover:bg-slate-700/30 transition-colors">
							<td class="px-4 py-3">
								<div class="flex items-center gap-3">
									{#if game.coverUrl}
										<img
											src={game.coverUrl}
											alt={game.title}
											class="w-10 h-14 rounded object-cover shrink-0 border border-slate-600 shadow-lg"
											loading="lazy"
											onerror={(e) => { 
												const target = e.currentTarget as HTMLImageElement;
												target.style.display = 'none';
												const next = target.nextElementSibling as HTMLElement | null;
												if (next) next.style.display = 'flex';
											}}
										/>
										<div
											class="w-10 h-14 rounded bg-slate-700 items-center justify-center text-xs text-slate-500 shrink-0 hidden"
										>
											?
										</div>
									{:else}
										<div
											class="w-10 h-14 rounded bg-slate-700 flex items-center justify-center text-xs text-slate-500 shrink-0"
										>
											?
										</div>
									{/if}
									<div class="min-w-0">
										<div class="flex items-center gap-2 mb-1">
											<div class="font-medium text-white text-sm">{game.cleanTitle}</div>
											{#if game.qbitSyncedAt}
												<span class="px-1.5 py-0.5 text-[10px] font-semibold text-blue-300 bg-blue-500/20 rounded border border-blue-500/30" title="Synced from qBittorrent">qBit</span>
											{:else if game.isManual}
												<span class="px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 bg-slate-500/10 rounded border border-slate-500/20" title="Manually added, not linked to qBittorrent">Manual</span>
											{/if}
										</div>
										<div class="text-xs text-slate-400">{game.cleanSearchQuery}</div>

										{#if qbitStatus[game.id]}
											{@const status = qbitStatus[game.id]}
											{@const isDownloading = status.state === 'downloading' || status.state === 'stalledDL'}
											{@const isFinished = status.progress === 100 || status.state.includes('UP') || status.state === 'uploading'}
											{@const friendlyState = status.state
												.replace('stoppedDL', 'Paused')
												.replace('stoppedUP', 'Finished')
												.replace('downloading', 'Downloading')
												.replace('stalledDL', 'Stalled')
												.replace('uploading', 'Seeding')
												.replace('metaDL', 'Fetching Metadata')
												.replace(/_/g, ' ')}
											<div class="mt-2 w-48 group/progress">
												<div class="flex items-center justify-between text-[10px] mb-1">
													<span class="font-bold uppercase tracking-wider {isDownloading ? 'text-blue-400' : isFinished ? 'text-emerald-400' : 'text-slate-400'}">
														{friendlyState}
													</span>
													<span class="text-slate-300 font-mono">{status.progress}%</span>
												</div>
												<div class="h-1.5 w-full bg-slate-700/50 rounded-full overflow-hidden border border-slate-600/30">
													<div 
														class="h-full rounded-full transition-all duration-700 ease-out {isDownloading ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse' : isFinished ? 'bg-emerald-500' : 'bg-slate-500'}" 
														style="width: {status.progress}%"
													></div>
												</div>
												<div class="flex items-center justify-between text-[9px] mt-1.5 text-slate-500 font-semibold italic">
													{#if status.state === 'downloading'}
														<div class="flex items-center gap-1 text-blue-400/80">
															<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
															</svg>
															{status.dlspeed}
														</div>
														<span class="text-slate-400">ETA: {status.eta}</span>
													{:else if isFinished}
														<span class="text-emerald-500/70">Ready to play</span>
													{:else}
														<span>{status.dlspeed}</span>
													{/if}
												</div>
											</div>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-4 py-3">
								<div class="text-sm text-slate-200">
									{#if new Date(game.currentVersionDate).getFullYear() === 1970}
										<span class="text-slate-500">Not owned yet</span>
									{:else if game.currentVersion}
										v{game.currentVersion}
									{:else}
										v?
									{/if}
								</div>
								{#if new Date(game.currentVersionDate).getFullYear() !== 1970}
									<div class="text-xs text-slate-400">
										{new Date(game.currentVersionDate).toLocaleDateString()}
									</div>
								{/if}
							</td>
							<td class="px-4 py-3">
								<button
									onclick={() => handleToggleMonitor(game.id)}
									class="relative inline-flex items-center gap-2 group cursor-pointer"
									title="Click to {game.status === 'monitored' ? 'stop monitoring' : 'start monitoring'}"
								>
										<!-- Toggle Switch -->
										<div class="relative w-11 h-6 rounded-full transition-colors {game.status === 'monitored' ? 'bg-emerald-500' : 'bg-slate-600'}">
											<div class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform {game.status === 'monitored' ? 'translate-x-5' : 'translate-x-0'}"></div>
										</div>
										<!-- Label -->
										<span class="text-xs font-medium {game.status === 'monitored' ? 'text-emerald-400' : 'text-slate-400'} group-hover:text-white transition-colors">
											{game.status === 'monitored' ? 'Monitoring' : 'Not Monitoring'}
										</span>
									</button>
							</td>
							<td class="px-4 py-3">
								{#if game.updateCount > 0}
									<span
										class="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-xs rounded-full"
									>
										{game.updateCount}
									</span>
								{:else}
									<span class="text-xs text-slate-500">—</span>
								{/if}
							</td>
							<td class="px-4 py-3">
								<div class="grid grid-cols-3 gap-2">
									{#if game.sourceUrl}
										<a
											href={game.sourceUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex w-[7.5rem] justify-center items-center gap-1 px-2 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 hover:border-purple-500/50 text-purple-300 hover:text-purple-200 text-xs font-medium transition"
											title="Open source/forum page"
										>
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 4h6m0 0v6m0-6L10 14M5 6h5M5 10h5m-5 4h5m-7 4h14a2 2 0 002-2v-5a2 2 0 00-2-2h-1m-4 0H5a2 2 0 00-2 2v7a2 2 0 002 2z" />
											</svg>
											Source
										</a>
									{:else}
										<span
											class="inline-flex w-[7.5rem] justify-center items-center px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-900/30 text-slate-600 text-xs font-medium"
											title="No source/forum link available"
										>
											Source
										</span>
									{/if}
									{#if game.steamAppId}
										<a
											href="https://steamdb.info/app/{game.steamAppId}/patchnotes/"
											target="_blank"
											rel="noopener"
											class="inline-flex w-[7.5rem] justify-center items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-400 hover:text-emerald-300 text-xs font-medium transition"
											title="View patch notes on SteamDB"
										>
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
											</svg>
											Patch Notes
										</a>
									{:else}
										<span
											class="inline-flex w-[7.5rem] justify-center items-center px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-900/30 text-slate-600 text-xs font-medium"
											title="No Steam App ID available for patch notes"
										>
											Patch Notes
										</span>
									{/if}
									{#if game.steamAppId}
										<a
											href="https://store.steampowered.com/app/{game.steamAppId}"
											target="_blank"
											rel="noopener"
											class="inline-flex w-[7.5rem] justify-center items-center gap-1 px-2 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 hover:border-blue-500/50 text-blue-400 hover:text-blue-300 text-xs font-medium transition"
											title="Open Steam store page"
										>
											<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
												<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
											</svg>
											Steam
										</a>
									{:else}
										<span
											class="inline-flex w-[7.5rem] justify-center items-center px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-900/30 text-slate-600 text-xs font-medium"
											title="No Steam App ID available"
										>
											Steam
										</span>
									{/if}
								</div>
							</td>
							<td class="px-4 py-3">
								<div class="flex gap-1.5">
									<button
										onclick={() => (editGameId = game.id)}
										class="group px-2.5 py-1.5 bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 text-white text-xs font-medium rounded-lg transition-all shadow-md hover:shadow-slate-500/30 flex items-center gap-1.5"
										title="Edit game settings and search query"
									>
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
										</svg>
										Edit
									</button>
									<button
										onclick={() => {
											confirmModal = {
												show: true,
												title: 'Rescan Game',
												message: 'This will clear all current releases and re-search Prowlarr. Are you sure you want to continue?',
												type: 'warning',
												confirmText: 'Rescan',
												onConfirm: () => {
													confirmModal = null;
													resetGameScan(game.id);
												}
											};
										}}
										disabled={resettingGame === game.id}
										class="group px-2.5 py-1.5 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 disabled:from-purple-900 disabled:to-purple-950 text-white text-xs font-medium rounded-lg transition-all shadow-md hover:shadow-purple-500/50 disabled:shadow-none flex items-center gap-1.5 disabled:cursor-not-allowed"
										title="Clear releases and search again"
									>
										{#if resettingGame === game.id}
											<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
											</svg>
										{:else}
											<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
											</svg>
										{/if}
										Rescan
									</button>
									<button
										onclick={() => loadSkippedReleases(game.id)}
										class="group px-2.5 py-1.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white text-xs font-medium rounded-lg transition-all shadow-md hover:shadow-amber-500/50 flex items-center gap-1.5"
										title="View releases that were skipped by filters"
									>
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
										</svg>
										Skipped
									</button>
									<button
										onclick={() => handleDeleteGame(game.id, game.title)}
										class="group px-2.5 py-1.5 bg-gradient-to-r from-red-600/80 to-red-700/80 hover:from-red-600 hover:to-red-700 text-white text-xs font-medium rounded-lg transition-all shadow-md hover:shadow-red-500/50 flex items-center gap-1.5"
										title="Permanently delete this game"
									>
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
										</svg>
										Delete
									</button>
								</div>
							</td>
						</tr>
					{/each}
					{/if}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<!-- Add Game Modal -->
{#if showAddModal}
	<div
		class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) {
				closeAddModal();
			}
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				closeAddModal();
			}
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="bg-gradient-to-br from-slate-800/95 to-slate-900/95 backdrop-blur-xl rounded-2xl border border-slate-700/50 w-full max-w-lg shadow-2xl">
			<div class="p-6 border-b border-slate-700/50">
				<h3 class="text-xl font-bold text-white">Add Game</h3>
				<p class="text-sm text-slate-400 mt-1">Add a new game to your library</p>
			</div>
			
			<form 
				onsubmit={handleAddGame}
				class="p-6 space-y-5"
			>
				<!-- Platform Selection -->
				<div>
					<label for="platform_filter" class="block text-sm font-medium text-slate-300 mb-2">
						Platform
					</label>
					<div class="relative">
						<select
							id="platform_filter"
							name="platform_filter"
							bind:value={platformFilter}
							class="w-full px-4 py-3 pr-10 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all appearance-none cursor-pointer"
						>
							<option value="Windows">Windows</option>
							<option value="Linux">Linux</option>
							<option value="Windows,Linux">Windows + Linux</option>
						</select>
						<!-- Dropdown Arrow Icon -->
						<div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
							<svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
							</svg>
						</div>
					</div>
				</div>

				<!-- Title with Autocomplete -->
				<div>
					<label for="title" class="block text-sm font-medium text-slate-300 mb-2">
						Game Title
					</label>
					<div class="relative">
						<input
							type="text"
							id="title"
							name="title"
							bind:value={gameTitle}
							oninput={handleTitleInput}
							onfocus={() => showSuggestions = suggestions.length > 0}
							onblur={() => setTimeout(() => showSuggestions = false, 200)}
							required
							placeholder="e.g. Cyberpunk 2077, Baldur's Gate 3"
							autocomplete="off"
							class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all pr-10"
						/>
						
						<!-- Status Icon -->
						<div class="absolute right-3 top-1/2 -translate-y-1/2">
							{#if isSearching}
								<svg class="animate-spin h-5 w-5 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{:else if gameTitle.length >= 2 && suggestions.length > 0}
								<svg class="h-5 w-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
								</svg>
							{:else if gameTitle.length >= 2 && !isSearching}
								<svg class="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
								</svg>
							{/if}
						</div>

						{#if showSuggestions && suggestions.length > 0}
							<div class="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-64 overflow-y-auto">
								{#each suggestions as suggestion}
									<button
										type="button"
										onclick={() => selectSuggestion(suggestion)}
										class="w-full px-4 py-3 text-left hover:bg-slate-700/50 transition-colors border-b border-slate-700/30 last:border-0"
									>
										<div class="text-sm text-white font-medium">{suggestion.display}</div>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Search Query -->
				<div>
					<label for="search_query" class="block text-sm font-medium text-slate-300 mb-2">
						Search Query
					</label>
					<input
						type="text"
						id="search_query"
						name="search_query"
						bind:value={searchQuery}
						required
						placeholder="What to search on Prowlarr indexers"
						class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all"
					/>
					<p class="text-xs text-slate-500 mt-1.5">What to search on Prowlarr indexers</p>
				</div>

				<!-- Exclude Keywords -->
				<div>
					<label for="exclude_keywords" class="block text-sm font-medium text-slate-300 mb-2">
						Exclude Keywords (Optional)
					</label>
					<input
						type="text"
						id="exclude_keywords"
						name="exclude_keywords"
						placeholder="e.g. Season 2, VR, Remake"
						class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all"
					/>
					<p class="text-xs text-slate-500 mt-1.5">Comma-separated keywords to skip for this game only</p>
				</div>

				<!-- Options -->
				<div class="space-y-3">
					<label class="flex items-center gap-3 p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl cursor-pointer hover:bg-slate-800/50 transition-all group">
						<div class="relative flex items-center">
							<input 
								type="checkbox" 
								name="search_now" 
								checked={true}
								class="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-slate-600 transition-all checked:border-purple-500 checked:bg-purple-500"
							/>
							<svg class="pointer-events-none absolute h-5 w-5 stroke-white opacity-0 peer-checked:opacity-100" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</div>
						<div class="flex-1">
							<div class="text-sm font-medium text-white">Search immediately</div>
							<div class="text-[10px] text-slate-500">Show currently available releases on dashboard. If unchecked, game will only appear when a NEWER version is found later.</div>
						</div>
					</label>
				</div>

				<!-- Actions -->
				<div class="flex gap-3 pt-2">
					<button
						type="button"
						onclick={() => {
							showAddModal = false;
							gameTitle = '';
							searchQuery = '';
						}}
						class="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={addingGame}
						class="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 disabled:from-purple-900 disabled:to-purple-950 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-purple-600/25 flex items-center justify-center gap-2 min-h-[44px]"
					>
						{#if addingGame}
							<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							<span>Adding Game...</span>
						{:else}
							Add Game
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Edit Game Modal -->
{#if editGameId}
	{@const editGame = getEditGame()}
	{#if editGame}
		<div
			class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
			onclick={(e) => {
				if (e.target === e.currentTarget) editGameId = null;
			}}
			onkeydown={(e) => {
				if (e.key === 'Escape') editGameId = null;
			}}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md p-6">
				<h3 class="text-lg font-bold text-white mb-4">Edit Game</h3>
				<form method="POST" action="?/updateGame" onsubmit={handleEditGame}>
					<input type="hidden" name="id" value={editGame.id} />
					<div class="space-y-4">
						<div class="relative">
							<label for="edit_title" class="block text-sm font-medium text-slate-300 mb-1"
								>Title</label
							>
							<div class="relative">
								<input
									type="text"
									id="edit_title"
									name="title"
									value={editGame.title}
									oninput={handleEditTitleInput}
									onfocus={() => { if (editSuggestions.length > 0) showEditSuggestions = true; }}
									required
									class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm pr-10"
									autocomplete="off"
								/>
								
								<!-- Status Icon -->
								<div class="absolute right-3 top-1/2 -translate-y-1/2">
									{#if isEditingSearching}
										<svg class="animate-spin h-4 w-4 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
									{:else if editSuggestions.length > 0}
										<svg class="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
										</svg>
									{:else}
										<svg class="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
										</svg>
									{/if}
								</div>
							</div>
							{#if showEditSuggestions && editSuggestions.length > 0}
								<div class="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-xl max-h-60 overflow-y-auto">
									{#each editSuggestions as suggestion}
										<button
											type="button"
											onclick={() => selectEditSuggestion(suggestion)}
											class="w-full px-3 py-2 text-left text-sm text-white hover:bg-slate-600 transition"
										>
											{suggestion.display}
										</button>
									{/each}
								</div>
							{/if}
						</div>
						<div>
							<label for="edit_query" class="block text-sm font-medium text-slate-300 mb-1"
								>Search Query</label
							>
							<input
								type="text"
								id="edit_query"
								name="search_query"
								value={editGame.searchQuery}
								required
								class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
							/>
						</div>
						<div>
							<label
								for="edit_version_date"
								class="block text-sm font-medium text-slate-300 mb-1">Version Date</label
							>
							<input
								type="datetime-local"
								id="edit_version_date"
								name="version_date"
								value={editGame.currentVersionDate.slice(0, 16)}
								required
								class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
							/>
						</div>
						<div>
							<label for="edit_version" class="block text-sm font-medium text-slate-300 mb-1"
								>Version</label
							>
							<input
								type="text"
								id="edit_version"
								name="version"
								value={editGame.currentVersion || ''}
								class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
							/>
						</div>
						<div>
							<label
								for="edit_platform"
								class="block text-sm font-medium text-slate-300 mb-1">Platform</label
							>
							<input
								type="text"
								id="edit_platform"
								name="platform_filter"
								value={editGame.platformFilter}
								class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
							/>
						</div>
						<div>
							<label
								for="edit_exclude"
								class="block text-sm font-medium text-slate-300 mb-1">Exclude Keywords</label
							>
							<input
								type="text"
								id="edit_exclude"
								name="exclude_keywords"
								value={editGame.excludeKeywords || ''}
								placeholder="e.g. Season 2, VR"
								class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
							/>
						</div>
						<div>
							<div class="flex items-center justify-between mb-1">
								<label
									for="edit_igdb_id"
									class="block text-sm font-medium text-slate-300">IGDB ID (Optional)</label
								>
								<a 
									href="https://www.igdb.com/search?q={encodeURIComponent(editGame.cleanTitle || editGame.title)}" 
									target="_blank" 
									rel="noopener"
									class="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
									</svg>
									Find on IGDB
								</a>
							</div>
							<input
								type="number"
								id="edit_igdb_id"
								name="igdb_id"
								value={editGame.igdbId || ''}
								class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
								placeholder="e.g. 1942"
							/>
							<p class="text-[10px] text-slate-500 mt-1">Manual override for cover art. Find ID in the IGDB page's URL or sidebar.</p>
						</div>
					</div>
					<div class="flex gap-3 mt-6">
						<button
							type="submit"
							class="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
						>
							Save
						</button>
						<button
							type="button"
							onclick={() => (editGameId = null)}
							class="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
						>
							Cancel
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
{/if}

<!-- Confirmation Modal -->
{#if confirmModal && confirmModal.show}
	<Modal
		title={confirmModal.title}
		message={confirmModal.message}
		confirmType={confirmModal.type}
		confirmText={confirmModal.confirmText}
		onConfirm={confirmModal.onConfirm}
		onCancel={() => (confirmModal = null)}
	/>
{/if}

<!-- Skipped Releases Modal -->
{#if showSkippedFor !== null}
	<div
		class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) {
				closeSkippedModal();
			}
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				closeSkippedModal();
			}
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-[95vw] max-h-[80vh] overflow-y-auto">
			<div class="px-6 py-4 border-b border-slate-700 flex items-center justify-between sticky top-0 bg-slate-800 z-10">
				<h3 class="text-lg font-bold text-white">
					Skipped Releases
					{#if data.games.find((g) => g.id === showSkippedFor)}
						<span class="text-slate-400 font-normal">— {data.games.find((g) => g.id === showSkippedFor)?.title}</span>
					{/if}
				</h3>
				<button
					onclick={() => {
						showSkippedFor = null;
						skippedReleases = [];
					}}
					class="p-1 hover:bg-slate-700 rounded-lg transition"
					aria-label="Close skipped releases modal"
				>
					<svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="p-4">
				{#if loadingSkipped}
					<div class="text-center text-slate-400 py-8">Loading...</div>
				{:else if skippedReleases.length === 0}
					<div class="text-center text-slate-400 py-8">No skipped releases found for this game</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full min-w-[72rem]">
							<thead>
								<tr class="border-b border-slate-700 text-left">
									<th class="px-3 py-2 text-xs font-medium text-slate-400">Title</th>
									<th class="px-3 py-2 text-xs font-medium text-slate-400">Date</th>
									<th class="px-3 py-2 text-xs font-medium text-slate-400">Reason</th>
									<th class="px-3 py-2 text-xs font-medium text-slate-400">Indexer</th>
									<th class="px-3 py-2 text-xs font-medium text-slate-400 text-right">Size</th>
									<th class="px-3 py-2 text-xs font-medium text-slate-400 text-center">Action</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-700/50">
								{#each skippedReleases as skip}
									<tr class="hover:bg-slate-700/30">
										<td class="px-3 py-2 text-sm text-slate-200 min-w-[36rem] whitespace-nowrap">
											{#if skip.infoUrl}
												<a
													href={skip.infoUrl}
													target="_blank"
													rel="noopener noreferrer"
													class="text-blue-300 hover:text-blue-200 underline decoration-blue-400/50 hover:decoration-blue-300 transition-colors"
													title="Open release/forum page"
												>
													{skip.title || 'N/A'}
												</a>
											{:else}
												<span title="No forum link available">{skip.title || 'N/A'}</span>
											{/if}
										</td>
										<td class="px-3 py-2 text-sm text-slate-400 whitespace-nowrap">{skip.date || 'N/A'}</td>
										<td class="px-3 py-2 text-sm {skip.reason?.toLowerCase().includes('ignored') ? 'text-yellow-400' : 'text-slate-400'}">{skip.reason || 'Unknown'}</td>
										<td class="px-3 py-2 text-sm text-slate-400">{skip.indexer || 'N/A'}</td>
										<td class="px-3 py-2 text-sm text-slate-400 text-right whitespace-nowrap">{skip.size || 'N/A'}</td>
										<td class="px-3 py-2 text-center">
											<button
												onclick={() => forceAddRelease(skip)}
												class="px-3 py-1 text-xs font-medium rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/50 transition-colors"
												title="Force add this release"
											>
												Add
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
