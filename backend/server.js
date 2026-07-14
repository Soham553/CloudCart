import express from 'express';
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const db = require('./db');
const redis = require('./redis');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend API calls
app.use(cors());
app.use(express.json());

// Log API requests
app.use(morgan('dev'));

// Global Chaos State
let chaosLatencyActive = false;

// Chaos Latency Middleware
app.use((req, res, next) => {
  if (chaosLatencyActive && req.path.startsWith('/api')) {
    console.log(`[Chaos Monkey] Injected 2000ms delay for ${req.method} ${req.path}`);
    setTimeout(next, 2000);
  } else {
    next();
  }
});

// Serve frontend static files from compiled Vite folder
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// --- API ROUTES ---

// 1. Get all products (with Redis cache-aside)
app.get('/api/products', async (req, res) => {
  try {
    // Attempt cache hit
    const cachedProducts = await redis.get('products:all');
    if (cachedProducts) {
      res.setHeader('X-Source', 'redis-cache');
      return res.json({
        source: 'redis-cache',
        data: JSON.parse(cachedProducts)
      });
    }

    // Cache miss - query Postgres
    console.log('[API] Cache miss for products:all. Querying PostgreSQL database...');
    const result = await db.query('SELECT * FROM products ORDER BY id ASC');
    const products = result.rows;

    // Cache products with a 60-second TTL
    await redis.set('products:all', JSON.stringify(products), 60);

    res.setHeader('X-Source', 'postgres-db');
    return res.json({
      source: 'postgres-db',
      data: products
    });
  } catch (err) {
    console.error('[API] Error in GET /api/products:', err);
    return res.status(500).json({ error: 'Failed to retrieve products' });
  }
});

// 2. Create a new product (evicts products:all cache)
app.post('/api/products', async (req, res) => {
  const { name, description, price, stock, icon, gradientFrom, gradientTo } = req.body;
  if (!name || price === undefined || stock === undefined) {
    return res.status(400).json({ error: 'Name, price, and stock are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO products (name, description, price, stock, icon, gradient_from, gradient_to) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, description || '', price, stock, icon || 'kubes', gradientFrom || '#8b5cf6', gradientTo || '#3b82f6']
    );

    // Evict cache
    await redis.del('products:all');
    console.log('[API] Registered new product in Postgres. Evicted products:all cache.');

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[API] Error in POST /api/products:', err);
    return res.status(500).json({ error: 'Failed to create product' });
  }
});

// 3. Delete a product (evicts cache and cleans active carts in Redis)
app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM products WHERE id = $1', [id]);
    await redis.del('products:all');
    console.log(`[API] Deleted product ID ${id}. Evicted products:all cache.`);

    return res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    console.error('[API] Error in DELETE /api/products:', err);
    return res.status(500).json({ error: 'Failed to delete product' });
  }
});

// 4. Get shopping cart (from Redis)
app.get('/api/cart', async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing X-Session-ID header' });
  }

  try {
    const cartData = await redis.get(`cart:${sessionId}`);
    const items = cartData ? JSON.parse(cartData) : [];
    return res.json(items);
  } catch (err) {
    console.error('[API] Error in GET /api/cart:', err);
    return res.status(500).json({ error: 'Failed to retrieve cart' });
  }
});

// 5. Add or update item in shopping cart (stored in Redis)
app.post('/api/cart', async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  const { productId, quantity } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing X-Session-ID header' });
  }
  if (productId === undefined || quantity === undefined) {
    return res.status(400).json({ error: 'Missing productId or quantity' });
  }

  try {
    const prodRes = await db.query('SELECT id, name, price, stock, gradient_from, gradient_to, icon FROM products WHERE id = $1', [productId]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const product = prodRes.rows[0];

    const cartData = await redis.get(`cart:${sessionId}`);
    let items = cartData ? JSON.parse(cartData) : [];

    const itemIndex = items.findIndex(item => item.id === parseInt(productId));

    if (quantity <= 0) {
      if (itemIndex > -1) {
        items.splice(itemIndex, 1);
      }
    } else {
      if (quantity > product.stock) {
        return res.status(400).json({ error: `Only ${product.stock} units available in stock.` });
      }

      if (itemIndex > -1) {
        items[itemIndex].quantity = quantity;
      } else {
        items.push({
          id: product.id,
          name: product.name,
          price: product.price,
          gradient_from: product.gradient_from,
          gradient_to: product.gradient_to,
          icon: product.icon,
          quantity: quantity
        });
      }
    }

    await redis.set(`cart:${sessionId}`, JSON.stringify(items), 86400);

    return res.json(items);
  } catch (err) {
    console.error('[API] Error in POST /api/cart:', err);
    return res.status(500).json({ error: 'Failed to update cart' });
  }
});

