import { settings } from './config.js';
import { qbitService } from './qbit.js';
import { transmissionService } from './transmission.js';

export const torrentClient = settings.TRANSMISSION_HOST ? transmissionService : qbitService;
