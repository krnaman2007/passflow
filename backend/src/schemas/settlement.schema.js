import { z } from 'zod';

export const getSettlementParamsSchema = z.object({
  id: z.string().uuid({ message: 'Invalid settlement ID format; must be a valid UUID' }),
});

export const retrySettlementParamsSchema = z.object({
  id: z.string().uuid({ message: 'Invalid settlement/execution ID format; must be a valid UUID' }),
});

export const getEscrowParamsSchema = z.object({
  id: z.string().uuid({ message: 'Invalid escrow/hold ID format; must be a valid UUID' }),
});

export default {
  getSettlementParamsSchema,
  retrySettlementParamsSchema,
  getEscrowParamsSchema,
};
