<script lang="ts">
	import { onMount } from 'svelte';

	type Notification = {
		id: number;
		type: 'auto_download_success' | 'auto_download_failed' | 'auto_download_skipped';
		gameId: number | null;
		gameTitle: string;
		message: string;
		isRead: boolean;
		createdAt: string;
	};

	let notifications = $state<Notification[]>([]);
	let unreadCount = $state(0);
	let panelOpen = $state(false);

	async function fetchNotifications() {
		try {
			const resp = await fetch('/api/notifications');
			if (resp.ok) {
				const data = await resp.json();
				notifications = data.notifications ?? [];
				unreadCount = data.unreadCount ?? 0;
			}
		} catch { /* ignore */ }
	}

	async function markAllRead() {
		try {
			await fetch('/api/notifications/read', { method: 'POST' });
			notifications = notifications.map((n) => ({ ...n, isRead: true }));
			unreadCount = 0;
		} catch { /* ignore */ }
	}

	function togglePanel() {
		panelOpen = !panelOpen;
		if (panelOpen && unreadCount > 0) {
			// Mark all as read when opening
			markAllRead();
		}
	}

	function formatRelativeTime(dateStr: string): string {
		const diff = Date.now() - Date.parse(dateStr);
		const minutes = Math.floor(diff / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function getNotificationIcon(type: Notification['type']): string {
		if (type === 'auto_download_success') return '✅';
		if (type === 'auto_download_failed') return '❌';
		return '⚠️';
	}

	function getNotificationColor(type: Notification['type']): string {
		if (type === 'auto_download_success') return 'text-emerald-400';
		if (type === 'auto_download_failed') return 'text-red-400';
		return 'text-amber-400';
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-notification-panel]')) {
			panelOpen = false;
		}
	}

	onMount(() => {
		fetchNotifications();
		const interval = setInterval(fetchNotifications, 10000);
		document.addEventListener('click', handleClickOutside);
		return () => {
			clearInterval(interval);
			document.removeEventListener('click', handleClickOutside);
		};
	});
</script>

<div class="relative" data-notification-panel>
	<!-- Bell Button -->
	<button
		onclick={togglePanel}
		class="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
		title="Notifications"
		aria-label="Toggle notifications"
	>
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
				d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
		</svg>
		{#if unreadCount > 0}
			<span
				class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none"
			>
				{unreadCount > 99 ? '99+' : unreadCount}
			</span>
		{/if}
	</button>

	<!-- Dropdown Panel -->
	{#if panelOpen}
		<div
			class="absolute right-0 top-full mt-2 w-80 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden"
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
				<h3 class="text-sm font-semibold text-white">Notifications</h3>
				{#if notifications.length > 0}
					<button
						onclick={markAllRead}
						class="text-xs text-slate-400 hover:text-purple-400 transition-colors"
					>
						Mark all read
					</button>
				{/if}
			</div>

			<!-- Notification List -->
			<div class="max-h-96 overflow-y-auto">
				{#if notifications.length === 0}
					<div class="px-4 py-8 text-center text-slate-500 text-sm">
						<svg class="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
								d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
						</svg>
						No notifications yet
					</div>
				{:else}
					{#each notifications as notif (notif.id)}
						<div
							class="px-4 py-3 border-b border-slate-700/50 last:border-0 transition-colors
								{!notif.isRead ? 'bg-slate-700/30' : ''}"
						>
							<div class="flex items-start gap-2">
								<span class="text-base mt-0.5 shrink-0">{getNotificationIcon(notif.type)}</span>
								<div class="flex-1 min-w-0">
									<p class="text-xs font-medium {getNotificationColor(notif.type)} truncate">{notif.gameTitle}</p>
									<p class="text-xs text-slate-300 mt-0.5 leading-relaxed">{notif.message}</p>
									<p class="text-[10px] text-slate-500 mt-1">{formatRelativeTime(notif.createdAt)}</p>
								</div>
								{#if !notif.isRead}
									<div class="w-2 h-2 rounded-full bg-purple-500 shrink-0 mt-1.5"></div>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
