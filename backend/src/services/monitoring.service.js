import prisma from '../db/prisma.js';
import redis from '../db/redis.js';

/**
 * Service for system monitoring, health checks, operational logs, and performance metrics.
 */
export const monitoringService = {
  io: null,
  orderService: null,
  orderStreamService: null,

  setRuntime({ io = null, orderService = null, orderStreamService = null } = {}) {
    this.io = io;
    this.orderService = orderService;
    if (orderStreamService) this.orderStreamService = orderStreamService;
  },
  /**
   * Evaluates health status across DB, Redis, WebSocket, and Matching Engine.
   *
   * @returns {Promise<object>} Standardized system health response
   */
  async getHealth() {
    let dbStatus = 'HEALTHY';
    let latencyMs = null;
    let dbMessage = 'Database connection operational';

    const start = Date.now();
    try {
      await prisma.user.count();
      latencyMs = Date.now() - start;
    } catch (err) {
      dbStatus = 'DEGRADED';
      dbMessage = err.message || 'Database connection degraded';
    }

    const services = {
      database: {
        status: dbStatus,
        latencyMs,
        message: dbMessage,
      },
      redis: redis
        ? { status: redis.status === 'ready' ? 'HEALTHY' : 'DEGRADED', message: `Redis status: ${redis.status}` }
        : { status: 'DOWN', message: 'Redis is not configured' },
      websocket: this.io
        ? {
            status: 'HEALTHY',
            activeConnections: this.io.engine?.clientsCount ?? null,
          }
        : { status: 'DOWN', activeConnections: null, message: 'Socket.IO server is not attached' },
      matchingEngine: this.orderService?.matchingService
        ? {
            status: this.orderService.checkReadiness?.().ready === false ? 'DEGRADED' : 'HEALTHY',
            activeMarkets: this.orderService.matchingService._marketBooks?.size ?? null,
          }
        : { status: 'DOWN', activeMarkets: null, message: 'Matching service is not attached' },
    };

    const statuses = Object.values(services).map((service) => service.status);
    const overallStatus = statuses.includes('DOWN') ? 'DEGRADED' : statuses.every((status) => status === 'HEALTHY') ? 'HEALTHY' : 'DEGRADED';

    return {
      status: overallStatus,
      timestamp: new Date(),
      services,
    };
  },

  /**
   * Retrieves paginated system monitoring and audit logs.
   *
   * @param {object} filters - type, status, startDate, endDate, page, limit
   * @returns {Promise<object>} Paginated logs and metadata
   */
  async getLogs(filters = {}) {
    const { type, status, startDate, endDate, page = 1, limit = 20 } = filters;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    let [logs, total] = await Promise.all([
      prisma.monitoring.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.monitoring.count({ where }),
    ]);

    return {
      logs,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    };
  },

  /**
   * Computes engine and API performance figures (orders/sec, latency, errors).
   *
   * @returns {Promise<object>} PerformanceMetrics summary
   */
  async getMetrics() {
    const [totalOrders, totalExecutions] = await Promise.all([
      prisma.order.count().catch(() => 0),
      prisma.execution.count().catch(() => 0),
    ]);

    const memoryUsage = process.memoryUsage();
    const streamMetrics = this.orderStreamService ? await this.orderStreamService.getMetrics().catch(() => null) : null;

    return {
      ordersPerSec: streamMetrics?.ordersPerSec ?? null,
      avgLatency: streamMetrics?.avgIngestionLatencyMs ?? null,
      avgLatencyMs: streamMetrics?.avgIngestionLatencyMs ?? null,
      throughput: streamMetrics?.ordersPerSec ?? null,
      errorRate: streamMetrics?.totalFailed ? Math.round((streamMetrics.totalFailed / Math.max(1, streamMetrics.totalEnqueued)) * 1000) / 1000 : 0,
      uptime: Math.round(process.uptime()),
      stream: streamMetrics,
      memory: {
        heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 100) / 100,
        rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 100) / 100,
      },
      orders: {
        total: totalOrders,
        ordersPerSec: streamMetrics?.ordersPerSec ?? null,
      },
      executions: {
        total: totalExecutions,
      },
      activeMarkets: this.orderService?.matchingService?._marketBooks?.size ?? null,
      createdAt: new Date().toISOString(),
    };
  },

  /**
   * PerformanceMetrics: recordMetrics()
   * Records a performance metric sample to DB and in-memory cache.
   *
   * @param {object} sample - { ordersPerSec, avgLatency, throughput, errorRate }
   * @returns {Promise<object>} Stored performance metrics record
   */
  async recordMetrics(sample = {}) {
    const data = {
      ordersPerSec: Number(sample.ordersPerSec),
      avgLatency: Number(sample.avgLatency),
      throughput: Number(sample.throughput),
      errorRate: Number(sample.errorRate),
    };

    if (Object.values(data).some((value) => !Number.isFinite(value))) {
      throw new Error('Measured ordersPerSec, avgLatency, throughput, and errorRate are required');
    }

    let record;
    try {
      record = await prisma.performanceMetrics.create({ data });
    } catch {
      record = {
        id: `pm_${Date.now()}`,
        ...data,
        createdAt: new Date(),
      };
    }

    return record;
  },

  /**
   * PerformanceMetrics: getReport()
   * Computes a summary performance metrics report.
   *
   * @returns {Promise<object>} Summary report
   */
  async getReport() {
    let recentSamples = [];
    try {
      recentSamples = await prisma.performanceMetrics.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    } catch {
      recentSamples = [];
    }

    if (recentSamples.length === 0) {
      const current = await this.getMetrics();
      return {
        sampleCount: 1,
        summary: {
          ordersPerSec: current.ordersPerSec,
          avgLatency: current.avgLatency,
          throughput: current.throughput,
          errorRate: current.errorRate,
        },
        period: 'latest',
      };
    }

    const count = recentSamples.length;
    const avgOps = recentSamples.reduce((acc, s) => acc + s.ordersPerSec, 0) / count;
    const avgLat = recentSamples.reduce((acc, s) => acc + s.avgLatency, 0) / count;
    const avgTp = recentSamples.reduce((acc, s) => acc + s.throughput, 0) / count;
    const avgErr = recentSamples.reduce((acc, s) => acc + s.errorRate, 0) / count;

    return {
      sampleCount: count,
      summary: {
        ordersPerSec: Math.round(avgOps * 100) / 100,
        avgLatency: Math.round(avgLat * 100) / 100,
        throughput: Math.round(avgTp * 100) / 100,
        errorRate: Math.round(avgErr * 10000) / 10000,
      },
      latestSample: recentSamples[0],
    };
  },
};

export default monitoringService;
