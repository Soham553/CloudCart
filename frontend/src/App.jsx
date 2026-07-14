import React, { useState, useEffect, useRef } from 'react';

const API_BASE = window.location.port === '5173' ? 'http://localhost:5000' : window.location.origin;

// SVG icons registry
const ICONS = {
  kubes: <svg className="visual-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  db: <svg className="visual-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  cache: <svg className="visual-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  pipeline: <svg className="visual-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 18V6M18 18V6M12 18V6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="6" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="8" r="3" fill="currentColor"/><circle cx="18" cy="16" r="3" fill="currentColor"/></svg>,
  chart: <svg className="visual-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  lock: <svg className="visual-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" strokeLinejoin="round"/></svg>
};

export default function App() {
  const [sessionId] = useState(() => {
    let id = localStorage.getItem('cloudcart_session');
    if (!id) {
      id = 'session_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString().slice(-4);
      localStorage.setItem('cloudcart_session', id);
    }
    return id;
  });

  // State parameters
  const [activeTab, setActiveTab] = useState('devops');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [dbStatus, setDbStatus] = useState('CONNECTING');
  const [redisStatus, setRedisStatus] = useState('CONNECTING');
  
  // Observability & stats state
  const [latency, setLatency] = useState('--');
  const [latencyHistory, setLatencyHistory] = useState([10, 15, 12, 18, 14, 20]);
  const [dataSource, setDataSource] = useState('--');
  const [hits, setHits] = useState(() => parseInt(localStorage.getItem('metrics_hits')) || 0);
  const [misses, setMisses] = useState(() => parseInt(localStorage.getItem('metrics_misses')) || 0);
  
  // Chaos states
  const [chaosLatencyActive, setChaosLatencyActive] = useState(false);
  
  // Provisioning overlay
  const [provisioningOrder, setProvisioningOrder] = useState(null);
  const [provisioningProgress, setProvisioningProgress] = useState(0);
  const [provisioningSteps, setProvisioningSteps] = useState([
    { name: 'Generating deployment manifests', status: 'pending' },
    { name: 'Allocating persistent database volumes', status: 'pending' },
    { name: 'Spinning up virtual machine nodes', status: 'pending' },
    { name: 'Exposing routes & applying SSL settings', status: 'pending' }
  ]);

  // UI state
  const [logs, setLogs] = useState([{ type: 'system', text: 'Observer client initialized...', time: new Date().toLocaleTimeString() }]);
  const [toast, setToast] = useState(null);
  
  // Checkout form
  const [checkoutName, setCheckoutName] = useState('');
  const [checkoutEmail, setCheckoutEmail] = useState('');
  const [isSubmittingCheckout, setIsSubmittingCheckout] = useState(false);

  // Admin Form state
  const [adminName, setAdminName] = useState('');
  const [adminDesc, setAdminDesc] = useState('');
  const [adminPrice, setAdminPrice] = useState('');
  const [adminStock, setAdminStock] = useState('');
  const [adminIcon, setAdminIcon] = useState('kubes');
  const [adminGradientFrom, setAdminGradientFrom] = useState('#8b5cf6');
  const [adminGradientTo, setAdminGradientTo] = useState('#3b82f6');

  const terminalEndRef = useRef(null);

  // Helper: add log to mock terminal
  const logToTerminal = (text, type = 'info') => {
    setLogs(prev => {
      const updated = [...prev, { type, text, time: new Date().toLocaleTimeString() }];
      return updated.slice(-50); // Cap at last 50 logs
    });
  };

  // Helper: show toast notification
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Auto scroll logs terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Fetch product catalog
  const fetchProducts = async () => {
    const startTime = performance.now();
    try {
      const res = await fetch(`${API_BASE}/api/products`);
      const latencyVal = Math.round(performance.now() - startTime);
      
      if (!res.ok) throw new Error('API server returned error');
      const json = await res.json();
      
      setProducts(json.data);
      setDataSource(json.source === 'redis-cache' ? 'REDIS CACHE' : 'POSTGRESQL DB');
      setLatency(latencyVal);
      setLatencyHistory(prev => [...prev.slice(-9), latencyVal]);

      if (json.source === 'redis-cache') {
        const newHits = hits + 1;
        setHits(newHits);
        localStorage.setItem('metrics_hits', newHits);
        logToTerminal(`GET /api/products -> CACHE HIT (Source: Redis, Latency: ${latencyVal}ms)`, 'success');
      } else {
        const newMisses = misses + 1;
        setMisses(newMisses);
        localStorage.setItem('metrics_misses', newMisses);
        logToTerminal(`GET /api/products -> CACHE MISS (Source: PostgreSQL, Latency: ${latencyVal}ms)`, 'warning');
      }
    } catch (err) {
      const latencyVal = Math.round(performance.now() - startTime);
      setLatency(latencyVal);
      setDataSource('OFFLINE');
      logToTerminal(`GET /api/products -> FAILED (Latency: ${latencyVal}ms, Error: ${err.message})`, 'error');
    }
  };

  // Fetch active cart
  const fetchCart = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cart`, {
        headers: { 'X-Session-ID': sessionId }
      });
      if (!res.ok) throw new Error('Failed to retrieve cart');
      const data = await res.json();
      setCart(data);
    } catch (err) {
      logToTerminal(`GET /api/cart -> ERROR (${err.message})`, 'error');
    }
  };

  // Fetch recent orders
  const fetchOrders = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/orders`);
      if (!res.ok) throw new Error('Failed to fetch orders');
      const data = await res.json();
      setOrders(data);
    } catch (err) {
      logToTerminal(`GET /api/orders -> DATABASE UNREACHABLE (${err.message})`, 'error');
    }
  };

  // Health check monitor loop
  const runHealthCheck = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      const statusData = await res.json();
      
      const dbStat = statusData.services.postgresql.status;
      const redisStat = statusData.services.redis.status;
      
      setDbStatus(dbStat);
      setRedisStatus(redisStat);
      
      // Update local state if backend returned chaos active status
      if (statusData.chaos) {
        setChaosLatencyActive(statusData.chaos.latency);
      }
      
      if (res.ok) {
        logToTerminal(`GET /health -> Status 200 (Postgres: ${dbStat}, Redis: ${redisStat})`, 'info');
      } else {
        logToTerminal(`GET /health -> Status 500 [DEGRADED] (Postgres: ${dbStat}, Redis: ${redisStat})`, 'warning');
      }
    } catch (err) {
      setDbStatus('DOWN');
      setRedisStatus('DOWN');
      logToTerminal(`GET /health -> CRITICAL CONNECTION ERROR (Express Server Offline)`, 'error');
    }
  };

  // Add items to cart
  const handleAddToCart = async (productId) => {
    const product = products.find(p => p.id === productId);
    const existing = cart.find(item => item.id === productId);
    const newQty = existing ? existing.quantity + 1 : 1;

    if (product && newQty > product.stock) {
      showToast(`Cannot add more. Max stock limit reached (${product.stock}).`, 'warning');
      return;
    }

    try {
      logToTerminal(`POST /api/cart -> Adding Product ID ${productId} to cache...`, 'info');
      const res = await fetch(`${API_BASE}/api/cart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ productId, quantity: newQty })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cart update failed');
      
      setCart(data);
      showToast(`${product ? product.name : 'Infrastructure'} added to provisioning pipeline.`, 'success');
      logToTerminal(`POST /api/cart -> Redis session cart updated.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
      logToTerminal(`POST /api/cart -> FAILED (${err.message})`, 'error');
    }
  };

  // Change quantity in cart
  const updateCartQuantity = async (productId, currentQty, delta) => {
    const targetQty = currentQty + delta;
    const product = products.find(p => p.id === productId);

    if (product && targetQty > product.stock) {
      showToast(`Stock ceiling reached. Available: ${product.stock}`, 'warning');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/cart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ productId, quantity: targetQty })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cart update failed');
      
      setCart(data);
      logToTerminal(`POST /api/cart -> Update quantity for product ${productId} to ${targetQty}.`, 'info');
    } catch (err) {
      showToast(err.message, 'error');
      logToTerminal(`POST /api/cart -> QTY UPDATE FAILED (${err.message})`, 'error');
    }
  };

  // Start checkout / provisioning simulation
  const handleCheckout = async (e) => {
    e.preventDefault();
    if (!checkoutName || !checkoutEmail) {
      showToast('Please enter name and operations email.', 'warning');
      return;
    }

    setIsSubmittingCheckout(true);
    try {
      logToTerminal(`POST /api/cart/checkout -> Submitting provision request transaction...`, 'info');
      const res = await fetch(`${API_BASE}/api/cart/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ customerName: checkoutName, customerEmail: checkoutEmail })
      });

      const resJson = await res.json();
      if (!res.ok) throw new Error(resJson.error || 'Provisioning transaction failed');

      logToTerminal(`POST /api/cart/checkout -> DEPLOYMENT COMMITTED. Order #${resJson.orderId} status: pending.`, 'success');
      showToast('Deployment Initiated!', 'success');
      
      // Clear cart input & checkout button spinner
      setCheckoutName('');
      setCheckoutEmail('');
      setCart([]);
      
      // Open provisioning stepper overlay
      setProvisioningOrder(resJson.orderId);
      setProvisioningProgress(5);
      setProvisioningSteps([
        { name: 'Generating deployment manifests', status: 'active' },
        { name: 'Allocating persistent database volumes', status: 'pending' },
        { name: 'Spinning up virtual machine nodes', status: 'pending' },
        { name: 'Exposing routes & applying SSL settings', status: 'pending' }
      ]);
    } catch (err) {
      showToast(err.message, 'error');
      logToTerminal(`POST /api/cart/checkout -> PROVISIONING TRANSACTION ERROR (${err.message})`, 'error');
    } finally {
      setIsSubmittingCheckout(false);
    }
  };

  // Poll order provisioning progress
  useEffect(() => {
    let intervalId;
    if (provisioningOrder) {
      intervalId = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/orders/${provisioningOrder}/status`);
          if (!res.ok) return;
          const data = await res.json();

          setProvisioningProgress(data.progress);
          
          // Map backend steps
          setProvisioningSteps([
            { name: 'Generating deployment manifests', status: data.progress >= 25 ? 'completed' : (data.progress > 0 ? 'active' : 'pending') },
            { name: 'Allocating persistent database volumes', status: data.progress >= 50 ? 'completed' : (data.progress >= 25 ? 'active' : 'pending') },
            { name: 'Spinning up virtual machine nodes', status: data.progress >= 75 ? 'completed' : (data.progress >= 50 ? 'active' : 'pending') },
            { name: 'Exposing routes & applying SSL settings', status: data.progress >= 100 ? 'completed' : (data.progress >= 75 ? 'active' : 'pending') }
          ]);

          if (data.status === 'completed') {
            clearInterval(intervalId);
            logToTerminal(`Provisioner -> Order #${provisioningOrder} successfully active!`, 'success');
            showToast('Infrastructure Stack Deployed Successfully!', 'success');
            fetchOrders();
            fetchProducts();
          }
        } catch (err) {
          console.error('Error polling order status:', err);
        }
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [provisioningOrder]);

  // Admin: Add new product
  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!adminName || !adminPrice || !adminStock) {
      showToast('Please fill out Name, Price and Stock.', 'warning');
      return;
    }

    try {
      logToTerminal(`Admin -> Creating new infrastructure product: ${adminName}...`, 'info');
      const res = await fetch(`${API_BASE}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: adminName,
          description: adminDesc,
          price: parseFloat(adminPrice),
          stock: parseInt(adminStock),
          icon: adminIcon,
          gradientFrom: adminGradientFrom,
          gradientTo: adminGradientTo
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create product');

      showToast('Product added successfully and cache evicted!', 'success');
      logToTerminal(`Admin -> Product '${adminName}' saved. Catalog cache invalidated.`, 'success');
      
      // Reset form
      setAdminName('');
      setAdminDesc('');
      setAdminPrice('');
      setAdminStock('');
      setAdminIcon('kubes');
      
      // Refresh list
      fetchProducts();
    } catch (err) {
      showToast(err.message, 'error');
      logToTerminal(`Admin -> Creation failed (${err.message})`, 'error');
    }
  };

  // Admin: Delete product
  const handleDeleteProduct = async (productId) => {
    if (!window.confirm('Are you sure you want to delete this product? This will invalidate catalog caches.')) return;
    try {
      logToTerminal(`Admin -> Deleting Product ID ${productId}...`, 'info');
      const res = await fetch(`${API_BASE}/api/products/${productId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Deletion failed');

      showToast('Product deleted from database & session carts cleaned!', 'success');
      logToTerminal(`Admin -> Product ID ${productId} deleted. Cache invalidated.`, 'success');
      
      // Refresh lists
      fetchProducts();
      fetchCart();
    } catch (err) {
      showToast(err.message, 'error');
      logToTerminal(`Admin -> Delete failed (${err.message})`, 'error');
    }
  };

  // Chaos Actions
  const toggleChaosLatency = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chaos/latency`, { method: 'POST' });
      const data = await res.json();
      setChaosLatencyActive(data.latency);
      showToast(data.latency ? 'Chaos Monkey: Latency Injected (2000ms delay)' : 'Chaos Monkey: Latency Restored to normal', 'warning');
      logToTerminal(`Chaos Control -> Latency injection toggled to: ${data.latency ? 'ACTIVE' : 'INACTIVE'}`, 'warning');
    } catch (err) {
      logToTerminal(`Chaos Control -> Failed to toggle latency`, 'error');
    }
  };

  const forceEvictCache = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chaos/evict`, { method: 'POST' });
      const data = await res.json();
      showToast('Redis catalog cache evicted!', 'success');
      logToTerminal('Chaos Control -> Cache key "products:all" evicted successfully.', 'success');
      fetchProducts(); // Refresh list to trigger cache miss
    } catch (err) {
      logToTerminal('Chaos Control -> Cache eviction failed', 'error');
    }
  };

  const resetStats = () => {
    setHits(0);
    setMisses(0);
    localStorage.setItem('metrics_hits', 0);
    localStorage.setItem('metrics_misses', 0);
    logToTerminal('Observability statistics reset.', 'system');
  };

  // Initial loading hooks
  useEffect(() => {
    fetchProducts();
    fetchCart();
    fetchOrders();

    const monitorId = setInterval(runHealthCheck, 5000);
    return () => clearInterval(monitorId);
  }, []);

  // Compute cache hit ratio
  const totalQueries = hits + misses;
  const cacheRatio = totalQueries > 0 ? Math.round((hits / totalQueries) * 100) : 0;

  // Custom SVG line chart points rendering
  const renderLatencySvg = () => {
    const width = 340;
    const height = 80;
    if (latencyHistory.length < 2) return null;
    const maxVal = Math.max(...latencyHistory, 80);
    const points = latencyHistory.map((val, idx) => {
      const x = (idx / (latencyHistory.length - 1)) * width;
      const y = height - (val / maxVal) * (height - 15) - 5;
      return `${x},${y}`;
    }).join(' ');

    const areaPoints = `0,${height} ${points} ${width},${height}`;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <defs>
          <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--secondary)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--secondary)" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <polyline points={points} className="chart-line" />
        <polygon points={areaPoints} className="chart-area" />
        {latencyHistory.map((val, idx) => {
          const x = (idx / (latencyHistory.length - 1)) * width;
          const y = height - (val / maxVal) * (height - 15) - 5;
          return (
            <circle key={idx} cx={x} cy={y} r="3" fill="var(--secondary-light)" />
          );
        })}
      </svg>
    );
  };

  return (
    <>
      <div className="glass-bg"></div>
      <div className="glow-orb orb-1"></div>
      <div className="glow-orb orb-2"></div>

      <div className="app-container">
        {/* Header */}
        <header className="app-header">
          <div className="logo-area">
            <div className="logo-icon">☁️</div>
            <div>
              <h1>Cloud<span>Cart</span></h1>
              <p className="subtitle">Infrastructure Sandbox & React Observability Lab</p>
            </div>
          </div>
          <div className="header-actions">
            <button onClick={() => setActiveTab('cart')} className="btn btn-secondary btn-icon">
              <span className="icon">🛒</span>
              <span className="btn-text">View Cart</span>
              <span className="badge">{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
            </button>
          </div>
        </header>

        {/* Main Section */}
        <main className="app-main">
          {/* Catalog / Left Panel */}
          <section className="catalog-section">
            <h2 className="section-title">
              Infrastructure Catalog
              <span className="sub-title">Powered by PostgreSQL & Redis Cache</span>
            </h2>

            <div className="products-grid">
              {products.length === 0 ? (
                <div className="loading-state">
                  <div className="spinner"></div>
                  <p>Connecting to catalog database...</p>
                </div>
              ) : (
                products.map(product => {
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

                  const cardStyle = {
                    '--card-glow': `${product.gradient_from || '#a855f7'}33`,
                    background: `linear-gradient(135deg, ${(product.gradient_from || '#a855f7')}1a 0%, rgba(14, 19, 32, 0.9) 80%)`
                  };

                  const visualStyle = {
                    background: `linear-gradient(135deg, ${product.gradient_from || '#a855f7'} 0%, ${product.gradient_to || '#06b6d4'} 100%)`
                  };

                  return (
                    <div key={product.id} className="product-card" style={cardStyle}>
                      <div className="card-visual" style={visualStyle}>
                        {ICONS[product.icon] || '☁️'}
                      </div>
                      <div className="card-details">
                        <div className="product-name-row">
                          <h3 className="product-name">{product.name}</h3>
                          <button 
                            onClick={() => handleDeleteProduct(product.id)}
                            className="btn-card-delete"
                            title="Delete product catalog"
                          >
                            🗑️
                          </button>
                        </div>
                        <p className="product-desc">{product.description}</p>
                        <div className="product-meta">
                          <span className="product-price">${parseFloat(product.price).toFixed(2)}/mo</span>
                          <span className={`product-stock ${stockClass}`}>{stockText}</span>
                        </div>
                        <button 
                          className="btn btn-primary btn-block" 
                          onClick={() => handleAddToCart(product.id)}
                          disabled={isOutOfStock}
                        >
                          {isOutOfStock ? 'Decommissioned' : '🔌 Provision Item'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Recent Orders Ledger */}
            <div className="orders-container">
              <h2 className="section-title">
                Deployment Ledger <span className="sub-title">(Stored persistently in PostgreSQL)</span>
              </h2>
              <div className="orders-list">
                {orders.length === 0 ? (
                  <div className="empty-state">No deployment records found. Provision resources to populate.</div>
                ) : (
                  orders.map(order => (
                    <div key={order.id} className="order-card">
                      <div className="order-card-header">
                        <div className="order-meta-info">
                          <h4>
                            Stack #{order.id}
                            <span className={`order-status-badge ${order.status || 'completed'}`}>
                              {order.status || 'completed'}
                            </span>
                          </h4>
                          <div className="order-owner">Cluster Owner: {order.customer_name} ({order.customer_email})</div>
                          <div className="order-owner">Provisioned: {new Date(order.created_at).toLocaleString()}</div>
                        </div>
                        <div className="order-price">${parseFloat(order.total_amount).toFixed(2)}</div>
                      </div>
                      <div className="order-items-summary">
                        {order.items && order.items.map((item, idx) => (
                          <span 
                            key={idx} 
                            className="order-item-tag" 
                            style={{ 
                              borderColor: `${item.gradient_from || '#a855f7'}80`, 
                              background: `${item.gradient_from || '#a855f7'}0a` 
                            }}
                          >
                            {item.name} (x{item.quantity})
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Sidebar / Tabs */}
          <aside className="sidebar-section">
            <div className="sidebar-tabs">
              <button 
                className={`tab-btn ${activeTab === 'devops' ? 'active' : ''}`}
                onClick={() => setActiveTab('devops')}
              >
                🛠️ DevOps
              </button>
              <button 
                className={`tab-btn ${activeTab === 'cart' ? 'active' : ''}`}
                onClick={() => setActiveTab('cart')}
              >
                🛒 Cart ({cart.reduce((sum, item) => sum + item.quantity, 0)})
              </button>
              <button 
                className={`tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => setActiveTab('admin')}
              >
                ⚙️ Admin
              </button>
            </div>

            {/* Tab: DevOps Monitor */}
            {activeTab === 'devops' && (
              <div className="panel glass-panel">
                <div className="panel-header">
                  <h3>Observability Monitor</h3>
                  <span className="pulse-indicator fast-pulse"></span>
                </div>

                <div className="monitor-metrics">
                  <div className="metric-row">
                    <span className="metric-label">PostgreSQL Database:</span>
                    <span className={`status-pill ${dbStatus === 'UP' ? 'status-up' : 'status-down'}`}>{dbStatus}</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Redis Cache:</span>
                    <span className={`status-pill ${redisStatus === 'UP' ? 'status-up' : 'status-down'}`}>{redisStatus}</span>
                  </div>
                  <hr className="panel-divider" />
                  
                  <div className="metric-row">
                    <span className="metric-label">API Latency:</span>
                    <span className="metric-val">{latency} ms</span>
                  </div>

                  {/* SVG Latency History Graph */}
                  <div className="latency-chart">
                    {renderLatencySvg()}
                  </div>

                  <div className="metric-row" style={{ marginTop: '0.5rem' }}>
                    <span className="metric-label">Fetch Source:</span>
                    <span className={`source-pill ${dataSource === 'REDIS CACHE' ? 'source-cache' : 'source-db'}`}>{dataSource}</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Cache Hit Ratio:</span>
                    <div className="cache-ratio-container">
                      <span className="metric-val">{cacheRatio}%</span>
                      <div className="ratio-bar-bg">
                        <div className="ratio-bar-fill" style={{ width: `${cacheRatio}%` }}></div>
                      </div>
                    </div>
                  </div>
                  <div className="metric-row sub-metric">
                    <span>Hit: <strong className="text-success">{hits}</strong></span>
                    <span>Miss: <strong className="text-danger">{misses}</strong></span>
                    <button className="btn-text-action" onClick={resetStats}>Reset Stats</button>
                  </div>
                </div>

                {/* Chaos Injection Sandbox */}
                <div className="chaos-controls">
                  <div className="chaos-title">⚡ Chaos Monkey Controls</div>
                  <div className="chaos-buttons">
                    <button 
                      className={`btn-chaos ${chaosLatencyActive ? 'active' : ''}`}
                      onClick={toggleChaosLatency}
                    >
                      <span>Inject 2000ms Latency Delay</span>
                      <span>{chaosLatencyActive ? 'ON' : 'OFF'}</span>
                    </button>
                    <button 
                      className="btn-chaos"
                      onClick={forceEvictCache}
                    >
                      <span>Evict Redis Catalog Cache</span>
                      <span>💥</span>
                    </button>
                  </div>
                </div>

                {/* Logs Terminal */}
                <div className="terminal-container">
                  <div className="terminal-header">
                    <span className="terminal-dot red"></span>
                    <span className="terminal-dot yellow"></span>
                    <span className="terminal-dot green"></span>
                    <span className="terminal-title">observability_logs.sh</span>
                  </div>
                  <div className="terminal-body">
                    {logs.map((log, idx) => (
                      <div key={idx} className={`log-line ${log.type}`}>
                        <span className="system">[{log.time}]</span>{' '}
                        <span dangerouslySetInnerHTML={{ __html: log.text }}></span>
                      </div>
                    ))}
                    <div ref={terminalEndRef} />
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Shopping Cart & checkout */}
            {activeTab === 'cart' && (
              <div className="panel glass-panel">
                <div className="panel-header">
                  <h3>Provisioning Queue</h3>
                  <span className="panel-header-badge">Redis Session Store</span>
                </div>

                <div className="cart-items">
                  {cart.length === 0 ? (
                    <div className="empty-state">Your provisioning pipeline is empty. Connect items from the catalog.</div>
                  ) : (
                    cart.map(item => {
                      const visualBg = {
                        background: `linear-gradient(135deg, ${item.gradient_from || '#a855f7'} 0%, ${item.gradient_to || '#06b6d4'} 100%)`
                      };
                      return (
                        <div key={item.id} className="cart-item">
                          <div className="cart-item-visual" style={visualBg}>
                            {ICONS[item.icon] || '☁️'}
                          </div>
                          <div className="cart-item-details">
                            <div className="cart-item-name">{item.name}</div>
                            <div className="cart-item-price">${parseFloat(item.price).toFixed(2)}/mo</div>
                          </div>
                          <div className="cart-item-actions">
                            <button className="quantity-btn" onClick={() => updateCartQuantity(item.id, item.quantity, -1)}>-</button>
                            <span className="cart-item-qty">{item.quantity}</span>
                            <button className="quantity-btn" onClick={() => updateCartQuantity(item.id, item.quantity, 1)}>+</button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {cart.length > 0 && (
                  <div className="cart-summary">
                    <hr className="panel-divider" />
                    <div className="summary-row">
                      <span>Total Operations Budget:</span>
                      <span className="total-price">
                        ${cart.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0).toFixed(2)}/mo
                      </span>
                    </div>

                    <form onSubmit={handleCheckout} className="checkout-form">
                      <h4>Provision Stack manifest</h4>
                      <div className="form-group">
                        <label>Cluster Operator Name</label>
                        <input 
                          type="text" 
                          required 
                          value={checkoutName}
                          onChange={(e) => setCheckoutName(e.target.value)}
                          placeholder="e.g., Jane Dev" 
                        />
                      </div>
                      <div className="form-group">
                        <label>Operations Alert Email</label>
                        <input 
                          type="email" 
                          required 
                          value={checkoutEmail}
                          onChange={(e) => setCheckoutEmail(e.target.value)}
                          placeholder="e.g., ops@company.internal" 
                        />
                      </div>
                      <button 
                        type="submit" 
                        className="btn btn-primary btn-block"
                        disabled={isSubmittingCheckout}
                      >
                        {isSubmittingCheckout ? 'Submitting to Queue...' : '🚀 Deploy Infrastructure Stack'}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Admin Console */}
            {activeTab === 'admin' && (
              <div className="panel glass-panel">
                <div className="panel-header">
                  <h3>Admin Configuration</h3>
                </div>

                <form onSubmit={handleAddProduct} className="admin-grid">
                  <div className="form-group">
                    <label>Resource Name</label>
                    <input 
                      type="text" 
                      required 
                      value={adminName} 
                      onChange={e => setAdminName(e.target.value)} 
                      placeholder="e.g., Load Balancer Proxy" 
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Description</label>
                    <textarea 
                      rows="2"
                      value={adminDesc} 
                      onChange={e => setAdminDesc(e.target.value)} 
                      placeholder="Specify capacity constraints, scale parameters..."
                    />
                  </div>

                  <div className="color-picker-row">
                    <div className="form-group">
                      <label>Monthly Price ($)</label>
                      <input 
                        type="number" 
                        required 
                        min="0"
                        value={adminPrice} 
                        onChange={e => setAdminPrice(e.target.value)} 
                        placeholder="29" 
                      />
                    </div>
                    <div className="form-group">
                      <label>Initial Stock (Units)</label>
                      <input 
                        type="number" 
                        required 
                        min="0"
                        value={adminStock} 
                        onChange={e => setAdminStock(e.target.value)} 
                        placeholder="50" 
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Dashboard Display Icon</label>
                    <select value={adminIcon} onChange={e => setAdminIcon(e.target.value)}>
                      <option value="kubes">☁️ Kubernetes (kubes)</option>
                      <option value="db">🗄️ Relational DB (db)</option>
                      <option value="cache">⚡ In-Memory Cache (cache)</option>
                      <option value="pipeline">🔄 Automation Pipeline (pipeline)</option>
                      <option value="chart">📊 Grafana Charts (chart)</option>
                      <option value="lock">🔒 SSL edge security (lock)</option>
                    </select>
                  </div>

                  <div className="color-picker-row">
                    <div className="form-group">
                      <label>Visual Gradient Start</label>
                      <input 
                        type="color" 
                        value={adminGradientFrom} 
                        onChange={e => setAdminGradientFrom(e.target.value)} 
                      />
                    </div>
                    <div className="form-group">
                      <label>Visual Gradient End</label>
                      <input 
                        type="color" 
                        value={adminGradientTo} 
                        onChange={e => setAdminGradientTo(e.target.value)} 
                      />
                    </div>
                  </div>

                  <button type="submit" className="btn btn-primary btn-block">
                    ➕ Register Catalog Item
                  </button>
                </form>
              </div>
            )}
          </aside>
        </main>
      </div>

      {/* Provisioning overlay stepper */}
      {provisioningOrder && (
        <div className="provisioning-overlay">
          <div className="provisioning-modal">
            <div className="modal-title">Provisioning Cloud Stack</div>
            <div className="modal-subtitle">Orchestrating resources for deployment #{provisioningOrder}...</div>
            
            <div className="modal-progress-container">
              <div className="modal-progress-bar" style={{ width: `${provisioningProgress}%` }}></div>
            </div>

            <div className="stepper-list">
              {provisioningSteps.map((step, idx) => (
                <div key={idx} className={`stepper-item ${step.status}`}>
                  <div className="stepper-bullet">
                    {step.status === 'completed' ? '✓' : idx + 1}
                  </div>
                  <div>{step.name}</div>
                </div>
              ))}
            </div>

            {provisioningProgress >= 100 && (
              <button 
                onClick={() => {
                  setProvisioningOrder(null);
                  setActiveTab('devops');
                }} 
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                ⚡ Open Live Cluster Monitor
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toast Alert Notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.message}</span>
        </div>
      )}
    </>
  );
}