// 6. Cart checkout (transfers Redis cart items to PostgreSQL order tables)
app.post('/api/cart/checkout', async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  const { customerName, customerEmail } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing X-Session-ID header' });
  }
  if (!customerName || !customerEmail) {
    return res.status(400).json({ error: 'Customer name and email are required' });
  }

  try {
    const cartData = await redis.get(`cart:${sessionId}`);
    if (!cartData) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const items = JSON.parse(cartData);
    if (items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      let totalAmount = 0;
      for (const item of items) {
        const prodRes = await client.query('SELECT stock, price, name FROM products WHERE id = $1 FOR UPDATE', [item.id]);
        if (prodRes.rows.length === 0) {
          throw new Error(`Product not found: ${item.name}`);
        }
        const product = prodRes.rows[0];
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${item.name}. Available: ${product.stock}, Requested: ${item.quantity}`);
        }
        totalAmount += parseFloat(product.price) * item.quantity;
      }

      // Insert order with initial status 'pending' and progress 5%
      const orderRes = await client.query(
        'INSERT INTO orders (customer_name, customer_email, total_amount, status, progress) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
        [customerName, customerEmail, totalAmount, 'pending', 5]
      );
      const orderId = orderRes.rows[0].id;
      const createdAt = orderRes.rows[0].created_at;

      for (const item of items) {
        const prodRes = await client.query('SELECT price FROM products WHERE id = $1', [item.id]);
        const dbPrice = prodRes.rows[0].price;

        await client.query(
          'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
          [orderId, item.id, item.quantity, dbPrice]
        );

        await client.query(
          'UPDATE products SET stock = stock - $1 WHERE id = $2',
          [item.quantity, item.id]
        );
      }

      await client.query('COMMIT');

      // Clear cache and cart
      await redis.del('products:all');
      await redis.del(`cart:${sessionId}`);

      // Start asynchronous simulated cloud provisioning routine
      simulateProvisioning(orderId);

      return res.json({
        success: true,
        orderId,
        totalAmount,
        createdAt,
        message: 'Order placed, provisioning started!'
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      console.error('[API] Checkout transaction rolled back:', txErr.message);
      return res.status(400).json({ error: txErr.message });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[API] Error in POST /api/cart/checkout:', err);
    return res.status(500).json({ error: 'Internal server error during checkout' });
  }
});

// 7. Get order status & progress (for stepper polling)
app.get('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT status, progress FROM orders WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[API] Error in GET /api/orders/:id/status:', err);
    return res.status(500).json({ error: 'Failed to retrieve order status' });
  }
});

// 8. Get recent checkout orders (from PostgreSQL)
app.get('/api/orders', async (req, res) => {
  try {
    const ordersRes = await db.query(`
      SELECT o.id, o.customer_name, o.customer_email, o.total_amount, o.created_at, o.status, o.progress,
             json_agg(json_build_object(
               'id', p.id,
               'name', p.name,
               'quantity', oi.quantity,
               'price', oi.price,
               'gradient_from', p.gradient_from,
               'gradient_to', p.gradient_to,
               'icon', p.icon
             )) as items
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 10
    `);
    return res.json(ordersRes.rows);
  } catch (err) {
    console.error('[API] Error in GET /api/orders:', err);
    return res.status(500).json({ error: 'Failed to retrieve orders' });
  }
});

// 9. Chaos endpoints
app.post('/api/chaos/latency', (req, res) => {
  chaosLatencyActive = !chaosLatencyActive;
  console.log(`[Chaos Control] Latency simulation toggled to: ${chaosLatencyActive}`);
  return res.json({ latency: chaosLatencyActive });
});

app.post('/api/chaos/evict', async (req, res) => {
  try {
    await redis.del('products:all');
    console.log('[Chaos Control] Evicted cache products:all');
    return res.json({ success: true, message: 'Products list cache evicted' });
  } catch (err) {
    return res.status(500).json({ error: 'Eviction failed' });
  }
});

// 10. Comprehensive Service Health Endpoint (for Docker/K8s probes & UI dashboard)
app.get('/health', async (req, res) => {
  let postgresConnected = false;
  let redisConnected = false;

  // Check Postgres
  try {
    await db.query('SELECT 1');
    postgresConnected = true;
  } catch (err) {
    console.error('[Healthcheck] PostgreSQL connection check failed:', err.message);
  }

  // Check Redis
  redisConnected = redis.getIsConnected();

  const healthStatus = {
    status: (postgresConnected && redisConnected) ? 'UP' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    chaos: {
      latency: chaosLatencyActive
    },
    services: {
      postgresql: {
        status: postgresConnected ? 'UP' : 'DOWN'
      },
      redis: {
        status: redisConnected ? 'UP' : 'DOWN'
      }
    }
  };

  const statusCode = (postgresConnected && redisConnected) ? 200 : 500;
  return res.status(statusCode).json(healthStatus);
});

// Serve frontend React index.html for SPA wildcard routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') {
    return next();
  }
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Simulated cloud provisioning routine: updates progress in DB over 6 seconds
function simulateProvisioning(orderId) {
  let progress = 5;
  const interval = setInterval(async () => {
    progress += 20;
    let status = 'provisioning';
    if (progress >= 100) {
      progress = 100;
      status = 'completed';
      clearInterval(interval);
    }
    
    try {
      await db.query('UPDATE orders SET status = $1, progress = $2 WHERE id = $3', [status, progress, orderId]);
      console.log(`[Provisioner] Order #${orderId} update: status=${status}, progress=${progress}%`);
    } catch (err) {
      console.error(`[Provisioner] Failed to update progress for order #${orderId}:`, err.message);
      clearInterval(interval);
    }
  }, 1200);
}

// Initialize services and start server
async function startServer() {
  console.log('[System] Initializing backend services...');
  
  // 1. Initialize DB (will retry until successful)
  await db.initDb();
  
  // 2. Initialize Redis (won't block server start if it fails)
  await redis.initRedis();

  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` CloudCart Server running on http://localhost:${PORT}`);
    console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`==================================================`);
  });
}

startServer();
