export {
  MarketStreamService,
  PROTOCOL_VERSION,
  MAX_SUBSCRIPTIONS_PER_SOCKET,
  RATE_LIMIT_WINDOW_MS,
  MAX_REQUESTS_PER_WINDOW,
} from './market-stream-service.js';

import { MarketStreamService } from './market-stream-service.js';

export const marketStreamService = new MarketStreamService();
export default marketStreamService;
