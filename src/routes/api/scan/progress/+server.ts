import type { RequestHandler } from './$types.js';
import { progressManager } from '$lib/server/progress.js';

export const GET: RequestHandler = async () => {
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			const unsubscribe = progressManager.subscribe((data) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
					if (!data.isScanning) {
						setTimeout(() => {
							try {
								controller.close();
							} catch {
								/* already closed */
							}
						}, 100);
					}
				} catch {
					/* stream closed */
				}
			});

			const cleanup = () => unsubscribe();
			return cleanup;
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
