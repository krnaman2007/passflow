import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import config from '../src/config/index.js';
import prisma from '../src/db/prisma.js';
import eventService from '../src/services/event.service.js';

describe('Event & Category Management API Tests', () => {
  const organizerUser = {
    id: 'user-org-123',
    email: 'organizer@passflow.com',
    role: 'ORGANIZER',
    organizer: {
      id: 'org-123',
      organizationName: 'Global Events Inc',
      verificationStatus: 'VERIFIED',
    },
  };

  const regularUser = {
    id: 'user-reg-456',
    email: 'buyer@passflow.com',
    role: 'USER',
    organizer: null,
  };

  const organizerToken = jwt.sign(
    { userId: organizerUser.id, role: organizerUser.role },
    config.jwtSecret
  );

  const regularToken = jwt.sign(
    { userId: regularUser.id, role: regularUser.role },
    config.jwtSecret
  );

  beforeEach(() => {
    jest.restoreAllMocks();
    // Default prisma.user.findUnique mock to return user according to token
    jest.spyOn(prisma.user, 'findUnique').mockImplementation(async ({ where }) => {
      if (where.id === organizerUser.id) return organizerUser;
      if (where.id === regularUser.id) return regularUser;
      return null;
    });
  });

  describe('POST /api/v1/events', () => {
    it('should return 401 if no Authorization header provided', async () => {
      const res = await request(app).post('/api/v1/events').send({
        name: 'Rock Festival 2026',
        dateTime: '2026-12-01T20:00:00.000Z',
        location: 'Madison Square Garden',
      });

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 if calling user is not an organizer', async () => {
      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${regularToken}`)
        .send({
          name: 'Rock Festival 2026',
          dateTime: '2026-12-01T20:00:00.000Z',
          location: 'Madison Square Garden',
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should return 400 if validation fails (missing required name)', async () => {
      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          dateTime: '2026-12-01T20:00:00.000Z',
          location: 'Madison Square Garden',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 201 with created event when input is valid', async () => {
      const mockEvent = {
        id: 'event-001',
        name: 'Rock Festival 2026',
        description: 'Annual rock gathering',
        dateTime: '2026-12-01T20:00:00.000Z',
        location: 'Madison Square Garden',
        organizerId: 'org-123',
        status: 'DRAFT',
        originalPrice: '100.00',
        createdAt: new Date().toISOString(),
      };

      jest.spyOn(eventService, 'createEvent').mockResolvedValue(mockEvent);

      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'Rock Festival 2026',
          description: 'Annual rock gathering',
          dateTime: '2026-12-01T20:00:00.000Z',
          location: 'Madison Square Garden',
          originalPrice: 100,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('event-001');
      expect(res.body.data.status).toBe('DRAFT');
    });
  });

  describe('GET /api/v1/events', () => {
    it('should return 200 with paginated events list (public)', async () => {
      const mockResult = {
        events: [
          {
            id: 'event-001',
            name: 'Rock Festival 2026',
            dateTime: '2026-12-01T20:00:00.000Z',
            location: 'Madison Square Garden',
            status: 'PUBLISHED',
          },
        ],
        pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
      };

      jest.spyOn(eventService, 'listEvents').mockResolvedValue(mockResult);

      const res = await request(app).get('/api/v1/events?search=Rock');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.events).toHaveLength(1);
      expect(res.body.data.pagination.total).toBe(1);
    });
  });

  describe('GET /api/v1/events/:id', () => {
    it('should return 200 with event details (public)', async () => {
      const mockEvent = {
        id: 'event-001',
        name: 'Rock Festival 2026',
        categories: [],
      };

      jest.spyOn(eventService, 'getEventById').mockResolvedValue(mockEvent);

      const res = await request(app).get('/api/v1/events/event-001');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('event-001');
    });
  });

  describe('PUT /api/v1/events/:id', () => {
    it('should return 200 when organizer updates event', async () => {
      const mockUpdated = {
        id: 'event-001',
        name: 'Rock Festival 2026 - Extended',
        location: 'Updated Venue',
      };

      jest.spyOn(eventService, 'updateEvent').mockResolvedValue(mockUpdated);

      const res = await request(app)
        .put('/api/v1/events/event-001')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'Rock Festival 2026 - Extended',
          location: 'Updated Venue',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Rock Festival 2026 - Extended');
    });
  });

  describe('PATCH /api/v1/events/:id/status', () => {
    it('should return 400 if invalid status provided', async () => {
      const res = await request(app)
        .patch('/api/v1/events/event-001/status')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ status: 'INVALID_STATUS' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 200 when updating event to PUBLISHED', async () => {
      const mockEvent = { id: 'event-001', status: 'PUBLISHED' };
      jest.spyOn(eventService, 'updateEventStatus').mockResolvedValue(mockEvent);

      const res = await request(app)
        .patch('/api/v1/events/event-001/status')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ status: 'PUBLISHED' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('PUBLISHED');
    });
  });

  describe('POST /api/v1/events/:id/categories', () => {
    it('should return 400 if category price is negative or zero', async () => {
      const res = await request(app)
        .post('/api/v1/events/event-001/categories')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'VIP Tier',
          originalPrice: -50,
          totalQuantity: 100,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 201 when category added with inventory', async () => {
      const mockCategory = {
        id: 'cat-001',
        eventId: 'event-001',
        name: 'VIP Tier',
        originalPrice: '150.00',
        totalQuantity: 50,
        availableQuantity: 50,
        status: 'ACTIVE',
        inventory: {
          id: 'inv-001',
          categoryId: 'cat-001',
          totalQuantity: 50,
          availableQuantity: 50,
          reservedQuantity: 0,
        },
      };

      jest.spyOn(eventService, 'addCategory').mockResolvedValue(mockCategory);

      const res = await request(app)
        .post('/api/v1/events/event-001/categories')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'VIP Tier',
          originalPrice: 150,
          totalQuantity: 50,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('cat-001');
      expect(res.body.data.inventory.availableQuantity).toBe(50);
    });
  });

  describe('GET /api/v1/events/:id/categories', () => {
    it('should return 200 with categories list (public)', async () => {
      const mockCategories = [
        { id: 'cat-001', name: 'General', originalPrice: '50.00', availableQuantity: 100 },
      ];

      jest.spyOn(eventService, 'getCategories').mockResolvedValue(mockCategories);

      const res = await request(app).get('/api/v1/events/event-001/categories');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('PUT /api/v1/categories/:id', () => {
    it('should return 200 when updating category details', async () => {
      const mockCategory = { id: 'cat-001', name: 'VIP Gold', originalPrice: '200.00' };
      jest.spyOn(eventService, 'updateCategory').mockResolvedValue(mockCategory);

      const res = await request(app)
        .put('/api/v1/categories/cat-001')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          name: 'VIP Gold',
          originalPrice: 200,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('VIP Gold');
    });
  });

  describe('GET /api/v1/categories/:id/inventory', () => {
    it('should return 200 with inventory counts (Organizer only)', async () => {
      const mockInventory = {
        categoryId: 'cat-001',
        totalQuantity: 100,
        availableQuantity: 80,
        reservedQuantity: 5,
        soldCount: 15,
      };

      jest.spyOn(eventService, 'getCategoryInventory').mockResolvedValue(mockInventory);

      const res = await request(app)
        .get('/api/v1/categories/cat-001/inventory')
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.soldCount).toBe(15);
      expect(res.body.data.availableQuantity).toBe(80);
    });
  });

  describe('PUT /api/v1/categories/:id/inventory', () => {
    it('should return 200 when successfully adjusting inventory', async () => {
      const mockUpdated = {
        categoryId: 'cat-001',
        totalQuantity: 150,
        availableQuantity: 130,
        reservedQuantity: 5,
        soldCount: 15,
      };

      jest.spyOn(eventService, 'updateCategoryInventory').mockResolvedValue(mockUpdated);

      const res = await request(app)
        .put('/api/v1/categories/cat-001/inventory')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ totalQuantity: 150 });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalQuantity).toBe(150);
    });
  });
});
