import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import eventRoutes from './routes/event.routes.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import organizerRoutes from './routes/organizer.routes.js';
import adminRoutes from './routes/admin.routes.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

// Middlewares
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check Route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend server is running',
    timestamp: new Date().toISOString(),
  });
});

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

// Event & Category Routes
app.use('/api/v1', eventRoutes);
app.use('/api', eventRoutes);

// Centralized Error Handling Middleware (must be after routes)
app.use(errorHandler);

export default app;

