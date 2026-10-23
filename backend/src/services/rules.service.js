import crypto from 'node:crypto';
import { AppError } from '../middleware/errorHandler.js';

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
  listAntiScalpingRules(filters = {}) {
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
  createAntiScalpingRule(data) {
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

    this.antiScalpingRules.set(id, newRule);
    return newRule;
  }

  /**
   * Update or deactivate an existing anti-scalping rule by ID.
   */
  updateAntiScalpingRule(id, updates) {
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
  getAntiBotConfig() {
    return { ...this.antiBotConfig };
  }

  /**
   * Update global Anti-Bot rate limits.
   */
  updateAntiBotConfig(updates) {
    this.antiBotConfig = {
      ...this.antiBotConfig,
      ...(updates.ordersPerMinute !== undefined && { ordersPerMinute: Number(updates.ordersPerMinute) }),
      ...(updates.maxRequestsPerMinute !== undefined && { maxRequestsPerMinute: Number(updates.maxRequestsPerMinute) }),
      ...(updates.burstLimit !== undefined && { burstLimit: Number(updates.burstLimit) }),
      ...(updates.enabled !== undefined && { enabled: Boolean(updates.enabled) }),
      updatedAt: new Date().toISOString(),
    };

    return { ...this.antiBotConfig };
  }

  /**
   * AntiScalpingRule: validatePrice()
   * Rejects orders priced above the price cap.
   *
   * @param {object} order - { eventId, categoryId, price, side }
   * @param {boolean} [throwOnError=true]
   * @returns {boolean} true if valid
   */
  validatePrice(order, throwOnError = true) {
    if (!order) return true;

    // Only ask/sell orders or resale offers are capped by anti-scalping
    const rules = this.listAntiScalpingRules({
      eventId: order.eventId,
      enabled: true,
    });

    for (const rule of rules) {
      if (!rule.categoryId || rule.categoryId === order.categoryId) {
        // Handle tick / paise vs currency unit: if order price is integer ticks (e.g. 15000 = $150 or $1500)
        const cap = rule.maxResalePrice || rule.maxPrice;
        if (cap !== undefined && cap !== null) {
          const capPaise = cap > 1000 ? cap : cap * 100;
          const orderPricePaise = order.price > 1000 ? order.price : order.price * 100;

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
  check(userId, ruleType = 'ORDER_RATE_LIMIT', throwOnError = true) {
    if (!this.userRequestCounters) {
      this.userRequestCounters = new Map();
    }

    if (!this.antiBotConfig.enabled) {
      return true;
    }

    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const limit = this.antiBotConfig.ordersPerMinute || 20;

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

