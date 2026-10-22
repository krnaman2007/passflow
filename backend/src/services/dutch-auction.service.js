import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * DutchAuctionService
 * Price drops linearly or logarithmically over time until someone buys.
 * Methods: getCurrentPrice(), purchase()
 */
class DutchAuctionService {
  /**
   * Computes the price at the current time for a Dutch auction.
   *
   * @param {object|string} auctionOrId - Auction object or auction UUID
   * @returns {Promise<{ currentPrice: number, status: string }>}
   */
  async getCurrentPrice(auctionOrId) {
    let auction = auctionOrId;
    if (typeof auctionOrId === 'string') {
      auction = await prisma.dutchAuction.findUnique({
        where: { id: auctionOrId },
      });
      if (!auction) {
        throw new AppError('Dutch auction not found', 404, 'AUCTION_NOT_FOUND');
      }
    }

    const now = Date.now();
    const startTime = new Date(auction.startTime).getTime();
    const endTime = new Date(auction.endTime).getTime();

    const startPrice = Number(auction.startPrice);
    const minPrice = Number(auction.minPrice);

    if (now <= startTime) {
      return {
        id: auction.id,
        currentPrice: startPrice,
        startPrice,
        minPrice,
        status: auction.status,
      };
    }

    if (now >= endTime) {
      return {
        id: auction.id,
        currentPrice: minPrice,
        startPrice,
        minPrice,
        status: auction.status === 'ACTIVE' ? 'EXPIRED' : auction.status,
      };
    }

    // Linear price decay over duration
    const progress = (now - startTime) / (endTime - startTime);
    const decayedPrice = startPrice - progress * (startPrice - minPrice);
    const currentPrice = Math.max(minPrice, Math.round(decayedPrice * 100) / 100);

    return {
      id: auction.id,
      currentPrice,
      startPrice,
      minPrice,
      status: auction.status,
    };
  }

  /**
   * Retrieve auction details by ID with dynamic current price.
   *
   * @param {string} id
   */
  async getAuctionById(id) {
    const auction = await prisma.dutchAuction.findUnique({
      where: { id },
      include: {
        event: { select: { id: true, name: true, location: true, dateTime: true } },
        category: { select: { id: true, name: true, originalPrice: true } },
      },
    });

    if (!auction) {
      throw new AppError('Dutch auction not found', 404, 'AUCTION_NOT_FOUND');
    }

    const priceInfo = await this.getCurrentPrice(auction);

    return {
      ...auction,
      currentPrice: priceInfo.currentPrice,
      computedStatus: priceInfo.status,
    };
  }

  /**
   * Purchase at current price: Locks price and debits user wallet / assigns ticket.
   *
   * @param {string} auctionId
   * @param {string} userId
   * @param {number} quantity
   */
  async purchase(auctionId, userId, quantity = 1) {
    const auction = await prisma.dutchAuction.findUnique({
      where: { id: auctionId },
    });

    if (!auction) {
      throw new AppError('Dutch auction not found', 404, 'AUCTION_NOT_FOUND');
    }

    if (auction.status !== 'ACTIVE') {
      throw new AppError(`Auction is ${auction.status.toLowerCase()}`, 400, 'AUCTION_INACTIVE');
    }

    const { currentPrice, status } = await this.getCurrentPrice(auction);
    if (status === 'EXPIRED') {
      await prisma.dutchAuction.update({
        where: { id: auctionId },
        data: { status: 'EXPIRED' },
      });
      throw new AppError('Auction has expired', 400, 'AUCTION_EXPIRED');
    }

    const totalPricePaise = BigInt(Math.round(currentPrice * 100 * quantity));

    // Execute atomic purchase transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Verify user wallet balance
      const wallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!wallet || BigInt(wallet.availableBalance) < totalPricePaise) {
        throw new AppError('Insufficient wallet balance', 400, 'INSUFFICIENT_FUNDS');
      }

      // 2. Debit wallet
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: { decrement: totalPricePaise },
        },
      });

      // 3. Mark auction completed
      const updatedAuction = await tx.dutchAuction.update({
        where: { id: auctionId },
        data: {
          currentPrice,
          status: 'COMPLETED',
        },
      });

      // 4. Create ledger entry
      await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          entryType: 'TRADE_SETTLEMENT_DEBIT',
          amount: totalPricePaise,
          availableDelta: -totalPricePaise,
          reservedDelta: 0n,
          balanceAfterAvailable: updatedWallet.availableBalance,
          balanceAfterReserved: updatedWallet.reservedBalance,
          description: `Dutch auction purchase #${auctionId} (${quantity} tickets)`,
        },
      });

      // 5. Credit user inventory
      await tx.userTicketInventory.upsert({
        where: {
          userId_ticketCategoryId: {
            userId,
            ticketCategoryId: auction.categoryId,
          },
        },
        create: {
          userId,
          ticketCategoryId: auction.categoryId,
          totalQuantity: quantity,
          availableQuantity: quantity,
        },
        update: {
          totalQuantity: { increment: quantity },
          availableQuantity: { increment: quantity },
        },
      });

      return {
        auction: updatedAuction,
        purchasePrice: currentPrice,
        quantity,
        totalCost: Number(totalPricePaise) / 100,
      };
    });

    return result;
  }
}

export const dutchAuctionService = new DutchAuctionService();
export default dutchAuctionService;
