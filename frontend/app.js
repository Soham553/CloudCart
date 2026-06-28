// Initialize Configuration
const API_BASE = window.location.origin;
let sessionId = localStorage.getItem('cloudcart_session');
if (!sessionId) {
    sessionId = 'session_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString().slice(-4);
    localStorage.setItem('cloudcart_session', sessionId);
}

// Global Observability Metrics State
const metrics = {
    hits: parseInt(localStorage.getItem('metrics_hits')) || 0,
    misses: parseInt(localStorage.getItem('metrics_misses')) || 0,
};

// SVG icons registry for products
const ICONS = {
    kubes: `<svg class="visual-icon" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    db: `<svg class="visual-icon" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    cache: `<svg class="visual-icon" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    pipeline: `<svg class="visual-icon" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 18V6M18 18V6M12 18V6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="8" r="3" fill="currentColor"/><circle cx="18" cy="16" r="3" fill="currentColor"/></svg>`,
    chart: `<svg class="visual-icon" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 20V10M12 20V4M6 20v-6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    lock: `<svg class="visual-icon" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};

// DOM Elements
const productsGrid = document.getElementById('products-grid');
const cartItemsContainer = document.getElementById('cart-items');
const cartSummary = document.getElementById('cart-summary');
const cartTotalElement = document.getElementById('cart-total');
const cartBadge = document.getElementById('cart-badge');
const ordersList = document.getElementById('orders-list');
const terminalBody = document.getElementById('terminal-body');
const tabDevops = document.getElementById('tab-devops');
const tabCart = document.getElementById('tab-cart');
const contentDevops = document.getElementById('content-devops');
const contentCart = document.getElementById('content-cart');
const statusPostgres = document.getElementById('status-postgres');
const statusRedis = document.getElementById('status-redis');
const metricLatency = document.getElementById('metric-latency');
const metricSource = document.getElementById('metric-source');
const metricCacheRatio = document.getElementById('metric-cache-ratio');
const ratioBarFill = document.getElementById('ratio-bar-fill');
const cacheHitsElement = document.getElementById('cache-hits');
const cacheMissesElement = document.getElementById('cache-misses');
const resetMetricsBtn = document.getElementById('reset-metrics-btn');
const checkoutForm = document.getElementById('checkout-form');
const cartToggleBtn = document.getElementById('cart-toggle-btn');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Global App State
let appProducts = [];
let appCart = [];

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
    setupTabSwitching();
    updateMetricsUI();
    
    // Initial fetch sequences
    fetchProducts();
    fetchCart();
    fetchOrders();

    // Start background health monitor loop
    setInterval(runHealthCheck, 5000);
    runHealthCheck(); // First call immediately
});

// Toast system
function showToast(message, type = 'info') {
    toastMessage.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

// Log message inside the custom terminal
function logToTerminal(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.innerHTML = `<span class="system">[${timestamp}]</span> ${message}`;
    terminalBody.appendChild(line);
    
    // Auto-scroll terminal
    terminalBody.scrollTop = terminalBody.scrollHeight;
    
    // Cap logs inside terminal to 50 lines to keep viewport light
    while (terminalBody.childElementCount > 50) {
        terminalBody.removeChild(terminalBody.firstChild);
    }
}

// Tab switcher handler
function setupTabSwitching() {
    tabDevops.addEventListener('click', () => {
        tabDevops.classList.add('active');
        tabCart.classList.remove('active');
        contentDevops.classList.add('active');
        contentCart.classList.remove('active');
    });

    tabCart.addEventListener('click', () => {
        tabCart.classList.add('active');
        tabDevops.classList.remove('active');
        contentCart.classList.add('active');
        contentDevops.classList.remove('active');
    });

    cartToggleBtn.addEventListener('click', () => {
        tabCart.click(); // Programmatically open cart tab
    });

    resetMetricsBtn.addEventListener('click', () => {
        metrics.hits = 0;
        metrics.misses = 0;
        localStorage.setItem('metrics_hits', 0);
        localStorage.setItem('metrics_misses', 0);
        updateMetricsUI();
        logToTerminal('Observability metrics reset successfully.', 'system');
    });
}

// Update local metrics tracking
function updateMetricsUI() {
    cacheHitsElement.textContent = metrics.hits;
    cacheMissesElement.textContent = metrics.misses;
    
    const total = metrics.hits + metrics.misses;
    let ratio = 0;
    if (total > 0) {
        ratio = Math.round((metrics.hits / total) * 100);
    }
    
    metricCacheRatio.textContent = `${ratio}%`;
    ratioBarFill.style.width = `${ratio}%`;
}

// Fetch all catalog products
async function fetchProducts() {
    const startTime = performance.now();
    try {
        const response = await fetch(`${API_BASE}/api/products`);
        const latency = Math.round(performance.now() - startTime);
        
        if (!response.ok) throw new Error('API server returned error status');
        
        const resJson = await response.json();
        appProducts = resJson.data;
        
        // Read response headers & state for caching observability
        const source = resJson.source; // 'redis-cache' or 'postgres-db'
        
        // Update dashboard observabilities
        metricLatency.textContent = `${latency} ms`;
        metricSource.textContent = source === 'redis-cache' ? 'REDIS CACHE' : 'POSTGRESQL DB';
        
        if (source === 'redis-cache') {
            metricSource.className = 'metric-val source-pill source-cache';
            metrics.hits++;
            localStorage.setItem('metrics_hits', metrics.hits);
            logToTerminal(`GET /api/products -> <span class="success">CACHE HIT</span> (Source: Redis, Latency: ${latency}ms)`, 'success');
        } else {
            metricSource.className = 'metric-val source-pill source-db';
            metrics.misses++;
            localStorage.setItem('metrics_misses', metrics.misses);
            logToTerminal(`GET /api/products -> <span class="warning">CACHE MISS</span> (Source: PostgreSQL, Latency: ${latency}ms)`, 'warning');
        }
        
        updateMetricsUI();
        renderProducts();
    } catch (err) {
        const latency = Math.round(performance.now() - startTime);
        metricLatency.textContent = `${latency} ms`;
        metricSource.textContent = 'OFFLINE';
        metricSource.className = 'metric-val source-pill status-down';
        
        logToTerminal(`GET /api/products -> <span class="error">FAILED</span> (Latency: ${latency}ms, Error: ${err.message})`, 'error');
        productsGrid.innerHTML = `
            <div class="loading-state">
                <p class="text-danger">Failed to fetch products. Ensure backend service is running.</p>
                <button class="btn btn-secondary" onclick="fetchProducts()">Retry Connection</button>
            </div>
        `;
    }
}

// Render products list into grid
function renderProducts() {
    if (appProducts.length === 0) {
        productsGrid.innerHTML = '<div class="empty-state">No products found in the catalog.</div>';
        return;
    }

    productsGrid.innerHTML = appProducts.map(product => {
        const iconSVG = ICONS[product.icon] || '☁️';
        const isOutOfStock = product.stock <= 0;
        let stockClass = 'stock-in';
        let stockText = `${product.stock} node clusters remaining`;
        
        if (isOutOfStock) {
            stockClass = 'stock-out';
            stockText = 'Out of Stock';
        } else if (product.stock <= 10) {
            stockClass = 'stock-low';
            stockText = `Low Stock: ${product.stock} units left`;
        }

        // Generate glowing variables from the DB gradients
        const cardStyle = `style="--card-glow: ${product.gradient_from}33; background: linear-gradient(135deg, ${product.gradient_from}1a 0%, rgba(14, 19, 32, 0.9) 80%);"`;
        const visualStyle = `style="background: linear-gradient(135deg, ${product.gradient_from} 0%, ${product.gradient_to} 100%);"`;

        return `
            <div class="product-card" ${cardStyle}>
                <div class="card-visual" ${visualStyle}>
                    ${iconSVG}
                </div>
                <div class="card-details">
                    <h3 class="product-name">${product.name}</h3>
                    <p class="product-desc">${product.description}</p>
                    <div class="product-meta">
                        <span class="product-price">$${parseFloat(product.price).toFixed(2)}/mo</span>
                        <span class="product-stock ${stockClass}">${stockText}</span>
                    </div>
                    <button 
                        class="btn btn-primary btn-block" 
                        onclick="handleAddToCart(${product.id})" 
                        ${isOutOfStock ? 'disabled' : ''}>
                        ${isOutOfStock ? 'Decommissioned' : '🔌 Provision Item'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Fetch active shopping cart
async function fetchCart() {
    try {
        const response = await fetch(`${API_BASE}/api/cart`, {
            headers: { 'X-Session-ID': sessionId }
        });
        if (!response.ok) throw new Error('Failed to retrieve cart items');
        
        appCart = await response.json();
        renderCart();
    } catch (err) {
        logToTerminal(`GET /api/cart -> <span class="error">ERROR</span> (${err.message})`, 'error');
    }
}

// Add/Update cart helper
async function handleAddToCart(productId) {
    const existing = appCart.find(item => item.id === productId);
    const newQty = existing ? existing.quantity + 1 : 1;
    
    // Check if adding exceeds product stock count
    const product = appProducts.find(p => p.id === productId);
    if (product && newQty > product.stock) {
        showToast(`Cannot add more. Max stock limit reached (${product.stock}).`, 'warning');
        return;
    }

    try {
        logToTerminal(`POST /api/cart -> Adding Product ID ${productId} to cache...`, 'info');
        const response = await fetch(`${API_BASE}/api/cart`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({ productId, quantity: newQty })
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Cart update failed');
        }
        
        appCart = data;
        renderCart();
        showToast(`${product ? product.name : 'Infrastructure'} added to provisioning pipeline.`, 'success');
        logToTerminal(`POST /api/cart -> Redis session cart updated.`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
        logToTerminal(`POST /api/cart -> <span class="error">FAILED</span> (${err.message})`, 'error');
    }
}

// Change cart item quantity (plus/minus)
async function updateCartQuantity(productId, currentQty, delta) {
    const targetQty = currentQty + delta;
    const product = appProducts.find(p => p.id === productId);

    if (product && targetQty > product.stock) {
        showToast(`Stock ceiling reached. Available nodes: ${product.stock}`, 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/cart`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({ productId, quantity: targetQty })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Cart qty change failed');
        
        appCart = data;
        renderCart();
        logToTerminal(`POST /api/cart -> Update quantity for product ${productId} to ${targetQty}.`, 'info');
    } catch (err) {
        showToast(err.message, 'error');
        logToTerminal(`POST /api/cart -> <span class="error">QTY UPDATE FAILED</span> (${err.message})`, 'error');
    }
}

// Render cart contents
function renderCart() {
    // Render cart count badge
    const totalItems = appCart.reduce((sum, item) => sum + item.quantity, 0);
    cartBadge.textContent = totalItems;
    
    if (appCart.length === 0) {
        cartItemsContainer.innerHTML = '<div class="empty-state">Your shopping cart is empty. Add infrastructure items to build your stack!</div>';
        cartSummary.classList.add('hidden');
        return;
    }

    cartItemsContainer.innerHTML = appCart.map(item => {
        const visualBg = `style="background: linear-gradient(135deg, ${item.gradient_from} 0%, ${item.gradient_to} 100%);"`;
        const iconSVG = ICONS[item.icon] || '☁️';
        return `
            <div class="cart-item">
                <div class="cart-item-visual" ${visualBg}>
                    ${iconSVG}
                </div>
                <div class="cart-item-details">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-price">$${parseFloat(item.price).toFixed(2)}/mo</div>
                </div>
                <div class="cart-item-actions">
                    <button class="quantity-btn" onclick="updateCartQuantity(${item.id}, ${item.quantity}, -1)">-</button>
                    <span class="cart-item-qty">${item.quantity}</span>
                    <button class="quantity-btn" onclick="updateCartQuantity(${item.id}, ${item.quantity}, 1)">+</button>
                </div>
            </div>
        `;
    }).join('');

    const totalPrice = appCart.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
    cartTotalElement.textContent = `$${totalPrice.toFixed(2)}`;
    cartSummary.classList.remove('hidden');
}

// Fetch past orders from Postgres
async function fetchOrders() {
    try {
        const response = await fetch(`${API_BASE}/api/orders`);
        if (!response.ok) throw new Error('API server returned database error');
        
        const orders = await response.json();
        renderOrders(orders);
    } catch (err) {
        logToTerminal(`GET /api/orders -> <span class="error">DATABASE UNREACHABLE</span> (${err.message})`, 'error');
    }
}

// Render past orders
function renderOrders(orders) {
    if (orders.length === 0) {
        ordersList.innerHTML = '<div class="empty-state">No recent orders found. Place an order to see it stored in PostgreSQL.</div>';
        return;
    }

    ordersList.innerHTML = orders.map(order => {
        const dateStr = new Date(order.created_at).toLocaleString();
        const itemsTag = order.items.map(item => `${item.name} (x${item.quantity})`).join(', ');
        
        return `
            <div class="order-card">
                <div class="order-card-header">
                    <div class="order-meta-info">
                        <h4>Order ID: #${order.id}</h4>
                        <div class="order-owner">Owner: ${order.customer_name} (${order.customer_email})</div>
                        <div class="order-owner">Provisioned: ${dateStr}</div>
                    </div>
                    <div class="order-price">$${parseFloat(order.total_amount).toFixed(2)}</div>
                </div>
                <div class="order-items-summary">
                    ${order.items.map(item => `
                        <span class="order-item-tag" style="border-color: ${item.gradient_from}80; background: ${item.gradient_from}0a;">
                            ${item.name} (${item.quantity}x)
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// Checkout cart form submit
checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('checkout-name').value.trim();
    const email = document.getElementById('checkout-email').value.trim();
    
    if (!name || !email) {
        showToast('Please enter both name and email.', 'warning');
        return;
    }

    const deployBtn = document.getElementById('checkout-btn');
    deployBtn.disabled = true;
    deployBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;margin:0;"></span> Deploying Stack...';

    try {
        logToTerminal(`POST /api/cart/checkout -> Submitting provision request transaction...`, 'info');
        const response = await fetch(`${API_BASE}/api/cart/checkout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId
            },
            body: JSON.stringify({ customerName: name, customerEmail: email })
        });
        
        const resJson = await response.json();
        if (!response.ok) {
            throw new Error(resJson.error || 'Provisioning failed');
        }

        logToTerminal(`POST /api/cart/checkout -> <span class="success">DEPLOYMENT SUCCESSFUL</span>. Order #${resJson.orderId} committed.`, 'success');
        showToast('Infrastructure Provisioned Successfully!', 'success');
        
        // Reset states
        document.getElementById('checkout-name').value = '';
        document.getElementById('checkout-email').value = '';
        
        // Update states
        appCart = [];
        renderCart();
        
        // Refresh products catalog & order ledger
        await fetchProducts();
        await fetchOrders();
        
        // Redirect to observer dashboard to visualize changes
        tabDevops.click();
    } catch (err) {
        showToast(err.message, 'error');
        logToTerminal(`POST /api/cart/checkout -> <span class="error">PROVISIONING TRANSACTION ERROR</span> (${err.message})`, 'error');
    } finally {
        deployBtn.disabled = false;
        deployBtn.innerHTML = '🚀 Deploy Infrastructure';
    }
});

// Periodic observer health checker
async function runHealthCheck() {
    try {
        const response = await fetch(`${API_BASE}/health`);
        const statusData = await response.json();
        
        // Parse services health
        const dbStatus = statusData.services.postgresql.status;
        const redisStatus = statusData.services.redis.status;
        
        // Update UI pill indicators
        updateHealthIndicator(statusPostgres, dbStatus);
        updateHealthIndicator(statusRedis, redisStatus);
        
        if (response.ok) {
            logToTerminal(`GET /health -> <span class="success">Status 200</span> (Postgres: ${dbStatus}, Redis: ${redisStatus})`, 'info');
        } else {
            logToTerminal(`GET /health -> <span class="warning">Status 500 [DEGRADED]</span> (Postgres: ${dbStatus}, Redis: ${redisStatus})`, 'warning');
        }
    } catch (err) {
        // Services completely down / server offline
        updateHealthIndicator(statusPostgres, 'DOWN');
        updateHealthIndicator(statusRedis, 'DOWN');
        logToTerminal(`GET /health -> <span class="error">CRITICAL CONNECTION ERROR</span> (Server offline or unreachable)`, 'error');
    }
}

// Set health status pill styling
function updateHealthIndicator(element, status) {
    element.textContent = status;
    if (status === 'UP') {
        element.className = 'status-pill status-up';
    } else if (status === 'DOWN') {
        element.className = 'status-pill status-down';
    } else {
        element.className = 'status-pill status-unknown';
    }
}
