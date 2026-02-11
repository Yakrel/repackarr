import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { QBitService } from '$lib/server/qbit.js';

export const POST: RequestHandler = async () => {
	const qbit = new QBitService();
	try {
		const success = await qbit.login();
		return json({
			success,
			message: success ? 'Connection successful' : 'Connection failed - check credentials'
		});
	} catch (error) {
		return json({ success: false, message: `Error: ${String(error).slice(0, 100)}` }, { status: 500 });
	}
};
