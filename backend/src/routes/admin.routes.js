import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { authenticateUser, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  adminManageUserSchema,
  adminVerifyOrganizerSchema,
  adminGetUsersQuerySchema,
  adminGetEventsQuerySchema,
  adminManageEventSchema,
  createAntiScalpingRuleSchema,
  updateAntiScalpingRuleSchema,
  updateAntiBotRuleSchema,
} from '../schemas/admin.schema.js';
import { queryAuditLogsSchema } from '../schemas/audit-log.schema.js';
import {
  runReconciliationSchema,
  queryReconciliationSchema,
} from '../schemas/reconciliation.schema.js';
import { queryMonitoringLogsSchema } from '../schemas/monitoring.schema.js';
import { generateSolvencyProofSchema } from '../schemas/solvency.schema.js';

const router = Router();

// All admin routes require an authenticated user with ADMIN role
router.use(authenticateUser);
router.use(requireAdmin);

/**
 * @route   GET /admin/users
 * @desc    List / search users.
 * @access  Admin
 */
router.get('/users', validate(adminGetUsersQuerySchema, 'query'), adminController.getUsers);

/**
 * @route   PATCH /admin/users/:id
 * @desc    Suspend / activate / change role / approve KYC.
 * @access  Admin
 */
router.patch('/users/:id', validate(adminManageUserSchema), adminController.manageUser);

/**
 * @route   PATCH /admin/organizers/:id/verify
 * @desc    Verify or reject organizer.
 * @access  Admin
 */
router.patch('/organizers/:id/verify', validate(adminVerifyOrganizerSchema), adminController.verifyOrganizer);

/**
 * @route   GET /admin/events
 * @desc    All events including drafts.
 * @access  Admin
 */
router.get('/events', validate(adminGetEventsQuerySchema, 'query'), adminController.getEvents);

/**
 * @route   PATCH /admin/events/:id
 * @desc    Approve / cancel event.
 * @access  Admin
 */
router.patch('/events/:id', validate(adminManageEventSchema), adminController.manageEvent);

/**
 * @route   GET /admin/rules/anti-scalping
 * @desc    List price-cap rules.
 * @access  Admin
 */
router.get('/rules/anti-scalping', adminController.listAntiScalpingRules);

/**
 * @route   POST /admin/rules/anti-scalping
 * @desc    Create rule (maxResalePrice per category).
 * @access  Admin
 */
router.post(
  '/rules/anti-scalping',
  validate(createAntiScalpingRuleSchema),
  adminController.createAntiScalpingRule
);

/**
 * @route   PUT /admin/rules/anti-scalping/:id
 * @desc    Update / deactivate rule.
 * @access  Admin
 */
router.put(
  '/rules/anti-scalping/:id',
  validate(updateAntiScalpingRuleSchema),
  adminController.updateAntiScalpingRule
);

/**
 * @route   GET /admin/rules/anti-bot
 * @desc    View rate limits.
 * @access  Admin
 */
router.get('/rules/anti-bot', adminController.getAntiBotConfig);

/**
 * @route   PUT /admin/rules/anti-bot
 * @desc    Change rate limits.
 * @access  Admin
 */
router.put(
  '/rules/anti-bot',
  validate(updateAntiBotRuleSchema),
  adminController.updateAntiBotConfig
);

/**
 * @route   GET /admin/reports
 * @desc    Volume, revenue, fees, user stats.
 * @access  Admin
 */
router.get('/reports', adminController.getReports);

/**
 * @route   GET /admin/audit-logs
 * @desc    Audit trail; filter by admin, action, date.
 * @access  Admin
 */
router.get('/audit-logs', validate(queryAuditLogsSchema, 'query'), adminController.getAuditLogs);

/**
 * @route   POST /admin/reconciliation/run
 * @desc    Generate reconciliation report.
 * @access  Admin
 */
router.post(
  '/reconciliation/run',
  validate(runReconciliationSchema),
  adminController.runReconciliation
);

/**
 * @route   GET /admin/reconciliation
 * @desc    Reports and discrepancies.
 * @access  Admin
 */
router.get(
  '/reconciliation',
  validate(queryReconciliationSchema, 'query'),
  adminController.getReconciliationReports
);

/**
 * @route   GET /admin/monitoring/health
 * @desc    DB, Redis, WebSocket, engine status.
 * @access  Admin
 */
router.get('/monitoring/health', adminController.getMonitoringHealth);

/**
 * @route   GET /admin/monitoring/logs
 * @desc    System logs.
 * @access  Admin
 */
router.get(
  '/monitoring/logs',
  validate(queryMonitoringLogsSchema, 'query'),
  adminController.getMonitoringLogs
);

/**
 * @route   GET /admin/metrics
 * @desc    PerformanceMetrics: orders/sec, latency, errors.
 * @access  Admin
 */
router.get('/metrics', adminController.getMetrics);

/**
 * @route   POST /admin/solvency/generate
 * @desc    Create SolvencyProof.
 * @access  Admin
 */
router.post(
  '/solvency/generate',
  validate(generateSolvencyProofSchema),
  adminController.generateSolvencyProof
);

/**
 * @route   POST /admin/tests/run
 * @desc    Execute real-time concurrency, Redis Streams, and matching engine benchmarks.
 * @access  Admin
 */
router.post('/tests/run', adminController.runLoadTest);

export default router;
