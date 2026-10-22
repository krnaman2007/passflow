import { z } from 'zod';

/**
 * SolvencyProof Model Schema
 * Proves platform funds cover user balances.
 * Fields: id, userId, liabilities, escrowBalance, backingAssets, verifiedAt
 */
export const solvencyProofSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  liabilities: z.number().nonnegative(),
  escrowBalance: z.number().nonnegative(),
  backingAssets: z.number().nonnegative(),
  isSolvent: z.boolean(),
  ratio: z.number().positive(),
  verifiedAt: z.coerce.date(),
  proofHash: z.string(),
  notes: z.string().optional(),
});

/**
 * Schema for generating a new SolvencyProof (POST /admin/solvency/generate)
 */
export const generateSolvencyProofSchema = z.object({
  backingAssets: z.number().positive().optional(),
  liabilities: z.number().positive().optional(),
  escrowBalance: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});

export default solvencyProofSchema;
