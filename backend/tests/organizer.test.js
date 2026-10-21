import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/db/prisma.js';

describe('Organizer API Endpoints (/organizers)', () => {
  jest.setTimeout(30000);

  const timestamp = Date.now();
  const testUser = {
    name: 'Org Applicant',
    email: `orgapplicant_${timestamp}@example.com`,
    password: 'Password123!',
    phone: '+919876501234',
  };

  const plainUser = {
    name: 'Regular User',
    email: `regularuser_${timestamp}@example.com`,
    password: 'Password123!',
    phone: '+919876505678',
  };

  let applicantToken = null;
  let applicantId = null;
  let regularToken = null;
  let regularId = null;
  let createdEventId = null;

  beforeAll(async () => {
    // Register applicant user
    const applicantRes = await request(app)
      .post('/auth/register')
      .send(testUser)
      .expect(201);
    applicantToken = applicantRes.body.data.tokens.accessToken;
    applicantId = applicantRes.body.data.user.id;

    // Register a regular user (who never applies for organizer)
    const regularRes = await request(app)
      .post('/auth/register')
      .send(plainUser)
      .expect(201);
    regularToken = regularRes.body.data.tokens.accessToken;
    regularId = regularRes.body.data.user.id;
  });

  afterAll(async () => {
    if (createdEventId) {
      await prisma.ticketCategory.deleteMany({ where: { eventId: createdEventId } });
      await prisma.event.deleteMany({ where: { id: createdEventId } });
    }
    const userIds = [applicantId, regularId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.buyerSeller.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.organizer.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  describe('POST /organizers/apply', () => {
    it('should reject application without authentication (401 Unauthorized)', async () => {
      const response = await request(app)
        .post('/organizers/apply')
        .send({ organizationName: 'My Events Inc.' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject application with invalid organization name (400 Bad Request)', async () => {
      const response = await request(app)
        .post('/organizers/apply')
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ organizationName: 'X' }) // Too short
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should successfully submit an organizer application (201 Created)', async () => {
      const response = await request(app)
        .post('/organizers/apply')
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ organizationName: 'PassFlow Productions' })
        .expect(201);

      expect(response.body.success).toBe(true);
      const data = response.body.data;
      expect(data.organizer).toBeDefined();
      expect(data.organizer.organizationName).toBe('PassFlow Productions');
      expect(data.organizer.verificationStatus).toBe('PENDING');
      expect(data.organizer.userId).toBe(applicantId);
    });

    it('should reject duplicate organizer application (409 Conflict)', async () => {
      const response = await request(app)
        .post('/organizers/apply')
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ organizationName: 'Duplicate Production' })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ORGANIZER_EXISTS');
    });
  });

  describe('GET /organizers/me', () => {
    it('should reject user without an organizer profile (403 Forbidden)', async () => {
      const response = await request(app)
        .get('/organizers/me')
        .set('Authorization', `Bearer ${regularToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should return organizer profile and verification status', async () => {
      const response = await request(app)
        .get('/organizers/me')
        .set('Authorization', `Bearer ${applicantToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const organizer = response.body.data;
      expect(organizer.organizationName).toBe('PassFlow Productions');
      expect(organizer.verificationStatus).toBe('PENDING');
      expect(organizer.userId).toBe(applicantId);
      expect(organizer.user).toBeDefined();
      expect(organizer.user.email).toBe(testUser.email.toLowerCase());
    });
  });

  describe('GET /organizers/me/events', () => {
    it('should return empty events list for new organizer', async () => {
      const response = await request(app)
        .get('/organizers/me/events')
        .set('Authorization', `Bearer ${applicantToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.events).toEqual([]);
      expect(response.body.data.total).toBe(0);
    });

    it('should return events created by this organizer', async () => {
      // Find organizer record
      const org = await prisma.organizer.findUnique({
        where: { userId: applicantId },
      });

      // Create an event under this organizer
      const event = await prisma.event.create({
        data: {
          name: 'Electronic Dream Festival',
          dateTime: new Date(Date.now() + 86400000 * 30),
          location: 'Goa Coastline',
          organizerId: org.id,
          status: 'DRAFT',
          originalPrice: 2500.0,
        },
      });
      createdEventId = event.id;

      const response = await request(app)
        .get('/organizers/me/events')
        .set('Authorization', `Bearer ${applicantToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.events[0].name).toBe('Electronic Dream Festival');
      expect(response.body.data.events[0].organizerId).toBe(org.id);
    });
  });
});
