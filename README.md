# PassFlow Fullstack Project

A high-performance trading/financial fullstack application architecture equipped with modern web technologies.

## 📁 Directory Structure
```
passflow/
├── frontend/                     # React + Vite Client Application
│   ├── src/
│   │   ├── components/           # TradingView Lightweight Charts & UI components
│   │   ├── services/             # Socket.IO client setup
│   │   ├── store/                # Zustand global state store
│   │   ├── App.jsx               # Interactive Live Dashboard
│   │   ├── App.css               # Dashboard styling
│   │   ├── main.jsx              # React DOM entrypoint
│   │   └── index.css             # Base styles
│   ├── .env                      # Frontend environment variables
│   ├── .env.example              # Frontend environment template
│   ├── .gitignore                # Frontend git ignore rules
│   └── package.json
│
└── backend/                      # Node.js + Express Server (ES Modules)
    ├── docs/                     # Documentation files
    ├── prisma/
    │   └── schema.prisma         # Neon PostgreSQL Prisma schema
    ├── scripts/                  # Database & deployment scripts
    ├── tests/                    # All test suites
    │   ├── health.test.js        # Automated API tests with Jest & Supertest
    │   └── load/
    │       └── k6.js             # Load testing script using k6
    ├── src/
    │   ├── config/               # Centralized configuration (ports, URLs, secrets)
    │   ├── controllers/          # Request handlers
    │   ├── db/                   # Prisma client & connection handlers
    │   ├── errorlogging/         # Centralized error logger
    │   ├── middleware/           # Express custom middlewares
    │   ├── models/               # Data models
    │   ├── routes/               # API endpoint routes
    │   ├── schemas/              # Zod request validation schemas
    │   ├── services/             # Core business logic services
    │   ├── utils/                # Helper utilities
    │   └── app.js                # Express app setup, CORS & middlewares
    ├── .env                      # Backend environment secrets
    ├── .env.example              # Backend environment template
    ├── .gitignore                # Backend git ignore rules
    ├── nodemon.json              # Development file-watch configuration
    ├── server.js                 # Server entrypoint (HTTP, Socket.IO & DB checks)
    └── package.json
```

---

## 🛠️ Installed Technologies & Where They Are Located

| Library / Tool | Location | Installation / Configuration |
| :--- | :--- | :--- |
| **React** | `frontend/` | Vite + React 19 template |
| **Node.js + Express.js** | `backend/` | `express`, `cors`, `dotenv` (ES Modules) |
| **PostgreSQL + Prisma** | `backend/` | `prisma`, `@prisma/client`, `prisma/schema.prisma` (NeonDB) |
| **Socket.IO** | Both | `socket.io-client` in `frontend/`, `socket.io` in `backend/` |
| **Zustand** | `frontend/` | `src/store/useStore.js` |
| **Redis** | `backend/` | `ioredis`, `redis` clients configured in `src/db/redis.js` |
| **Lightweight Charts** | `frontend/` | `lightweight-charts` (TradingView Candlestick) |
| **Decimal.js** | Both | High-precision arithmetic (`0.1 + 0.2 === 0.3`) |
| **jsonwebtoken (JWT)** | `backend/` | Authentication token generation & verification |
| **Zod** | `backend/` | Request schema validation in `src/schemas/` |
| **Jest + Supertest** | `backend/` | Automated API testing suite (`npm test`) |
| **k6** | `backend/` | Load testing script in `backend/tests/load/k6.js` |

---

## 🚀 How to Run the Project

### 1. Start the Backend
Open a terminal in the `backend` folder:
```bash
cd backend
npm run dev
```
> Backend runs at: `http://localhost:5001`

### 2. Start the Frontend
Open another terminal in the `frontend` folder:
```bash
cd frontend
npm run dev
```
> Frontend runs at: `http://localhost:5173`

### 3. Run Backend Automated Tests (Jest + Supertest)
In the `backend` directory:
```bash
cd backend
npm test
```

### 4. Run Load Tests with k6
If you have `k6` installed ([Install k6](https://k6.io/docs/get-started/installation/)):
```bash
k6 run backend/tests/load/k6.js
```
*(On Windows, install via PowerShell: `winget install grafana.k6`)*

---

## 🗄️ Database & Environment Setup

1. **PostgreSQL (NeonDB)**:
   - NeonDB connection strings are configured in [backend/.env](file:///c:/Users/krnam/OneDrive/Desktop/passflow/backend/.env):
     ```env
     DATABASE_URL="postgresql://neondb_owner:...-pooler.../neondb?sslmode=require"
     DIRECT_URL="postgresql://neondb_owner:.../neondb?sslmode=require"
     ```
   - Push your schema to NeonDB:
     ```bash
     cd backend
     npx prisma db push
     ```
   - View data visually with Prisma Studio:
     ```bash
     npx prisma studio
     ```

2. **Redis**:
   - Ready in `src/db/redis.js` (uncomment whenever Redis server or Upstash URL is configured).
