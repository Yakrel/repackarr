import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { logger, logDir } from '$lib/server/logger.js';

export const GET: RequestHandler = async ({ url }) => {
        const file = url.searchParams.get('file');

        try {
                // Ensure log directory exists
                if (!existsSync(logDir)) {
                        logger.warn(`Log directory not found: ${logDir}`);
                        return json({ files: [], message: 'Log directory not found' });
                }

                // List files
                if (!file) {
                        const files = await fs.readdir(logDir);
                        const logFiles = files
                                .filter(f => f.startsWith('repackarr-') && f.endsWith('.log'))
                                .sort((a, b) => b.localeCompare(a)); // Newest first

                        return json({ files: logFiles });
                }

                // Read specific file
                const filePath = path.join(logDir, path.basename(file));
                
                if (!existsSync(filePath)) {
                        return json({ error: 'Log file not found' }, { status: 404 });
                }

                const content = await fs.readFile(filePath, 'utf-8');

                if (url.searchParams.has('download')) {
                        return new Response(content, {
                                headers: {
                                        'Content-Type': 'text/plain',
                                        'Content-Disposition': `attachment; filename="${file}"`
                                }
                        });
                }

                // Parse line by line to return structured data if possible
                // Our logger writes JSON lines
                const lines = content.trim().split('\n')
                        .filter(line => line.trim().length > 0)
                        .map(line => {
                                try {
                                        return JSON.parse(line);
                                } catch {
                                        return { 
                                                message: line, 
                                                level: 'unknown', 
                                                timestamp: new Date().toISOString() 
                                        };
                                }
                        });

                return json({ content: lines });

        } catch (error) {
                logger.error('Log read API error:', error);
                return json({ error: 'Failed to read logs' }, { status: 500 });
        }
};
