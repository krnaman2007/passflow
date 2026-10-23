import prisma from '../../db/prisma.js';
import { tradeSettlementService } from './trade-settlement-service.js';
import auditLogService from '../audit-log.service.js';
import { AppError } from '../../middleware/errorHandler.js';

export class SettlementApiService {
  constructor({ prismaClient = prisma, settlementService = tradeSettlementService, auditService = auditLogService } = {}) {
    this.prisma = prismaClient;
    this.settlementService = settlementService;
    this.auditService = auditService;
  }

  /**
   * Retrieves settlement status and details for an execution or settlement receipt.
   * Enforces participant or administrator authorization.
   * Clearly distinguishes a missing settlement receipt from a completed settlement.
   *
   * @param {Object} params
   * @param {string} params.id - Execution ID or TradeSettlement ID
   * @param {Object} params.user - Authenticated User object (req.user)
   * @returns {Promise<Object>} Sanitized settlement facts
   */
  async getSettlementById({ id, user }) {
    if (!id || typeof id !== 'string') {
      throw new AppError('Settlement ID is required', 400, 'VALIDATION_ERROR');
    }
    if (!user || !user.id) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const cleanId = id.trim();

    // 1. Try finding by Execution.id
    let execution = await this.prisma.execution.findUnique({
      where: { id: cleanId },
      include: {
        incomingOrder: {
          select: {
            id: true,
            userId: true,
            side: true,
            price: true,
            eventId: true,
            ticketCategoryId: true,
          },
        },
        restingOrder: {
          select: {
            id: true,
            userId: true,
            side: true,
            price: true,
            eventId: true,
            ticketCategoryId: true,
          },
        },
        settlement: {
          select: {
            id: true,
            quantity: true,
            executionPricePaise: true,
            executionCostPaise: true,
            priceImprovementPaise: true,
            createdAt: true,
          },
        },
      },
    });

    // 2. If not found by execution id, try finding by TradeSettlement.id
    if (!execution) {
      const settlementRecord = await this.prisma.tradeSettlement.findUnique({
        where: { id: cleanId },
        include: {
          execution: {
            include: {
              incomingOrder: {
                select: {
                  id: true,
                  userId: true,
                  side: true,
                  price: true,
                  eventId: true,
                  ticketCategoryId: true,
                },
              },
              restingOrder: {
                select: {
                  id: true,
                  userId: true,
                  side: true,
                  price: true,
                  eventId: true,
                  ticketCategoryId: true,
                },
              },
              settlement: {
                select: {
                  id: true,
                  quantity: true,
                  executionPricePaise: true,
                  executionCostPaise: true,
                  priceImprovementPaise: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      });

      if (settlementRecord && settlementRecord.execution) {
        execution = settlementRecord.execution;
      }
    }

    if (!execution) {
      throw new AppError(`Settlement not found: ${cleanId}`, 404, 'SETTLEMENT_NOT_FOUND');
    }

    // 3. Authorization: Participant or Admin
    const isAdmin = user.role === 'ADMIN';
    const isIncomingOwner = execution.incomingOrder?.userId === user.id;
    const isRestingOwner = execution.restingOrder?.userId === user.id;
    const isParticipant = isIncomingOwner || isRestingOwner;

    if (!isAdmin && !isParticipant) {
      throw new AppError('You are not authorized to view this settlement', 403, 'FORBIDDEN');
    }

    // 4. Distinction of completed receipt vs unsettled
    const hasReceipt = Boolean(execution.settlement);
    const settlementReceipt = hasReceipt
      ? {
          id: execution.settlement.id,
          settledAt:
            execution.settlement.createdAt instanceof Date
              ? execution.settlement.createdAt.toISOString()
              : execution.settlement.createdAt,
          executionPricePaise: execution.settlement.executionPricePaise,
          executionCostPaise: String(execution.settlement.executionCostPaise),
          priceImprovementPaise: String(execution.settlement.priceImprovementPaise),
          quantity: execution.settlement.quantity,
        }
      : null;

    // 5. Build sanitized perspective payload
    if (isParticipant && !isAdmin) {
      const userOrder = isIncomingOwner ? execution.incomingOrder : execution.restingOrder;
      const role = isIncomingOwner ? 'TAKER' : 'MAKER';
      const side = userOrder.side;

      return {
        id: execution.settlement?.id || execution.id,
        executionId: execution.id,
        status: execution.settlementStatus, // PENDING, SETTLED, MANUAL_REVIEW
        role,
        side,
        orderId: userOrder.id,
        price: execution.price,
        quantity: execution.quantity,
        totalAmountPaise: String(BigInt(execution.price) * BigInt(execution.quantity)),
        sequenceNumber: execution.sequenceNumber != null ? String(execution.sequenceNumber) : null,
        executedAt:
          execution.executedAt instanceof Date
            ? execution.executedAt.toISOString()
            : execution.executedAt,
        hasReceipt,
        settlement: settlementReceipt,
      };
    }

    // Admin perspective: provides operational settlement context without leaking wallet/hold secrets
    const buyerOrder =
      execution.incomingOrder?.side === 'BID'
        ? execution.incomingOrder
        : execution.restingOrder;
    const sellerOrder =
      execution.incomingOrder?.side === 'ASK'
        ? execution.incomingOrder
        : execution.restingOrder;

    return {
      id: execution.settlement?.id || execution.id,
      executionId: execution.id,
      status: execution.settlementStatus,
      buyerOrderId: buyerOrder?.id || null,
      sellerOrderId: sellerOrder?.id || null,
      price: execution.price,
      quantity: execution.quantity,
      totalAmountPaise: String(BigInt(execution.price) * BigInt(execution.quantity)),
      sequenceNumber: execution.sequenceNumber != null ? String(execution.sequenceNumber) : null,
      retryCount: execution.retryCount,
      lastErrorCode: execution.lastErrorCode || null,
      executedAt:
        execution.executedAt instanceof Date
          ? execution.executedAt.toISOString()
          : execution.executedAt,
      hasReceipt,
      settlement: settlementReceipt,
    };
  }

  /**
   * Retrieves real persisted escrow or hold status.
   * Reuses existing persisted WalletHold and order reservation models.
   *
   * @param {Object} params
   * @param {string} params.id - WalletHold ID or linked Order ID
   * @param {Object} params.user - Authenticated User object
   * @returns {Promise<Object>} Persisted escrow hold facts
   */
  async getEscrowById({ id, user }) {
    if (!id || typeof id !== 'string') {
      throw new AppError('Escrow ID is required', 400, 'VALIDATION_ERROR');
    }
    if (!user || !user.id) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const cleanId = id.trim();

    // 1. Try finding by WalletHold.id
    let hold = await this.prisma.walletHold.findUnique({
      where: { id: cleanId },
      include: {
        wallet: {
          select: {
            id: true,
            userId: true,
          },
        },
        order: {
          select: {
            id: true,
            userId: true,
            side: true,
            price: true,
            initialQuantity: true,
          },
        },
      },
    });

    // 2. If not found by hold id, try finding by linked Order.id
    if (!hold) {
      hold = await this.prisma.walletHold.findFirst({
        where: { orderId: cleanId },
        include: {
          wallet: {
            select: {
              id: true,
              userId: true,
            },
          },
          order: {
            select: {
              id: true,
              userId: true,
              side: true,
              price: true,
              initialQuantity: true,
            },
          },
        },
      });
    }

    if (!hold) {
      throw new AppError(`Escrow hold not found: ${cleanId}`, 404, 'ESCROW_NOT_FOUND');
    }

    // 3. Authorization: Owner of wallet/order or Admin
    const isAdmin = user.role === 'ADMIN';
    const isOwner = hold.wallet?.userId === user.id || hold.order?.userId === user.id;

    if (!isAdmin && !isOwner) {
      throw new AppError('You are not authorized to view this escrow hold', 403, 'FORBIDDEN');
    }

    // 4. Minor-unit BigInt string serialization
    const heldAmountPaise = String(hold.heldAmount);
    const remainingAmountPaise = String(hold.remainingAmount);
    const releasedAmountPaise = String(BigInt(hold.heldAmount) - BigInt(hold.remainingAmount));

    if (!isAdmin) {
      return {
        id: hold.id,
        orderId: hold.orderId || null,
        reason: hold.reason,
        status: hold.status, // ACTIVE, PARTIALLY_RELEASED, PARTIALLY_SETTLED, SETTLED, RELEASED
        heldAmountPaise,
        remainingAmountPaise,
        releasedAmountPaise,
        createdAt: hold.createdAt instanceof Date ? hold.createdAt.toISOString() : hold.createdAt,
        updatedAt: hold.updatedAt instanceof Date ? hold.updatedAt.toISOString() : hold.updatedAt,
      };
    }

    return {
      id: hold.id,
      walletId: hold.walletId,
      userId: hold.wallet?.userId || null,
      orderId: hold.orderId || null,
      reason: hold.reason,
      status: hold.status,
      heldAmountPaise,
      remainingAmountPaise,
      releasedAmountPaise,
      createdAt: hold.createdAt instanceof Date ? hold.createdAt.toISOString() : hold.createdAt,
      updatedAt: hold.updatedAt instanceof Date ? hold.updatedAt.toISOString() : hold.updatedAt,
    };
  }

  /**
   * Safely retries settlement of an eligible execution by an authorized administrator.
   * Strictly rejects already settled executions and executions under manual review.
   * Reuses the existing atomic, serializable settlement service to prevent duplicate wallet
   * movements, ticket transfers, or ledger entries.
   *
   * @param {Object} params
   * @param {string} params.id - Execution ID or TradeSettlement ID
   * @param {Object} params.adminUser - Authenticated Admin User object
   * @returns {Promise<Object>} Outcome of settlement retry
   */
  async retrySettlement({ id, adminUser }) {
    if (!id || typeof id !== 'string') {
      throw new AppError('Settlement ID is required', 400, 'VALIDATION_ERROR');
    }
    if (!adminUser || adminUser.role !== 'ADMIN') {
      throw new AppError('Administrator privileges required', 403, 'FORBIDDEN');
    }

    const cleanId = id.trim();

    // 1. Locate Execution record
    let execution = await this.prisma.execution.findUnique({
      where: { id: cleanId },
      include: {
        settlement: true,
      },
    });

    if (!execution) {
      const settlementRecord = await this.prisma.tradeSettlement.findUnique({
        where: { id: cleanId },
        include: {
          execution: {
            include: { settlement: true },
          },
        },
      });
      if (settlementRecord && settlementRecord.execution) {
        execution = settlementRecord.execution;
      }
    }

    if (!execution) {
      throw new AppError(`Execution not found: ${cleanId}`, 404, 'EXECUTION_NOT_FOUND');
    }

    // 2. State eligibility checks under existing state machine
    if (execution.settlementStatus === 'SETTLED' || execution.settlement != null) {
      throw new AppError(
        `Execution ${execution.id} has already been settled and cannot be retried`,
        409,
        'SETTLEMENT_ALREADY_SETTLED'
      );
    }

    if (execution.settlementStatus === 'MANUAL_REVIEW') {
      throw new AppError(
        `Execution ${execution.id} requires manual review and cannot be automatically retried`,
        409,
        'SETTLEMENT_MANUAL_REVIEW_REQUIRED'
      );
    }

    if (execution.settlementStatus !== 'PENDING') {
      throw new AppError(
        `Execution ${execution.id} is in state ${execution.settlementStatus} and is not eligible for retry`,
        409,
        'SETTLEMENT_INELIGIBLE'
      );
    }

    // 3. Record administrative audit event
    try {
      const adminRecord = await this.prisma.admin.findFirst({
        where: { OR: [{ userId: adminUser.id }, { email: adminUser.email }] },
      });
      if (adminRecord) {
        await this.auditService.logAction(
          adminRecord.id,
          'SETTLEMENT_RETRY',
          {
            executionId: execution.id,
            sequenceNumber: execution.sequenceNumber?.toString(),
            initialStatus: execution.settlementStatus,
          }
        );
      }
    } catch {
      // Non-blocking audit record failure
    }

    // 4. Perform atomic settlement retry via existing TradeSettlementService
    const result = await this.settlementService.settleExecution({ executionId: execution.id });

    return {
      executionId: execution.id,
      status: 'SETTLED',
      message: 'Settlement retry completed successfully',
      isIdempotentReplay: result.isIdempotentReplay || false,
      settlement: {
        id: result.settlement.id,
        quantity: result.settlement.quantity,
        executionPricePaise: result.settlement.executionPricePaise,
        executionCostPaise: String(result.settlement.executionCostPaise),
        priceImprovementPaise: String(result.settlement.priceImprovementPaise),
        settledAt:
          result.settlement.createdAt instanceof Date
            ? result.settlement.createdAt.toISOString()
            : result.settlement.createdAt,
      },
    };
  }
}

export const settlementApiService = new SettlementApiService();
export default settlementApiService;
