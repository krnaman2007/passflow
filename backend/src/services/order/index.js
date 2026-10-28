export {
  OrderService,
  InsufficientInventoryError,
  AmbiguousOrderOutcomeError,
  OrderHoldMismatchError,
} from './order-service.js';
export {
  OrderValidationError,
  IdempotencyPayloadMismatchError,
  PostCommitMutationError,
  AmbiguousCommitError,
} from '../matching/persistent-matching-service.js';
export {
  InsufficientFundsError,
  IdempotencyConflictError,
} from '../wallet/wallet-errors.js';

import { OrderService } from './order-service.js';
import { marketStreamService } from '../market-stream/index.js';
export const orderService = new OrderService({ marketStreamService });
export default orderService;
