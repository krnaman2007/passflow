import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { successResponse } from '../utils/response.js';
import { formatSafeUser } from '../utils/token.js';
import auditLogService from '../services/audit-log.service.js';

/**
 * GET /admin/users
 * Admin: List and search users with optional filters (search, role, kycStatus, isActive) and pagination.
 */
export const getUsers = async (req, res, next) => {
  try {
    const query = req.validatedQuery || req.query;
    const { search, role, kycStatus, isActive, page = 1, limit = 20 } = query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (kycStatus || isActive !== undefined) {
      where.buyerSeller = {};
      if (kycStatus) {
        where.buyerSeller.kycStatus = kycStatus;
      }
      if (isActive !== undefined) {
        where.buyerSeller.isActive = Boolean(isActive);
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          buyerSeller: true,
          organizer: true,
          wallet: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    const safeUsers = users.map(formatSafeUser);

    res.status(200).json(
      successResponse({
        users: safeUsers,
        total,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /admin/users/:id
 * Admin: Suspend / activate / change role / approve KYC.
 */
export const manageUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, isActive, kycStatus } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { id },
      include: { buyerSeller: true, organizer: true },
    });

    if (!existingUser) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const updates = [];

    // 1. Update user role if provided
    if (role !== undefined) {
      updates.push(
        prisma.user.update({
          where: { id },
          data: { role },
        })
      );
    }

    // 2. Update buyerSeller if isActive or kycStatus is provided
    if (isActive !== undefined || kycStatus !== undefined) {
      const buyerSellerData = {};
      if (isActive !== undefined) buyerSellerData.isActive = isActive;
      if (kycStatus !== undefined) buyerSellerData.kycStatus = kycStatus;

      updates.push(
        prisma.buyerSeller.upsert({
          where: { userId: id },
          create: {
            userId: id,
            isActive: isActive !== undefined ? isActive : true,
            kycStatus: kycStatus !== undefined ? kycStatus : 'PENDING',
          },
          update: buyerSellerData,
        })
      );
    }

    // 3. If user is suspended (isActive: false), revoke their active refresh tokens
    if (isActive === false) {
      updates.push(
        prisma.refreshToken.updateMany({
          where: { userId: id, revoked: false },
          data: { revoked: true },
        })
      );
    }

    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }

    // Non-blocking audit log record
    try {
      const adminRecord = await prisma.admin.findFirst({
        where: { OR: [{ userId: req.user.id }, { email: req.user.email }] },
      });
      if (adminRecord) {
        await auditLogService.logAction(
          adminRecord.id,
          'MANAGE_USER',
          { targetUserId: id, role, isActive, kycStatus }
        );
      }
    } catch {
      // Non-blocking
    }

    // Return updated user profile
    const updatedUser = await prisma.user.findUnique({
      where: { id },
      include: {
        buyerSeller: true,
        organizer: true,
        wallet: true,
      },
    });

    res.status(200).json(
      successResponse({
        message: 'User updated successfully',
        user: formatSafeUser(updatedUser),
      })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /admin/organizers/:id/verify
 * Admin: Verify or reject organizer application.
 */
export const verifyOrganizer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { verificationStatus } = req.body;

    // Support lookup by organizer ID or user ID
    let organizer = await prisma.organizer.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!organizer) {
      organizer = await prisma.organizer.findUnique({
        where: { userId: id },
        include: { user: true },
      });
    }

    if (!organizer) {
      throw new AppError('Organizer profile not found', 404, 'ORGANIZER_NOT_FOUND');
    }

    // Update organizer verification status
    const updatedOrganizer = await prisma.organizer.update({
      where: { id: organizer.id },
      data: { verificationStatus },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // If verified, elevate user role to ORGANIZER unless they are already an ADMIN
    if (verificationStatus === 'VERIFIED' && organizer.user.role === 'USER') {
      await prisma.user.update({
        where: { id: organizer.userId },
        data: { role: 'ORGANIZER' },
      });
      updatedOrganizer.user.role = 'ORGANIZER';
    }

    // Non-blocking audit log record
    try {
      const adminRecord = await prisma.admin.findFirst({
        where: { OR: [{ userId: req.user.id }, { email: req.user.email }] },
      });
      if (adminRecord) {
        await auditLogService.logAction(
          adminRecord.id,
          verificationStatus === 'VERIFIED' ? 'VERIFY_ORGANIZER' : 'REJECT_ORGANIZER',
          { organizerId: organizer.id, userId: organizer.userId, verificationStatus }
        );
      }
    } catch {
      // Non-blocking
    }

    res.status(200).json(
      successResponse({
        message: `Organizer verification status updated to ${verificationStatus}`,
        organizer: updatedOrganizer,
      })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/events
 * Admin: Retrieve all events including drafts with optional search, status, organizerId, and pagination.
 */
export const getEvents = async (req, res, next) => {
  try {
    const query = req.validatedQuery || req.query;
    const { search, status, organizerId, page = 1, limit = 20 } = query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (status) {
      where.status = status;
    }

    if (organizerId) {
      where.organizerId = organizerId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          categories: {
            include: { inventory: true },
          },
          organizer: {
            select: {
              id: true,
              organizationName: true,
              verificationStatus: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
      prisma.event.count({ where }),
    ]);

    res.status(200).json(
      successResponse({
        events,
        total,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /admin/events/:id
 * Admin: Approve / cancel / update event status.
 */
export const manageEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const existingEvent = await prisma.event.findUnique({
      where: { id },
      include: { organizer: true },
    });

    if (!existingEvent) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    const updatedEvent = await prisma.event.update({
      where: { id },
      data: { status },
      include: {
        categories: {
          include: { inventory: true },
        },
        organizer: {
          select: {
            id: true,
            organizationName: true,
            verificationStatus: true,
          },
        },
      },
    });

    // Non-blocking audit log record
    try {
      const adminRecord = await prisma.admin.findFirst({
        where: { OR: [{ userId: req.user.id }, { email: req.user.email }] },
      });
      if (adminRecord) {
        await auditLogService.logAction(
          adminRecord.id,
          status === 'PUBLISHED' ? 'APPROVE_EVENT' : status === 'CANCELLED' ? 'CANCEL_EVENT' : 'UPDATE_EVENT_STATUS',
          { eventId: id, oldStatus: existingEvent.status, newStatus: status }
        );
      }
    } catch {
      // Non-blocking
    }

    res.status(200).json(
      successResponse({
        message: `Event status updated to ${status}`,
        event: updatedEvent,
      })
    );
  } catch (err) {
    next(err);
  }
};

export default {
  getUsers,
  manageUser,
  verifyOrganizer,
  getEvents,
  manageEvent,
};
