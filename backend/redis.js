const { createClient } = require('redis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || '6379';
const redisPassword = process.env.REDIS_PASSWORD || '';

let redisUrl = 'redis://';
if (redisPassword) {
  redisUrl += `:${redisPassword}@`;
}
redisUrl += `${redisHost}:${redisPort}`;

const client = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries) => {
      // Reconnect strategy: try every 3 seconds, up to 100 times
      if (retries > 100) {
        return new Error('Redis connection retries exhausted');
      }
      return 3000;
    }
  }
});

let isConnected = false;

client.on('connect', () => {
  console.log('[Redis] Connection handshake started...');
});

client.on('ready', () => {
  isConnected = true;
  console.log('[Redis] Client connected and ready!');
});

client.on('error', (err) => {
  isConnected = false;
  console.error(`[Redis] Client Error: ${err.message}`);
});

client.on('end', () => {
  isConnected = false;
  console.log('[Redis] Client disconnected.');
});

async function initRedis() {
  try {
    console.log(`[Redis] Connecting to Redis at ${redisHost}:${redisPort}...`);
    await client.connect();
  } catch (err) {
    console.error(`[Redis] Initial connection attempt failed: ${err.message}`);
    // We don't call process.exit(1) because we want the app to be resilient
    // and run in a degraded state (Postgres-only) if Redis is down.
  }
}

// Resilient helper to get a cache value
async function get(key) {
  if (!isConnected) return null;
  try {
    return await client.get(key);
  } catch (err) {
    console.error(`[Redis] GET failed for key ${key}: ${err.message}`);
    return null;
  }
}

// Resilient helper to set a cache value with an optional TTL (in seconds)
async function set(key, value, ttlSeconds = null) {
  if (!isConnected) return false;
  try {
    if (ttlSeconds) {
      await client.set(key, value, { EX: ttlSeconds });
    } else {
      await client.set(key, value);
    }
    return true;
  } catch (err) {
    console.error(`[Redis] SET failed for key ${key}: ${err.message}`);
    return false;
  }
}

// Resilient helper to delete a cache key
async function del(key) {
  if (!isConnected) return false;
  try {
    await client.del(key);
    return true;
  } catch (err) {
    console.error(`[Redis] DEL failed for key ${key}: ${err.message}`);
    return false;
  }
}

module.exports = {
  client,
  initRedis,
  get,
  set,
  del,
  getIsConnected: () => isConnected
};
