interface ScanProgress {
	isScanning: boolean;
	phase: string;
	currentStep: number;
	totalSteps: number;
	currentItem: string;
	percent: number;
	startedAt: string | null;
}

type Subscriber = (data: ScanProgress) => void;

class ProgressManager {
	private progress: ScanProgress = {
		isScanning: false,
		phase: '',
		currentStep: 0,
		totalSteps: 0,
		currentItem: '',
		percent: 0,
		startedAt: null
	};

	private subscribers: Set<Subscriber> = new Set();

	getProgress(): ScanProgress {
		return { ...this.progress };
	}

	subscribe(callback: Subscriber): () => void {
		this.subscribers.add(callback);
		callback(this.getProgress());
		return () => {
			this.subscribers.delete(callback);
		};
	}

	private broadcast(): void {
		const data = this.getProgress();
		for (const sub of this.subscribers) {
			try {
				sub(data);
			} catch {
				/* ignore */
			}
		}
	}

	async startScan(phase: string, totalSteps: number): Promise<void> {
		this.progress = {
			isScanning: true,
			phase,
			currentStep: 0,
			totalSteps,
			currentItem: '',
			percent: 0,
			startedAt: new Date().toISOString()
		};
		this.broadcast();
	}

	async update(currentStep: number, currentItem: string = ''): Promise<void> {
		this.progress.currentStep = currentStep;
		this.progress.currentItem = currentItem;
		this.progress.percent =
			this.progress.totalSteps > 0
				? Math.round((currentStep / this.progress.totalSteps) * 100)
				: 0;
		this.broadcast();
	}

	async complete(): Promise<void> {
		this.progress = {
			isScanning: false,
			phase: '',
			currentStep: 0,
			totalSteps: 0,
			currentItem: '',
			percent: 0,
			startedAt: null
		};
		this.broadcast();
	}
}

export const progressManager = new ProgressManager();
