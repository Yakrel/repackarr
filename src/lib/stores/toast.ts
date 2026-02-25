import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
	id: number;
	type: ToastType;
	title?: string;
	message: string;
	duration?: number;
}

function createToastStore() {
	const { subscribe, update } = writable<Toast[]>([]);

	let counter = 0;

	return {
		subscribe,
		add: (toast: Omit<Toast, 'id'>) => {
			const id = ++counter;
			const duration = toast.duration ?? 5000;
			
			update((toasts) => [...toasts, { ...toast, id }]);

			if (duration > 0) {
				setTimeout(() => {
					update((toasts) => toasts.filter((t) => t.id !== id));
				}, duration);
			}
		},
		remove: (id: number) => {
			update((toasts) => toasts.filter((t) => t.id !== id));
		},
		success: (message: string, title?: string) => {
			toastStore.add({ type: 'success', message, title });
		},
		error: (message: string, title?: string) => {
			toastStore.add({ type: 'error', message, title });
		},
		info: (message: string, title?: string) => {
			toastStore.add({ type: 'info', message, title });
		},
		warning: (message: string, title?: string) => {
			toastStore.add({ type: 'warning', message, title });
		}
	};
}

export const toastStore = createToastStore();
