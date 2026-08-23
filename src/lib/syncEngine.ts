import { Order, RiderProfile, SupportChatMessage, WalletRechargeRequest } from '../types';
import { supabase, isSupabaseConfigured } from './supabase';

const SYNC_TOPIC = 'quickdrop_orders_sync_v5';
const NTFY_SYNC_URL = `https://ntfy.sh/${SYNC_TOPIC}`;
const DEVICE_ID = `dev_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;

export type SyncEventType =
  | 'ORDER_CREATED'
  | 'ORDER_UPDATED'
  | 'ORDER_DELETED'
  | 'RIDER_STATUS_UPDATED'
  | 'RIDER_KYC_UPDATED'
  | 'WALLET_RECHARGE_REQUEST'
  | 'WALLET_RECHARGE_STATUS'
  | 'SUPPORT_MESSAGE'
  | 'INITIAL_SYNC';

export interface SyncEvent {
  type: SyncEventType;
  senderDeviceId: string;
  timestamp: string;
  order?: Order;
  orderId?: string;
  orders?: Order[];
  riderId?: string;
  isOnline?: boolean;
  kycStatus?: 'approved' | 'pending' | 'rejected';
  kycRemarks?: string;
  rechargeRequest?: WalletRechargeRequest;
  requestId?: string;
  rechargeStatus?: 'approved' | 'rejected';
  rechargeAmount?: number;
  supportMessage?: SupportChatMessage;
}

export interface SyncCallbacks {
  onOrderCreated?: (order: Order) => void;
  onOrderUpdated?: (order: Order) => void;
  onOrderDeleted?: (orderId: string) => void;
  onOrdersBulkSync?: (orders: Order[]) => void;
  onRiderStatusUpdated?: (riderId: string, isOnline: boolean) => void;
  onRiderKycUpdated?: (riderId: string, status: 'approved' | 'pending' | 'rejected', remarks?: string) => void;
  onWalletRechargeRequest?: (req: WalletRechargeRequest) => void;
  onWalletRechargeStatus?: (requestId: string, status: 'approved' | 'rejected', amount?: number, riderId?: string) => void;
  onSupportMessage?: (msg: SupportChatMessage) => void;
}

// Local BroadcastChannel for same-browser multi-tab sync
let localChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    localChannel = new BroadcastChannel('quickdrop_local_sync_v5');
  }
} catch (e) {
  console.warn('BroadcastChannel not supported:', e);
}

// Memory cache of processed message IDs to avoid duplicate processing loops
const processedMessageIds = new Set<string>();

/**
 * Broadcast an event across all mobile phones, browsers, and devices in real-time
 */
export async function broadcastSyncEvent(partialEvent: Omit<SyncEvent, 'senderDeviceId' | 'timestamp'>) {
  const fullEvent: SyncEvent = {
    ...partialEvent,
    senderDeviceId: DEVICE_ID,
    timestamp: new Date().toISOString(),
  };

  const payloadString = JSON.stringify(fullEvent);

  // 1. Broadcast locally to all open tabs in this browser
  try {
    localChannel?.postMessage(fullEvent);
  } catch (e) {
    console.warn('Local broadcast error:', e);
  }

  // 2. Direct server API dispatch (Instant SSE broadcast to all connected mobile phones)
  try {
    if (fullEvent.type === 'ORDER_CREATED' && fullEvent.order) {
      fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': DEVICE_ID,
        },
        body: JSON.stringify(fullEvent.order),
      }).catch(() => {});
    } else if (fullEvent.type === 'ORDER_UPDATED' && fullEvent.order) {
      fetch(`/api/orders/${encodeURIComponent(fullEvent.order.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': DEVICE_ID,
        },
        body: JSON.stringify(fullEvent.order),
      }).catch(() => {});
    } else if (fullEvent.type === 'ORDER_DELETED' && fullEvent.orderId) {
      fetch(`/api/orders/${encodeURIComponent(fullEvent.orderId)}`, {
        method: 'DELETE',
        headers: {
          'x-device-id': DEVICE_ID,
        },
      }).catch(() => {});
    } else {
      fetch('/api/sync/event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': DEVICE_ID,
        },
        body: payloadString,
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('Internal server event dispatch error:', e);
  }

  // 3. Global ntfy HTTP relay fallback for cross-network & multi-device sync
  try {
    fetch(`https://ntfy.sh/${SYNC_TOPIC}`, {
      method: 'POST',
      body: payloadString,
      headers: {
        'Title': `QD:${fullEvent.type}`,
      },
    }).catch(() => {});
  } catch (err) {}

  // 4. Parallel write to Supabase if configured
  if (isSupabaseConfigured && fullEvent.order) {
    try {
      // Upsert into hybrid JSONB orders table
      supabase.from('orders').upsert([{
        id: fullEvent.order.id,
        payload: fullEvent.order,
        created_at: fullEvent.order.createdAt || new Date().toISOString(),
      }]).then(() => {});

      // Also upsert into customer_orders table if relational schema is active
      const ord = fullEvent.order;
      supabase.from('customer_orders').upsert([{
        id: ord.id,
        order_number: ord.orderNumber,
        customer_id: ord.customerId || 'cust_default',
        customer_name: ord.customerName || ord.sender?.name,
        customer_phone: ord.customerPhone || ord.sender?.phone,
        pickup_address: ord.pickup?.address,
        pickup_lat: ord.pickup?.lat,
        pickup_lng: ord.pickup?.lng,
        pickup_landmark: ord.pickup?.landmark,
        destination_address: ord.destination?.address,
        destination_lat: ord.destination?.lat,
        destination_lng: ord.destination?.lng,
        destination_landmark: ord.destination?.landmark,
        sender_name: ord.sender?.name,
        sender_phone: ord.sender?.phone,
        sender_notes: ord.sender?.notes,
        recipient_name: ord.recipient?.name,
        recipient_phone: ord.recipient?.phone,
        recipient_notes: ord.recipient?.notes,
        delivery_type: ord.deliveryType,
        schedule_type: ord.scheduleType,
        booking_day_and_time: ord.bookingDayAndTime,
        distance_km: ord.distanceKm,
        fare: ord.fare,
        payment_method: ord.paymentMethod,
        payment_status: ord.paymentStatus,
        otp_code: ord.otpCode,
        status: ord.status,
        tracking_step: ord.trackingStep,
        rider_id: ord.riderId,
        rider_name: ord.riderName,
        rider_phone: ord.riderPhone,
        created_at: ord.createdAt || new Date().toISOString(),
      }]).then(() => {});
    } catch (e) {
      console.warn('Supabase order upsert error:', e);
    }
  }
}

