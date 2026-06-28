# CloudCart ☁️🛒

Welcome to **CloudCart**, a sandbox e-commerce application engineered specifically for DevOps learners!

This project has been built using **Node.js (Express)**, **PostgreSQL**, and **Redis**. It is designed to act as a realistic, decoupled backend-frontend environment where you can practice key DevOps practices:
- **Dockerization**: Containerize the Express server, static frontend (e.g. using Nginx), PostgreSQL, and Redis.
- **Docker Compose Orchestration**: Run multi-container setups and verify connection handling.
- **Liveness & Readiness Probes / Healthchecks**: Build health monitoring checks using the application's built-in observer endpoints.
- **CI/CD Pipelines**: Automate building, linting, testing, and deploying.
- **Fault-Tolerance Verification**: Test what happens when services go offline (e.g., stop the Redis container and observe the application degrade gracefully).

---

## 🛠️ Tech Stack & Features

1. **Express Backend (`/backend`)**:
   - Manages products catalog, cart storage, checkout orders, and server health.
   - Decoupled from static frontend to simulate microservice configurations.
   - Built-in **Connection Retry Loop** for PostgreSQL, allowing it to wait for the database on startup without crashing.
   - **Service Degradation Resilience**: If Redis goes offline, the app continues to serve products and database requests successfully (bypassing the cache).
   - Observability endpoints: `/health` returns service states for Kubernetes or Compose checks.

2. **Database & Caching**:
   - **PostgreSQL**: Stores persistent products catalog, checkout orders, and transaction ledgers.
   - **Redis**: Caches the catalog (`products:all` with 60s TTL) and stores volatile shopping cart sessions (`cart:session_id` with 24h TTL).

3. **Frontend Dashboard (`/frontend`)**:
   - Premium dark-theme interface with a glassmorphism aesthetic.
   - **DevOps Monitor Panel**: Displays real-time API request latencies, active database and cache status pills, and cache hit ratio statistics.
   - **Live Logs Terminal**: Outputs the observer logs of API queries, cache updates, database transactions, and health checks as they execute.

---

## 🚀 Running for Development

To run the application locally, you will need a running PostgreSQL database and Redis server.

### 1. Configure Environment
Create or edit the `.env` file at the root of the project with your local database credentials:
```ini
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=cloudcart
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### 2. Run Database & Redis
Ensure your local PostgreSQL database and Redis server are running.
*Note: The backend will automatically create tables (`products`, `orders`, `order_items`) and seed them with initial infrastructure items on its first run.*

### 3. Install & Start Backend
Open a terminal in the `/backend` directory and run:
```bash
npm install
npm run dev
```

The Express server will start up on the configured `PORT` (default: `5000`) and serve the static frontend from `/frontend` automatically! 

Open your browser and navigate to:
👉 **[http://localhost:5000](http://localhost:5000)**

---

## 🛠️ DevOps Practice Guide

Here are some suggested tasks you can build on top of this codebase:

1. **Dockerization**:
   - Create a `Dockerfile` for the backend Node.js application.
   - Write a separate `Dockerfile` or use an `nginx:alpine` image to serve the `/frontend` static folder separately.
2. **Docker Compose**:
   - Configure a `docker-compose.yml` that mounts postgres, redis, backend, and frontend containers.
   - Test container start dependencies (e.g. `depends_on`). Notice how the backend's retry-loop keeps it from crashing while Postgres boots up!
3. **Health Checking**:
   - Configure a liveness/readiness probe in your compose file or Kubernetes pods using the `/health` endpoint.
4. **observability**:
   - Stop the Redis container (`docker compose stop redis`) while keeping the rest running. Open the web interface, add items, and watch the DevOps Monitor show Redis as `DOWN` while the database remains `UP` (and the checkout still operates, proving service resilience!).
