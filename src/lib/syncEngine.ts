import { Order, RiderProfile, SupportChatMessage, WalletRechargeRequest } from '../types';
import { supabase, isSupabaseConfigured } from './supabase';

const SYNC_TOPIC = 'quickdrop_orders_sync_v4';
const SYNC_URL = `https://ntfy.sh/${SYNC_TOPIC}`;
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
  | 'REQUEST_STATE_SYNC'
  | 'STATE_SNAPSHOT';

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
  onRequestStateSnapshot?: () => { orders: Order[]; riders?: RiderProfile[] };
}

// Local BroadcastChannel for same-browser multi-tab sync
let localChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    localChannel = new BroadcastChannel('quickdrop_local_sync_v4');
  }
} catch (e) {
  console.warn('BroadcastChannel not supported:', e);
}

// Memory cache of processed message IDs to avoid double-processing
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

  // 2. Broadcast globally across all mobile phones and browsers via ntfy HTTP relay
  try {
    await fetch(SYNC_URL, {
      method: 'POST',
      body: payloadString,
      headers: {
        'Content-Type': 'application/json',
        'Title': `QuickDrop:${fullEvent.type}`,
      },
    });
  } catch (err) {
    console.warn('Global ntfy sync publish error:', err);
  }

  // 3. Parallel write to Supabase if configured
  if (isSupabaseConfigured) {
    if (fullEvent.order) {
      try {
        await supabase.from('orders').upsert([{
          id: fullEvent.order.id,
          payload: fullEvent.order,
          created_at: fullEvent.order.createdAt || new Date().toISOString(),
        }]);
      } catch (e) {
        console.warn('Supabase order upsert note:', e);
      }
    }
  }
}

/**
 * Play a gentle notification sound when a new order arrives on Rider phone
 */
export function playNewOrderChime() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
    osc.frequency.exponentialRampToValueAtTime(1174.66, audioCtx.currentTime + 0.3); // D6
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  } catch (e) {
    // AudioContext blocked by browser autoplay policy before user gesture
  }
}

/**
 * Initialize real-time cross-device listening & continuous background sync
 */
export function initSyncEngine(callbacks: SyncCallbacks): () => void {
  let isSubscribed = true;
  let eventSource: EventSource | null = null;
  let pollTimer: any = null;

  const handleIncomingEvent = (event: SyncEvent, isHistorical = false) => {
    if (!event || !event.type) return;

    // Ignore events sent by this exact device tab to avoid feedback loops (except historical replay)
    if (event.senderDeviceId === DEVICE_ID && !isHistorical) {
      return;
    }

    const eventKey = `${event.type}_${event.order?.id || event.orderId || event.requestId || event.timestamp}`;
    if (processedMessageIds.has(eventKey) && !isHistorical) {
      return;
    }
    processedMessageIds.add(eventKey);

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

      case 'STATE_SNAPSHOT':
        if (event.orders && callbacks.onOrdersBulkSync) {
          callbacks.onOrdersBulkSync(event.orders);
        }
        break;

      case 'REQUEST_STATE_SYNC':
        if (callbacks.onRequestStateSnapshot && event.senderDeviceId !== DEVICE_ID) {
          const snapshot = callbacks.onRequestStateSnapshot();
          if (snapshot && snapshot.orders && snapshot.orders.length > 0) {
            broadcastSyncEvent({
              type: 'STATE_SNAPSHOT',
              orders: snapshot.orders,
            });
          }
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

  // 1. Listen for local tab broadcasts
  const handleLocalMessage = (msgEvent: MessageEvent) => {
    if (msgEvent.data) {
      handleIncomingEvent(msgEvent.data);
    }
  };
  localChannel?.addEventListener('message', handleLocalMessage);

  // 2. Real-Time SSE (Server-Sent Events) connection to ntfy
  const connectSSE = () => {
    try {
      if (typeof window !== 'undefined' && 'EventSource' in window) {
        eventSource = new EventSource(`${SYNC_URL}/sse`);

        eventSource.onmessage = (e) => {
          try {
            const parsedEnvelope = JSON.parse(e.data);
            if (parsedEnvelope.message) {
              const event: SyncEvent = JSON.parse(parsedEnvelope.message);
              handleIncomingEvent(event);
            }
          } catch (err) {
            // Envelope parse fallback
          }
        };

        eventSource.onerror = () => {
          // SSE will automatically reconnect, but we close and restart on prolonged error
          if (eventSource && eventSource.readyState === EventSource.CLOSED) {
            eventSource.close();
            if (isSubscribed) {
              setTimeout(connectSSE, 4000);
            }
          }
        };
      }
    } catch (err) {
      console.warn('SSE connection init note:', err);
    }
  };

  connectSSE();

  // 3. Historical Catch-up Poll (fetches recent 24 hours of orders on initial load & periodic fallback)
  const fetchRecentCloudEvents = async () => {
    try {
      const res = await fetch(`${SYNC_URL}/json?poll=1&since=24h`, { cache: 'no-store' });
      if (!res.ok) return;
      const text = await res.text();
      if (!text.trim()) return;

      const lines = text.trim().split('\n');
      for (const line of lines) {
        try {
          const envelope = JSON.parse(line);
          if (envelope.message) {
            const event: SyncEvent = JSON.parse(envelope.message);
            handleIncomingEvent(event, true);
          }
        } catch (e) {
          // Skip invalid lines
        }
      }
    } catch (e) {
      // Network retry
    }
  };

  // Run initial historical sync immediately
  fetchRecentCloudEvents();

  // Request state snapshot from other active peers
  setTimeout(() => {
    broadcastSyncEvent({ type: 'REQUEST_STATE_SYNC' });
  }, 1000);

  // Background fallback poll every 3.5 seconds
  pollTimer = setInterval(() => {
    if (isSubscribed) {
      fetchRecentCloudEvents();
    }
  }, 3500);

  // Cleanup handler
  return () => {
    isSubscribed = false;
    if (pollTimer) clearInterval(pollTimer);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    localChannel?.removeEventListener('message', handleLocalMessage);
  };
}
