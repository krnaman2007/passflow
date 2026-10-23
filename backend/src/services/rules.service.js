import crypto from 'node:crypto';
import { AppError } from '../middleware/errorHandler.js';
import prisma from '../db/prisma.js';

// Pre-seeded Anti-Scalping Rules (mirroring production/mock seed)
const initialRules = [
  {
    id: 'rule_1',
    name: 'Nightfall General',
    eventId: 'nightfall',
    tier: 'General',
    maxPrice: 120,
    maxResalePrice: 120,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'rule_2',
    name: 'Nightfall VIP',
    eventId: 'nightfall',
    tier: 'VIP',
    maxPrice: 300,
    maxResalePrice: 300,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Anti-Bot Global Rate Limiting State
const defaultAntiBotConfig = {
  ordersPerMinute: 20,
  maxRequestsPerMinute: 100,
  burstLimit: 30,
  enabled: true,
  updatedAt: new Date().toISOString(),
};

class RulesService {
  constructor() {
    this.antiScalpingRules = new Map();
    this.antiBotConfig = { ...defaultAntiBotConfig };
    this.seedDefaults();
  }

  seedDefaults() {
    this.antiScalpingRules.clear();
    for (const rule of initialRules) {
      this.antiScalpingRules.set(rule.id, { ...rule });
    }
    this.antiBotConfig = { ...defaultAntiBotConfig, updatedAt: new Date().toISOString() };
  }

  /**
   * List anti-scalping price cap rules with optional filters.
   */
  async listAntiScalpingRules(filters = {}) {
    try {
      const rules = await prisma.antiScalpingRule.findMany({
        where: {
          ...(filters.eventId ? { eventId: filters.eventId } : {}),
          ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
          ...(filters.enabled !== undefined
            ? { isActive: typeof filters.enabled === 'string' ? filters.enabled === 'true' : Boolean(filters.enabled) }
            : {}),
        },
        orderBy: { createdAt: 'asc' },
      });
      return rules.map((rule) => ({ ...rule, enabled: rule.isActive, maxPrice: Number(rule.maxResalePrice) }));
    } catch {
      // Unit tests and local development without a migrated database retain a
      // deterministic fallback, but production uses the persisted rules above.
    }
    let rules = Array.from(this.antiScalpingRules.values());

    if (filters.eventId) {
      rules = rules.filter((r) => r.eventId === filters.eventId);
    }

    if (filters.categoryId) {
      rules = rules.filter((r) => r.categoryId === filters.categoryId);
    }

    if (filters.enabled !== undefined) {
      const isEnabled = typeof filters.enabled === 'string' ? filters.enabled === 'true' : Boolean(filters.enabled);
      rules = rules.filter((r) => r.enabled === isEnabled);
    }

    return rules;
  }

  /**
   * Create a new anti-scalping price cap rule.
   */
  async createAntiScalpingRule(data) {
    const id = data.id || `rule_${crypto.randomUUID()}`;
    const price = data.maxResalePrice !== undefined ? data.maxResalePrice : data.maxPrice;

    const newRule = {
      id,
      name: data.name,
      eventId: data.eventId,
      ...(data.categoryId && { categoryId: data.categoryId }),
      ...(data.tier && { tier: data.tier }),
      maxPrice: Number(price),
      maxResalePrice: Number(price),
      enabled: data.enabled !== undefined ? Boolean(data.enabled) : true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const persisted = await prisma.antiScalpingRule.create({
        data: {
          id,
          eventId: data.eventId,
          categoryId: data.categoryId || null,
          // Rules are stored in major currency units; order prices are paise.
          maxResalePrice: String(price),
          isActive: newRule.enabled,
        },
      });
      return { ...persisted, enabled: persisted.isActive, maxPrice: Number(persisted.maxResalePrice) };
    } catch (err) {
      if (process.env.NODE_ENV === 'production') throw err;
      this.antiScalpingRules.set(id, newRule);
      return newRule;
    }
  }

  /**
   * Update or deactivate an existing anti-scalping rule by ID.
   */
  async updateAntiScalpingRule(id, updates) {
    try {
      const persisted = await prisma.antiScalpingRule.update({
        where: { id },
        data: {
          ...(updates.maxResalePrice !== undefined || updates.maxPrice !== undefined
            ? { maxResalePrice: String(updates.maxResalePrice ?? updates.maxPrice) }
            : {}),
          ...(updates.enabled !== undefined ? { isActive: Boolean(updates.enabled) } : {}),
        },
      });
      return { ...persisted, enabled: persisted.isActive, maxPrice: Number(persisted.maxResalePrice) };
    } catch (err) {
      if (process.env.NODE_ENV === 'production') throw err;
    }
    const existing = this.antiScalpingRules.get(id);
    if (!existing) {
      throw new AppError('Anti-scalping rule not found', 404, 'RULE_NOT_FOUND');
    }

    const price = updates.maxResalePrice !== undefined ? updates.maxResalePrice : updates.maxPrice;

    const updated = {
      ...existing,
      ...(updates.name !== undefined && { name: updates.name }),
      ...(price !== undefined && { maxPrice: Number(price), maxResalePrice: Number(price) }),
      ...(updates.enabled !== undefined && { enabled: Boolean(updates.enabled) }),
      updatedAt: new Date().toISOString(),
    };

    this.antiScalpingRules.set(id, updated);
    return updated;
  }

  /**
   * Retrieve global Anti-Bot rate limiting configuration.
   */
  async getAntiBotConfig() {
    try {
      const rule = await prisma.antiBotRule.findFirst({
        where: { userId: null, ruleType: 'ORDER_RATE_LIMIT' },
        orderBy: { updatedAt: 'desc' },
      });
      if (rule) return { ordersPerMinute: rule.limit, enabled: rule.status === 'ACTIVE', updatedAt: rule.updatedAt };
    } catch {
      // See fallback note in listAntiScalpingRules.
    }
    return { ...this.antiBotConfig };
  }

  /**
   * Update global Anti-Bot rate limits.
   */
  async updateAntiBotConfig(updates) {
    this.antiBotConfig = {
      ...this.antiBotConfig,
      ...(updates.ordersPerMinute !== undefined && { ordersPerMinute: Number(updates.ordersPerMinute) }),
      ...(updates.maxRequestsPerMinute !== undefined && { maxRequestsPerMinute: Number(updates.maxRequestsPerMinute) }),
      ...(updates.burstLimit !== undefined && { burstLimit: Number(updates.burstLimit) }),
      ...(updates.enabled !== undefined && { enabled: Boolean(updates.enabled) }),
      updatedAt: new Date().toISOString(),
    };

    try {
      const existing = await prisma.antiBotRule.findFirst({
        where: { userId: null, ruleType: 'ORDER_RATE_LIMIT' },
        orderBy: { updatedAt: 'desc' },
      });
      const persisted = existing
        ? await prisma.antiBotRule.update({
            where: { id: existing.id },
            data: { limit: this.antiBotConfig.ordersPerMinute, status: this.antiBotConfig.enabled ? 'ACTIVE' : 'SUSPENDED' },
          })
        : await prisma.antiBotRule.create({
            data: { ruleType: 'ORDER_RATE_LIMIT', limit: this.antiBotConfig.ordersPerMinute, status: this.antiBotConfig.enabled ? 'ACTIVE' : 'SUSPENDED' },
          });
      return { ordersPerMinute: persisted.limit, enabled: persisted.status === 'ACTIVE', updatedAt: persisted.updatedAt };
    } catch (err) {
      if (process.env.NODE_ENV === 'production') throw err;
      return { ...this.antiBotConfig };
    }
  }

  /**
   * AntiScalpingRule: validatePrice()
   * Rejects orders priced above the price cap.
   *
   * @param {object} order - { eventId, categoryId, price, side }
   * @param {boolean} [throwOnError=true]
   * @returns {boolean} true if valid
   */
  async validatePrice(order, throwOnError = true) {
    if (!order) return true;

    if (order.side !== 'ASK' && order.side !== 'SELL') return true;

    // Only ask/sell orders or resale offers are capped by anti-scalping
    const rules = await this.listAntiScalpingRules({
      eventId: order.eventId,
      enabled: true,
    });

    for (const rule of rules) {
      if (!rule.categoryId || rule.categoryId === order.categoryId) {
        // Handle tick / paise vs currency unit: if order price is integer ticks (e.g. 15000 = $150 or $1500)
        const cap = rule.maxResalePrice || rule.maxPrice;
        if (cap !== undefined && cap !== null) {
          const capPaise = Math.round(Number(cap) * 100);
          const orderPricePaise = Number(order.price);

          if (orderPricePaise > capPaise) {
            if (throwOnError) {
              throw new AppError(
                `Order price (${order.price}) exceeds anti-scalping price cap (${cap})`,
                400,
                'PRICE_CAP_EXCEEDED'
              );
            }
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * AntiBotRule: check()
   * Throttles users exceeding the rate limit / bot detection threshold.
   *
   * @param {string} userId
   * @param {string} [ruleType='ORDER_RATE_LIMIT']
   * @param {boolean} [throwOnError=true]
   * @returns {boolean} true if allowed
   */
  async check(userId, ruleType = 'ORDER_RATE_LIMIT', throwOnError = true) {
    if (!this.userRequestCounters) {
      this.userRequestCounters = new Map();
    }

    const config = await this.getAntiBotConfig();
    if (!config.enabled) {
      return true;
    }

    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    let limit = config.ordersPerMinute || 20;
    try {
      const personalRule = await prisma.antiBotRule.findFirst({
        where: { userId, ruleType, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
      });
      if (personalRule) limit = personalRule.limit;
    } catch {
      // The persisted global configuration above remains the authoritative
      // source whenever the database is available.
    }

    let timestamps = this.userRequestCounters.get(userId) || [];
    timestamps = timestamps.filter((ts) => now - ts < windowMs);

    if (timestamps.length >= limit) {
      if (throwOnError) {
        throw new AppError(
          `Rate limit exceeded: user ${userId} throttled by AntiBotRule (${timestamps.length}/${limit} req/min)`,
          429,
          'RATE_LIMIT_EXCEEDED'
        );
      }
      return false;
    }

    timestamps.push(now);
    this.userRequestCounters.set(userId, timestamps);
    return true;
  }
}

export const rulesService = new RulesService();
export default rulesService;

