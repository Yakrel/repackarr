<script lang="ts">
	import { toastStore, type Toast } from '$lib/stores/toast.js';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';

	let toasts = $state<Toast[]>([]);

	$effect(() => {
		const unsubscribe = toastStore.subscribe(value => {
			toasts = value;
		});
		return unsubscribe;
	});
</script>

<div class="fixed top-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none w-full max-w-sm">
	{#each toasts as toast (toast.id)}
		<div
			animate:flip
			in:fly={{ x: 20, duration: 300 }}
			out:fly={{ x: 20, duration: 300, opacity: 0 }}
			class="pointer-events-auto bg-slate-800 border rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl flex relative"
			class:border-emerald-500-30={toast.type === 'success'}
			class:border-red-500-30={toast.type === 'error'}
			class:border-amber-500-30={toast.type === 'warning'}
			class:border-blue-500-30={toast.type === 'info'}
		>
			<!-- Status Bar -->
			<div 
				class="w-1.5 flex-shrink-0"
				class:bg-emerald-500={toast.type === 'success'}
				class:bg-red-500={toast.type === 'error'}
				class:bg-amber-500={toast.type === 'warning'}
				class:bg-blue-500={toast.type === 'info'}
			></div>

			<div class="p-4 flex gap-3 items-start flex-1 min-w-0">
				<!-- Icon -->
				<div class="flex-shrink-0 mt-0.5">
					{#if toast.type === 'success'}
						<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{:else if toast.type === 'error'}
						<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{:else if toast.type === 'warning'}
						<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
					{:else}
						<svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{/if}
				</div>

				<!-- Content -->
				<div class="flex-1 min-w-0">
					{#if toast.title}
						<h4 class="text-sm font-semibold text-white mb-0.5 leading-none">{toast.title}</h4>
					{/if}
					<p class="text-sm text-slate-300 leading-snug break-words">{toast.message}</p>
				</div>

				<!-- Close Button -->
				<button 
					onclick={() => toastStore.remove(toast.id)}
					class="flex-shrink-0 text-slate-500 hover:text-white transition-colors"
					aria-label="Close notification"
					title="Close"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		</div>
	{/each}
</div>
