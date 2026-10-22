import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import eventRoutes from './routes/event.routes.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import organizerRoutes from './routes/organizer.routes.js';
import adminRoutes from './routes/admin.routes.js';
import solvencyRoutes from './routes/solvency.routes.js';
import marketRoutes from './routes/market.routes.js';
import orderRoutes from './routes/order.routes.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

// Middlewares
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Liveness Check Route for deployment (GET /health, /api/health)
const healthCheckHandler = (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Backend server is running',
    timestamp: new Date().toISOString(),
  });
};
app.get('/health', healthCheckHandler);
app.get('/api/health', healthCheckHandler);
app.get('/api/v1/health', healthCheckHandler);

// Authentication Routes
app.use('/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);

// User & Profile Routes
app.use('/users', userRoutes);
app.use('/api/v1/users', userRoutes);

// Organizer Routes
app.use('/organizers', organizerRoutes);
app.use('/api/v1/organizers', organizerRoutes);

// Admin Routes
app.use('/admin', adminRoutes);
app.use('/api/v1/admin', adminRoutes);

// Solvency Verification Routes (Public)
app.use('/solvency', solvencyRoutes);
app.use('/api/v1/solvency', solvencyRoutes);

// Market Data & Analytics Routes (Public)
app.use('/market', marketRoutes);
app.use('/api/v1/market', marketRoutes);

// Secondary Market Order Routes (Authenticated)
app.use('/orders', orderRoutes);
app.use('/api/v1/orders', orderRoutes);

// Event & Category Routes
app.use(eventRoutes);
app.use('/api/v1', eventRoutes);
app.use('/api', eventRoutes);

// Centralized Error Handling Middleware (must be after routes)
app.use(errorHandler);

export default app;

