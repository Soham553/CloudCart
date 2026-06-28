const express = require('express');
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

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

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

// 2. Get shopping cart (from Redis)
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

// 3. Add or update item in shopping cart (stored in Redis)
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
    // Get product to verify it exists and get stock
    const prodRes = await db.query('SELECT id, name, price, stock, gradient_from, gradient_to, icon FROM products WHERE id = $1', [productId]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const product = prodRes.rows[0];

    // Get current cart
    const cartData = await redis.get(`cart:${sessionId}`);
    let items = cartData ? JSON.parse(cartData) : [];

    // Find if product already in cart
    const itemIndex = items.findIndex(item => item.id === parseInt(productId));

    if (quantity <= 0) {
      // Remove from cart
      if (itemIndex > -1) {
        items.splice(itemIndex, 1);
      }
    } else {
      // Check stock limits
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

    // Save cart to Redis with 24 hours expiration
    await redis.set(`cart:${sessionId}`, JSON.stringify(items), 86400);

    return res.json(items);
  } catch (err) {
    console.error('[API] Error in POST /api/cart:', err);
    return res.status(500).json({ error: 'Failed to update cart' });
  }
});

// 4. Cart checkout (transfers Redis cart items to PostgreSQL order tables)
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
    // Get cart
    const cartData = await redis.get(`cart:${sessionId}`);
    if (!cartData) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const items = JSON.parse(cartData);
    if (items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Start database connection for transaction
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Double check stock for all items
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
        
        // Calculate total amount based on DB prices
        totalAmount += parseFloat(product.price) * item.quantity;
      }

      // 2. Insert order
      const orderRes = await client.query(
        'INSERT INTO orders (customer_name, customer_email, total_amount) VALUES ($1, $2, $3) RETURNING id, created_at',
        [customerName, customerEmail, totalAmount]
      );
      const orderId = orderRes.rows[0].id;
      const createdAt = orderRes.rows[0].created_at;

      // 3. Insert order items & update product stock
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

      // 4. Clear cache and cart
      await redis.del('products:all'); // Invalidate product cache to update stock counts
      await redis.del(`cart:${sessionId}`); // Clear Redis cart

      return res.json({
        success: true,
        orderId,
        totalAmount,
        createdAt,
        message: 'Order placed successfully!'
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

// 5. Get recent checkout orders (from PostgreSQL)
app.get('/api/orders', async (req, res) => {
  try {
    const ordersRes = await db.query(`
      SELECT o.id, o.customer_name, o.customer_email, o.total_amount, o.created_at,
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

// 6. Comprehensive Service Health Endpoint (for Docker/K8s probes)
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