/**
 * Play a clear audio chime when a new order arrives on the Rider's phone
 */
export function playNewOrderChime() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5
    osc.frequency.exponentialRampToValueAtTime(1174.66, audioCtx.currentTime + 0.25); // D6
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.45);
  } catch (e) {
    // AudioContext blocked by browser autoplay policy before user gesture
  }
}

/**
 * Initialize real-time cross-device listening & continuous background sync
 */
export function initSyncEngine(callbacks: SyncCallbacks): () => void {
  let isSubscribed = true;
  let serverSSE: EventSource | null = null;
  let ntfySSE: EventSource | null = null;
  let pollTimer: any = null;

  const handleIncomingEvent = (event: SyncEvent, isHistorical = false) => {
    if (!event || !event.type) return;

    // Ignore events generated by this exact device tab unless historical
    if (event.senderDeviceId === DEVICE_ID && !isHistorical) {
      return;
    }

    const eventKey = `${event.type}_${event.order?.id || event.orderId || event.requestId || event.timestamp}`;
    if (processedMessageIds.has(eventKey) && !isHistorical) {
      return;
    }
    processedMessageIds.add(eventKey);

    // Maintain memory cache bound
    if (processedMessageIds.size > 1500) {
      const arr = Array.from(processedMessageIds);
      arr.slice(0, 500).forEach(id => processedMessageIds.delete(id));
    }

    switch (event.type) {
      case 'ORDER_CREATED':
        if (event.order && callbacks.onOrderCreated) {
          callbacks.onOrderCreated(event.order);
          if (!isHistorical) {
            playNewOrderChime();
          }
        }
        break;

      case 'ORDER_UPDATED':
        if (event.order && callbacks.onOrderUpdated) {
          callbacks.onOrderUpdated(event.order);
        }
        break;

      case 'ORDER_DELETED':
        if (event.orderId && callbacks.onOrderDeleted) {
          callbacks.onOrderDeleted(event.orderId);
        }
        break;

      case 'RIDER_STATUS_UPDATED':
        if (event.riderId && event.isOnline !== undefined && callbacks.onRiderStatusUpdated) {
          callbacks.onRiderStatusUpdated(event.riderId, event.isOnline);
        }
        break;

      case 'RIDER_KYC_UPDATED':
        if (event.riderId && event.kycStatus && callbacks.onRiderKycUpdated) {
          callbacks.onRiderKycUpdated(event.riderId, event.kycStatus, event.kycRemarks);
        }
        break;

      case 'WALLET_RECHARGE_REQUEST':
        if (event.rechargeRequest && callbacks.onWalletRechargeRequest) {
          callbacks.onWalletRechargeRequest(event.rechargeRequest);
        }
        break;

      case 'WALLET_RECHARGE_STATUS':
        if (event.requestId && event.rechargeStatus && callbacks.onWalletRechargeStatus) {
          callbacks.onWalletRechargeStatus(event.requestId, event.rechargeStatus, event.rechargeAmount, event.riderId);
        }
        break;

      case 'SUPPORT_MESSAGE':
        if (event.supportMessage && callbacks.onSupportMessage) {
          callbacks.onSupportMessage(event.supportMessage);
        }
        break;
    }
  };

  // 1. Local browser tabs sync
  const handleLocalMessage = (msgEvent: MessageEvent) => {
    if (msgEvent.data) {
      handleIncomingEvent(msgEvent.data);
    }
  };
  localChannel?.addEventListener('message', handleLocalMessage);

  // 2. Direct Server-Sent Events (SSE) Stream to our app's own server
  const connectServerSSE = () => {
    try {
      if (typeof window !== 'undefined' && 'EventSource' in window) {
        serverSSE = new EventSource('/api/events');

        serverSSE.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'CONNECTED') {
              if (data.orders && Array.isArray(data.orders) && data.orders.length > 0 && callbacks.onOrdersBulkSync) {
                callbacks.onOrdersBulkSync(data.orders);
              }
            } else if (data.type) {
              handleIncomingEvent(data as SyncEvent);
            }
          } catch (err) {}
        };

        serverSSE.onerror = () => {
          if (serverSSE && serverSSE.readyState === EventSource.CLOSED) {
            serverSSE.close();
            if (isSubscribed) {
              setTimeout(connectServerSSE, 2000);
            }
          }
        };
      }
    } catch (err) {
      console.warn('Server SSE connection note:', err);
    }
  };

  connectServerSSE();

  // 3. ntfy SSE connection for cross-network redundancy
  const connectNtfySSE = () => {
    try {
      if (typeof window !== 'undefined' && 'EventSource' in window) {
        ntfySSE = new EventSource(`${NTFY_SYNC_URL}/sse`);

        ntfySSE.onmessage = (e) => {
          try {
            const envelope = JSON.parse(e.data);
            const rawMsg = envelope.message || envelope.data;
            if (rawMsg) {
              const event: SyncEvent = typeof rawMsg === 'string' ? JSON.parse(rawMsg) : rawMsg;
              handleIncomingEvent(event);
            }
          } catch (err) {}
        };

        ntfySSE.onerror = () => {
          if (ntfySSE && ntfySSE.readyState === EventSource.CLOSED) {
            ntfySSE.close();
            if (isSubscribed) {
              setTimeout(connectNtfySSE, 3000);
            }
          }
        };
      }
    } catch (err) {}
  };

  connectNtfySSE();

  // 4. Historical mesh order fetch (Ensures any order placed while app was closed or on another phone is synced)
  const fetchHistoricalMeshOrders = async () => {
    try {
      const res = await fetch(`https://ntfy.sh/${SYNC_TOPIC}/json?poll=1&since=24h`);
      if (res.ok) {
        const text = await res.text();
        const lines = text.trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          try {
            const envelope = JSON.parse(line);
            const rawMsg = envelope.message || envelope.data;
            if (rawMsg) {
              const event: SyncEvent = typeof rawMsg === 'string' ? JSON.parse(rawMsg) : rawMsg;
              handleIncomingEvent(event, true);
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  };

  // Perform initial fetch on boot
  fetchHistoricalMeshOrders();

  // 5. Fast polling fallback (Fetches /api/orders every 1.5s to guarantee cross-phone sync without hitting external rate limits)
  const pollServerOrders = async () => {
    try {
      const res = await fetch('/api/orders', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.orders) && callbacks.onOrdersBulkSync) {
          callbacks.onOrdersBulkSync(json.orders);
        }
      }
    } catch (e) {}
  };

  // Immediate sync fetch
  pollServerOrders();

  const handleManualSync = () => {
    pollServerOrders();
    fetchHistoricalMeshOrders();
  };
  window.addEventListener('quickdrop_manual_sync', handleManualSync);

  // Sync when phone wakes up or user returns to tab
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      pollServerOrders();
      fetchHistoricalMeshOrders();
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  pollTimer = setInterval(() => {
    if (isSubscribed) {
      pollServerOrders();
    }
  }, 1500);

  // Cleanup handler
  return () => {
    isSubscribed = false;
    window.removeEventListener('quickdrop_manual_sync', handleManualSync);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (pollTimer) clearInterval(pollTimer);
    if (serverSSE) {
      serverSSE.close();
      serverSSE = null;
    }
    if (ntfySSE) {
      ntfySSE.close();
      ntfySSE = null;
    }
    localChannel?.removeEventListener('message', handleLocalMessage);
  };
}
