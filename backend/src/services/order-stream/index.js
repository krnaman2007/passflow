import { OrderStreamService } from './order-stream.service.js';
import redis from '../../db/redis.js';
import { orderService } from '../order/index.js';

export { OrderStreamService } from './order-stream.service.js';

export const orderStreamService = new OrderStreamService({
  redis,
  orderService,
  enabled: process.env.ENABLE_REDIS_STREAMS !== 'false',
});

export default orderStreamService;

