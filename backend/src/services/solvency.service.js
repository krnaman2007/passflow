import crypto from 'node:crypto';
import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Service for Proof of Solvency generation and public verification.
 * Verifies that backing assets and reserves exceed user liabilities and escrow balances.
 */
class SolvencyService {
  constructor() {
    this.proofs = [];
  }

  /**
   * Generates a new cryptographically verifiable SolvencyProof snapshot.
   *
   * @param {object} options - Optional overrides for backingAssets, liabilities, escrowBalance, notes
   * @returns {Promise<object>} Generated SolvencyProof record
   */
  async generateProof(options = {}) {
    if (!Number.isFinite(Number(options.backingAssets)) || Number(options.backingAssets) < 0) {
      throw new AppError(
        'Authoritative backingAssets attestation is required to generate a solvency proof',
        422,
        'BACKING_ASSETS_REQUIRED'
      );
    }

    // Holds are already included in reserved wallet balances, so liabilities
    // deliberately do not add escrow a second time.
    let totalLiabilitiesPaise = 0n;
    let totalEscrowPaise = 0n;
    try {
      const [wallets, holds] = await Promise.all([
        prisma.wallet.findMany({ select: { availableBalance: true, reservedBalance: true } }),
        prisma.walletHold.findMany({ where: { status: 'ACTIVE' }, select: { remainingAmount: true } }),
      ]);
      for (const wallet of wallets) totalLiabilitiesPaise += BigInt(wallet.availableBalance) + BigInt(wallet.reservedBalance);
      for (const hold of holds) totalEscrowPaise += BigInt(hold.remainingAmount);
    } catch (error) {
      throw new AppError('Authoritative wallet data is unavailable', 503, 'SOLVENCY_DATA_UNAVAILABLE');
    }

    const liabilities = Number(totalLiabilitiesPaise) / 100;
    const escrowBalance = Number(totalEscrowPaise) / 100;
    const backingAssets = Number(options.backingAssets);

    const isSolvent = backingAssets >= liabilities;
    const ratio = liabilities > 0 ? Math.round((backingAssets / liabilities) * 100) / 100 : 1.0;
    const verifiedAt = new Date().toISOString();
    const id = crypto.randomUUID();

    const proofHash = crypto
      .createHash('sha256')
      .update(`${id}:${liabilities}:${escrowBalance}:${backingAssets}:${verifiedAt}`)
      .digest('hex');

    const proof = {
      id,
      liabilities,
      escrowBalance,
      backingAssets,
      isSolvent,
      ratio,
      verifiedAt,
      proofHash,
      notes: options.notes || 'Automated solvency verification proof',
    };

    const persisted = await prisma.$transaction(async (tx) => {
      const stored = await tx.solvencyProof.create({
        data: { ...proof, verifiedAt: new Date(proof.verifiedAt), userId: options.userId || null },
      });
      await tx.monitoring.create({
        data: { type: 'SOLVENCY_PROOF', status: isSolvent ? 'HEALTHY' : 'ERROR', details: proof },
      });
      return stored;
    });
    this.proofs.unshift(persisted);
    return persisted;
  }

  /**
   * Retrieves the latest SolvencyProof.
   */
  /**
   * Public verification check. Confirms whether assets cover liabilities.
   */
  async verify() {
    const latest = await prisma.solvencyProof.findFirst({ orderBy: { verifiedAt: 'desc' } });
    if (!latest) {
      throw new AppError('No persisted solvency proof is available', 503, 'SOLVENCY_PROOF_UNAVAILABLE');
    }
    const isSolvent = Number(latest.backingAssets) >= Number(latest.liabilities);
    return {
      isSolvent,
      proof: latest,
      verified: isSolvent,
      message: isSolvent
        ? 'Platform solvency verified: assets exceed total user liabilities'
        : 'Platform solvency warning: liabilities exceed backing assets',
      verifiedAt: latest.verifiedAt,
    };
  }
}

export const solvencyService = new SolvencyService();
export default solvencyService;
