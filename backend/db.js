const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'cloudcart'
});

async function initDb() {
  const maxRetries = 10;
  const retryDelay = 3000; // 3 seconds
  let client;

  for (let i = 1; i <= maxRetries; i++) {
    try {
      console.log(`[Database] Connecting to PostgreSQL at ${pool.options.host}:${pool.options.port} (Attempt ${i}/${maxRetries})...`);
      client = await pool.connect();
      console.log('[Database] Connected to PostgreSQL successfully!');
      break;
    } catch (err) {
      console.error(`[Database] Connection attempt ${i} failed. Error: ${err.message}`);
      if (i === maxRetries) {
        console.error('[Database] Maximum retries reached. Database initialization failed.');
        process.exit(1);
      }
      console.log(`[Database] Retrying in ${retryDelay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  try {
    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        gradient_from VARCHAR(50),
        gradient_to VARCHAR(50),
        icon VARCHAR(50)
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(100) NOT NULL,
        customer_email VARCHAR(100) NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'pending',
        progress INTEGER DEFAULT 0
      );
    `);

    // Ensure status and progress columns exist in existing database schemas
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
    `);
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER NOT NULL,
        price DECIMAL(10, 2) NOT NULL
      );
    `);

    // Check if products exist, if not seed them
    const res = await client.query('SELECT COUNT(*) FROM products');
    if (parseInt(res.rows[0].count) === 0) {
      console.log('[Database] Seeding initial product catalog...');
      const seedQuery = `
        INSERT INTO products (name, description, price, stock, gradient_from, gradient_to, icon) VALUES
        ('Kubernetes Cluster', 'Fully managed K8s cluster with automatic scaling, high availability, and integrated monitoring.', 149.00, 25, '#8b5cf6', '#3b82f6', 'kubes'),
        ('PostgreSQL Database', 'High-performance PostgreSQL instance with automated daily backups and cross-region replication.', 49.00, 50, '#3b82f6', '#06b6d4', 'db'),
        ('Redis Cache Store', 'In-memory database for blazing-fast caching, pub/sub messaging, and session storage.', 19.00, 100, '#ef4444', '#f97316', 'cache'),
        ('CI/CD Pipeline Builder', 'Automate your deployments with custom build, test, and release workflows. Includes parallel execution.', 29.00, 75, '#10b981', '#3b82f6', 'pipeline'),
        ('Monitoring Dashboard', 'Real-time infrastructure and application observability with Prometheus metrics and Grafana charts.', 39.00, 40, '#f59e0b', '#ef4444', 'chart'),
        ('SSL Certificate Manager', 'Automated certificate renewal and SSL/TLS termination at the edge for all your domain routes.', 9.00, 200, '#06b6d4', '#10b981', 'lock');
      `;
      await client.query(seedQuery);
      console.log('[Database] Seeded product catalog successfully.');
    }
  } catch (err) {
    console.error('[Database] Schema initialization failed:', err);
    throw err;
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  initDb
};
