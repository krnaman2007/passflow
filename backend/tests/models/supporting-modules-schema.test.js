import { describe, it, expect } from '@jest/globals';
import {
  antiScalpingRuleSchema,
  antiBotRuleSchema,
} from '../../src/schemas/rules.schema.js';
import { notificationSchema } from '../../src/schemas/notification.schema.js';
import { transactionHistorySchema } from '../../src/schemas/transaction-history.schema.js';
import { dutchAuctionSchema } from '../../src/schemas/dutch-auction.schema.js';
import { performanceMetricsSchema } from '../../src/schemas/monitoring.schema.js';
import { solvencyProofSchema } from '../../src/schemas/solvency.schema.js';

describe('Supporting Modules Schemas Validation', () => {
  describe('AntiScalpingRule Schema', () => {
    it('should validate valid AntiScalpingRule data', () => {
      const data = {
        id: 'rule-123',
        eventId: 'event-uuid-1',
        categoryId: 'cat-uuid-1',
        maxResalePrice: 1500,
        isActive: true,
      };
      const result = antiScalpingRuleSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.maxResalePrice).toBe(1500);
      expect(result.data.isActive).toBe(true);
    });

    it('should reject non-positive maxResalePrice', () => {
      const result = antiScalpingRuleSchema.safeParse({
        id: 'rule-123',
        eventId: 'event-1',
        maxResalePrice: -10,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AntiBotRule Schema', () => {
    it('should validate valid AntiBotRule data', () => {
      const data = {
        id: 'bot-rule-1',
        userId: '123e4567-e89b-12d3-a456-426614174000',
        ruleType: 'ORDER_RATE_LIMIT',
        limit: 30,
        status: 'ACTIVE',
      };
      const result = antiBotRuleSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.limit).toBe(30);
    });

    it('should reject non-positive limit', () => {
      const result = antiBotRuleSchema.safeParse({
        id: 'bot-rule-1',
        ruleType: 'RATE_LIMIT',
        limit: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Notification Schema', () => {
    it('should validate valid Notification data', () => {
      const data = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        userId: '123e4567-e89b-12d3-a456-426614174001',
        type: 'TRADE_FILLED',
        message: 'Your order was filled',
        status: 'UNREAD',
        createdAt: new Date(),
      };
      const result = notificationSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.type).toBe('TRADE_FILLED');
    });

    it('should reject invalid UUID', () => {
      const result = notificationSchema.safeParse({
        id: 'bad-id',
        userId: 'bad-user',
        type: 'ALERT',
        message: 'hello',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('TransactionHistory Schema', () => {
    it('should validate valid TransactionHistory data', () => {
      const data = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        userId: '123e4567-e89b-12d3-a456-426614174001',
        type: 'DEPOSIT',
        amount: 2500,
        status: 'COMPLETED',
        createdAt: new Date(),
      };
      const result = transactionHistorySchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.amount).toBe(2500);
    });
  });

  describe('DutchAuction Schema', () => {
    it('should validate valid DutchAuction data', () => {
      const now = new Date();
      const future = new Date(Date.now() + 3600000);
      const data = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        eventId: '123e4567-e89b-12d3-a456-426614174001',
        categoryId: '123e4567-e89b-12d3-a456-426614174002',
        startPrice: 500,
        minPrice: 100,
        currentPrice: 400,
        startTime: now,
        endTime: future,
        status: 'ACTIVE',
      };
      const result = dutchAuctionSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.startPrice).toBe(500);
    });
  });

  describe('PerformanceMetrics Schema', () => {
    it('should validate valid PerformanceMetrics data', () => {
      const data = {
        id: 'metric-1',
        ordersPerSec: 52.4,
        avgLatency: 4.1,
        throughput: 1200,
        errorRate: 0.001,
        createdAt: new Date(),
      };
      const result = performanceMetricsSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.ordersPerSec).toBe(52.4);
    });
  });

  describe('SolvencyProof Schema', () => {
    it('should validate valid SolvencyProof data', () => {
      const data = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        userId: '123e4567-e89b-12d3-a456-426614174001',
        liabilities: 100000,
        escrowBalance: 20000,
        backingAssets: 150000,
        isSolvent: true,
        ratio: 1.5,
        verifiedAt: new Date(),
        proofHash: 'abcdef1234567890',
      };
      const result = solvencyProofSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data.isSolvent).toBe(true);
    });
  });
});
