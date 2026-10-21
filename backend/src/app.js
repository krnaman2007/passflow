import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import eventRoutes from './routes/event.routes.js';
import authRoutes from './routes/auth.routes.js';
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

// Event & Category Routes
app.use('/api/v1', eventRoutes);
app.use('/api', eventRoutes);

// Centralized Error Handling Middleware (must be after routes)
app.use(errorHandler);

export default app;

