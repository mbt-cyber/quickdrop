import { Order, RiderProfile, SupportChatMessage, WalletRechargeRequest } from '../types';
import {
  supabase,
  isSupabaseConfigured,
  syncOrderToSupabase,
  deleteOrderFromSupabase,
  fetchOrdersFromSupabase,
  mapSupabaseRowToOrder,
} from './supabase';

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

// Global active Supabase Realtime Channel
let activeSupabaseChannel: any = null;

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

  // 2. Direct Supabase Real-Time Broadcast (Ultra-low latency WebSocket push to all devices)
  if (isSupabaseConfigured && activeSupabaseChannel) {
    try {
      activeSupabaseChannel.send({
        type: 'broadcast',
        event: 'sync_event',
        payload: fullEvent,
      });
    } catch (e) {
      console.warn('Supabase Realtime broadcast send error:', e);
    }
  }

  // 3. Direct server API dispatch (Instant SSE broadcast to all connected mobile phones)
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

  // 4. Global ntfy HTTP relay fallback for cross-network & multi-device sync
  try {
    fetch(`https://ntfy.sh/${SYNC_TOPIC}`, {
      method: 'POST',
      body: payloadString,
      headers: {
        'Title': `QD:${fullEvent.type}`,
      },
    }).catch(() => {});
  } catch (err) {}

  // 5. Parallel write to Supabase Database Tables if configured
  if (isSupabaseConfigured) {
    try {
      if (fullEvent.order) {
        syncOrderToSupabase(fullEvent.order);
      } else if (fullEvent.orderId && fullEvent.type === 'ORDER_DELETED') {
        deleteOrderFromSupabase(fullEvent.orderId);
      }

      if (fullEvent.type === 'WALLET_RECHARGE_REQUEST' && fullEvent.rechargeRequest) {
        supabase.from('wallet_recharges').upsert([{
          id: fullEvent.rechargeRequest.id,
          payload: fullEvent.rechargeRequest,
          created_at: fullEvent.rechargeRequest.createdAt || new Date().toISOString(),
        }]).then(() => {});
      }

      if (fullEvent.type === 'WALLET_RECHARGE_STATUS' && fullEvent.requestId) {
        supabase.from('wallet_recharges').update({
          status: fullEvent.rechargeStatus,
          updated_at: new Date().toISOString(),
        }).eq('id', fullEvent.requestId).then(() => {});
      }

      if (fullEvent.type === 'SUPPORT_MESSAGE' && fullEvent.supportMessage) {
        supabase.from('support_messages').upsert([{
          id: fullEvent.supportMessage.id,
          payload: fullEvent.supportMessage,
          created_at: new Date().toISOString(),
        }]).then(() => {});
      }
    } catch (e) {
      console.warn('Supabase realtime table write caught:', e);
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

  // 2. Direct Supabase Real-Time Channel (Postgres changes & WebSocket Broadcast)
  const setupSupabaseRealtime = () => {
    if (!isSupabaseConfigured) return;
    try {
      const channel = supabase.channel('quickdrop_realtime_sync_channel', {
        config: {
          broadcast: { self: false },
        },
      });

      channel
        // A. Listen for Supabase WebSocket Broadcasts
        .on('broadcast', { event: 'sync_event' }, ({ payload }) => {
          if (payload) {
            handleIncomingEvent(payload as SyncEvent);
          }
        })
        // B. Listen for PostgreSQL Changes on customer_orders table
        .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_orders' }, (payload) => {
          try {
            if (payload.eventType === 'INSERT' && payload.new) {
              const order = mapSupabaseRowToOrder(payload.new);
              if (order) handleIncomingEvent({ type: 'ORDER_CREATED', senderDeviceId: 'supabase_db', timestamp: new Date().toISOString(), order });
            } else if (payload.eventType === 'UPDATE' && payload.new) {
              const order = mapSupabaseRowToOrder(payload.new);
              if (order) handleIncomingEvent({ type: 'ORDER_UPDATED', senderDeviceId: 'supabase_db', timestamp: new Date().toISOString(), order });
            } else if (payload.eventType === 'DELETE' && payload.old) {
              const orderId = payload.old.id;
              if (orderId) handleIncomingEvent({ type: 'ORDER_DELETED', senderDeviceId: 'supabase_db', timestamp: new Date().toISOString(), orderId });
            }
          } catch (e) {}
        })
        // C. Listen for PostgreSQL Changes on orders JSONB table
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
          try {
            if (payload.eventType === 'INSERT' && payload.new?.payload) {
              handleIncomingEvent({ type: 'ORDER_CREATED', senderDeviceId: 'supabase_db', timestamp: new Date().toISOString(), order: payload.new.payload });
            } else if (payload.eventType === 'UPDATE' && payload.new?.payload) {
              handleIncomingEvent({ type: 'ORDER_UPDATED', senderDeviceId: 'supabase_db', timestamp: new Date().toISOString(), order: payload.new.payload });
            } else if (payload.eventType === 'DELETE' && payload.old?.id) {
              handleIncomingEvent({ type: 'ORDER_DELETED', senderDeviceId: 'supabase_db', timestamp: new Date().toISOString(), orderId: payload.old.id });
            }
          } catch (e) {}
        })
        // D. Listen for PostgreSQL Changes on wallet_recharges table
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_recharges' }, (payload) => {
          try {
            if (payload.eventType === 'INSERT' && payload.new?.payload) {
              handleIncomingEvent({ type: 'WALLET_RECHARGE_REQUEST', senderDeviceId: 'supabase_db', timestamp: new Date().toISOString(), rechargeRequest: payload.new.payload });
            }
          } catch (e) {}
        })
        // E. Listen for PostgreSQL Changes on support_messages table
        .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages' }, (payload) => {
          try {
            if (payload.eventType === 'INSERT' && payload.new?.payload) {
              handleIncomingEvent({ type: 'SUPPORT_MESSAGE', senderDeviceId: 'supabase_db', timestamp: new Date().toISOString(), supportMessage: payload.new.payload });
            }
          } catch (e) {}
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('Supabase Real-Time stream active & listening');
          }
        });

      activeSupabaseChannel = channel;
    } catch (e) {
      console.warn('Supabase Real-Time initialization caught:', e);
    }
  };

  setupSupabaseRealtime();

  // 3. Direct Server-Sent Events (SSE) Stream to our app's own server
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

  // 4. ntfy SSE connection for cross-network redundancy
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

  // 5. Initial Supabase Database Hydration (Loads all real-time orders directly from Supabase on start)
  const hydrateFromSupabase = async () => {
    if (isSupabaseConfigured && callbacks.onOrdersBulkSync) {
      try {
        const cloudOrders = await fetchOrdersFromSupabase();
        if (Array.isArray(cloudOrders) && cloudOrders.length > 0) {
          callbacks.onOrdersBulkSync(cloudOrders);
        }
      } catch (e) {
        console.warn('Initial Supabase hydration error:', e);
      }
    }
  };

  hydrateFromSupabase();

  // 6. Historical mesh order fetch
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

  // 7. Fast polling fallback (Fetches /api/orders every 1.5s to guarantee cross-phone sync)
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
    hydrateFromSupabase();
  };
  window.addEventListener('quickdrop_manual_sync', handleManualSync);

  // Sync when phone wakes up or user returns to tab
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      pollServerOrders();
      fetchHistoricalMeshOrders();
      hydrateFromSupabase();
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
    if (activeSupabaseChannel) {
      supabase.removeChannel(activeSupabaseChannel);
      activeSupabaseChannel = null;
    }
    localChannel?.removeEventListener('message', handleLocalMessage);
  };
}
