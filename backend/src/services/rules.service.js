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
}

export const rulesService = new RulesService();
export default rulesService;
