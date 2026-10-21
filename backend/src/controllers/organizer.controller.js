import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { successResponse } from '../utils/response.js';

/**
 * POST /organizers/apply
 * User: Request organizer role (creates Organizer profile with status PENDING).
 */
export const apply = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { organizationName } = req.body;

    // Check if user already has an organizer profile or active application
    const existingOrganizer = await prisma.organizer.findUnique({
      where: { userId },
    });

    if (existingOrganizer) {
      throw new AppError('An organizer profile or application already exists for this account', 409, 'ORGANIZER_EXISTS');
    }

    // Create Organizer profile in PENDING verification status
    const organizer = await prisma.organizer.create({
      data: {
        userId,
        organizationName: organizationName.trim(),
        verificationStatus: 'PENDING',
      },
    });

    // Update user role to ORGANIZER
    await prisma.user.update({
      where: { id: userId },
      data: { role: 'ORGANIZER' },
    });

    res.status(201).json(
      successResponse({
        message: 'Organizer application submitted successfully',
        organizer,
      })
    );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /organizers/me
 * Organizer: Retrieve current organizer profile and verification status.
 */
export const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const organizer = await prisma.organizer.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
          },
        },
        _count: {
          select: { events: true },
        },
      },
    });

    if (!organizer) {
      throw new AppError('Organizer profile not found', 404, 'ORGANIZER_NOT_FOUND');
    }

    res.status(200).json(successResponse(organizer));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /organizers/me/events
 * Organizer: Retrieve all events created by the logged-in organizer.
 */
export const getOrganizerEvents = async (req, res, next) => {
  try {
    const organizerId = req.user.organizer?.id;

    if (!organizerId) {
      throw new AppError('Organizer profile required for this action', 403, 'FORBIDDEN');
    }

    const events = await prisma.event.findMany({
      where: { organizerId },
      include: {
        categories: {
          include: {
            inventory: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(
      successResponse({
        events,
        total: events.length,
      })
    );
  } catch (err) {
    next(err);
  }
};

export default {
  apply,
  getProfile,
  getOrganizerEvents,
};
