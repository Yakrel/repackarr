<script lang="ts">
	interface Props {
		title: string;
		message: string;
		confirmText?: string;
		cancelText?: string;
		confirmType?: 'danger' | 'warning' | 'primary';
		onConfirm: () => void;
		onCancel: () => void;
	}

	let { 
		title, 
		message, 
		confirmText = 'Confirm', 
		cancelText = 'Cancel', 
		confirmType = 'primary',
		onConfirm, 
		onCancel 
	}: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onCancel();
		}
	}
</script>

<div
	class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200"
	role="dialog"
	aria-modal="true"
	onclick={(e) => {
		if (e.target === e.currentTarget) onCancel();
	}}
	onkeydown={handleKeydown}
	tabindex="-1"
>
	<div 
		class="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md shadow-2xl transform transition-all scale-100 opacity-100"
	>
		<div class="p-6">
			<h3 class="text-xl font-bold text-white mb-2">{title}</h3>
			<p class="text-slate-300">{message}</p>
		</div>
		
		<div class="bg-slate-800/50 px-6 py-4 rounded-b-xl flex justify-end gap-3 border-t border-slate-700/50">
			<button
				onclick={onCancel}
				class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
			>
				{cancelText}
			</button>
			<button
				onclick={onConfirm}
				class="px-4 py-2 font-medium rounded-lg transition-colors text-white shadow-lg
				{confirmType === 'danger' ? 'bg-red-600 hover:bg-red-700 shadow-red-900/20' : ''}
				{confirmType === 'warning' ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-900/20' : ''}
				{confirmType === 'primary' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-900/20' : ''}"
			>
				{confirmText}
			</button>
		</div>
	</div>
</div>
