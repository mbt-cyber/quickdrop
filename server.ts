import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

// In-memory synced state store (persisted in server memory across all connected phones & browsers)
interface ServerOrder {
  id: string;
  payload: any;
  createdAt: string;
  updatedAt: string;
}

const ordersStore = new Map<string, any>();
const ridersStore = new Map<string, any>();
const rechargeRequestsStore = new Map<string, any>();
const supportMessagesStore = new Map<string, any>();

// Connected Server-Sent Events (SSE) clients for real-time pushing
type SSEClient = {
  id: string;
  res: express.Response;
};
let sseClients: SSEClient[] = [];

function broadcastSSE(eventType: string, data: any) {
  const payload = JSON.stringify({ type: eventType, ...data });
  sseClients.forEach((client) => {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (e) {
      // Client may have disconnected
    }
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '15mb' }));

  // CORS headers for flexibility
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      activeOrders: ordersStore.size,
      connectedClients: sseClients.length,
      timestamp: new Date().toISOString(),
    });
  });

  // ==========================================
  // REAL-TIME SSE (Server-Sent Events) STREAM
  // ==========================================
  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const newClient: SSEClient = { id: clientId, res };
    sseClients.push(newClient);

    // Initial connection confirmation with current orders
    const initialOrders = Array.from(ordersStore.values());
    res.write(
      `data: ${JSON.stringify({
        type: 'CONNECTED',
        clientId,
        ordersCount: initialOrders.length,
        orders: initialOrders,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    // Keep connection alive with ping every 15s
    const heartbeatTimer = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch (err) {
        clearInterval(heartbeatTimer);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeatTimer);
      sseClients = sseClients.filter((c) => c.id !== clientId);
    });
  });

  // ==========================================
  // ORDERS API (Full Real-time Synchronization)
  // ==========================================
  app.get('/api/orders', (req, res) => {
    const list = Array.from(ordersStore.values()).sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
    res.json({ success: true, orders: list });
  });

  // Customer places new order on mobile phone
  app.post('/api/orders', (req, res) => {
    const order = req.body;
    if (!order || !order.id) {
      return res.status(400).json({ error: 'Order payload with valid ID is required' });
    }

    const timestamp = order.createdAt || new Date().toISOString();
    const orderData = {
      ...order,
      createdAt: timestamp,
      updatedAt: new Date().toISOString(),
    };

    ordersStore.set(order.id, orderData);

    // Broadcast in real-time to all connected rider mobile phones and admin dashboards!
    broadcastSSE('ORDER_CREATED', {
      order: orderData,
      senderDeviceId: req.headers['x-device-id'] || 'server',
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ success: true, order: orderData });
  });

  // Rider accepts / updates order status / OTP verification
  app.put('/api/orders/:id', (req, res) => {
    const orderId = req.params.id;
    const updates = req.body;

    const existing = ordersStore.get(orderId) || {};
    const updatedOrder = {
      ...existing,
      ...updates,
      id: orderId,
      updatedAt: new Date().toISOString(),
    };

    ordersStore.set(orderId, updatedOrder);

    // Broadcast in real-time to all connected mobile phones!
    broadcastSSE('ORDER_UPDATED', {
      order: updatedOrder,
      orderId,
      senderDeviceId: req.headers['x-device-id'] || 'server',
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, order: updatedOrder });
  });

  // Delete / cancel order
  app.delete('/api/orders/:id', (req, res) => {
    const orderId = req.params.id;
    ordersStore.delete(orderId);

    broadcastSSE('ORDER_DELETED', {
      orderId,
      senderDeviceId: req.headers['x-device-id'] || 'server',
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, orderId });
  });

  // Generic real-time event dispatcher (for rider online status, KYC, wallet, support chat)
  app.post('/api/sync/event', (req, res) => {
    const event = req.body;
    if (!event || !event.type) {
      return res.status(400).json({ error: 'Valid event with type is required' });
    }

    // Persist relevant items
    if (event.order && (event.type === 'ORDER_CREATED' || event.type === 'ORDER_UPDATED')) {
      ordersStore.set(event.order.id, event.order);
    } else if (event.orderId && event.type === 'ORDER_DELETED') {
      ordersStore.delete(event.orderId);
    } else if (event.rechargeRequest) {
      rechargeRequestsStore.set(event.rechargeRequest.id, event.rechargeRequest);
    } else if (event.supportMessage) {
      supportMessagesStore.set(event.supportMessage.id, event.supportMessage);
    }

    // Broadcast to all other phones immediately
    broadcastSSE(event.type, event);

    res.json({ success: true });
  });

  // ==========================================
  // VITE MIDDLEWARE / STATIC FILES
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ QuickDrop Real-time Sync Server active on port ${PORT}`);
  });
}

startServer();
