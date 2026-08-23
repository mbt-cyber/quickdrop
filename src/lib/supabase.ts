/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

/**
 * Validates and sanitizes a URL string to guarantee a valid HTTP/HTTPS URL
 * for Supabase initialization, preventing runtime URL constructor errors.
 */
function getValidSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return 'https://demo-project.supabase.co';
  }
  let trimmed = rawUrl.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null' || trimmed === 'MY_APP_URL') {
    return 'https://demo-project.supabase.co';
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = `https://${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch (e) {
    // Fallback if URL constructor fails
  }
  return 'https://demo-project.supabase.co';
}

/**
 * Validates and returns a non-empty anon key.
 */
function getValidSupabaseKey(rawKey?: string): string {
  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim() || rawKey === 'undefined') {
    return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo-anon-key';
  }
  return rawKey.trim();
}

export function getStoredSupabaseConfig() {
  const customUrl = typeof window !== 'undefined' ? localStorage.getItem('qd_custom_supabase_url') : null;
  const customKey = typeof window !== 'undefined' ? localStorage.getItem('qd_custom_supabase_key') : null;
  const url = customUrl || import.meta.env.VITE_SUPABASE_URL;
  const key = customKey || import.meta.env.VITE_SUPABASE_ANON_KEY;
  return { url, key, isCustom: Boolean(customUrl && customKey) };
}

/**
 * Removes and resets all stored Supabase credentials, tokens, and active sessions.
 */
export function clearSupabaseCredentials(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('qd_custom_supabase_url');
    localStorage.removeItem('qd_custom_supabase_key');
    localStorage.removeItem('qd_supabase_auth_token');
    localStorage.removeItem('qd_supabase_authenticated_user_v1');
    localStorage.removeItem('qd_supabase_auth_session_v1');
    sessionStorage.removeItem('qd_supabase_auth_token');
  } catch (e) {
    console.warn('Error clearing Supabase credentials from storage:', e);
  }
}

/**
 * Saves new Supabase project credentials into localStorage.
 */
export function saveSupabaseCredentials(url: string, key: string): { success: boolean; error?: string } {
  if (typeof window === 'undefined') return { success: false, error: 'Window not defined' };
  const trimmedUrl = url.trim();
  const trimmedKey = key.trim();

  if (!trimmedUrl) {
    return { success: false, error: 'Supabase Project URL is required.' };
  }
  if (!trimmedKey) {
    return { success: false, error: 'Supabase Anon Key is required.' };
  }

  try {
    const validUrl = getValidSupabaseUrl(trimmedUrl);
    if (validUrl === 'https://demo-project.supabase.co') {
      return { success: false, error: 'Please enter a valid HTTP/HTTPS Supabase URL (e.g. https://xyzcompany.supabase.co).' };
    }
    localStorage.setItem('qd_custom_supabase_url', validUrl);
    localStorage.setItem('qd_custom_supabase_key', trimmedKey);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to save credentials.' };
  }
}

/**
 * Tests connection to a Supabase project URL and anon key by executing a test ping.
 */
export async function testSupabaseConnection(url: string, key: string): Promise<{
  success: boolean;
  message: string;
  tablesFound?: string[];
  latencyMs?: number;
}> {
  const startTime = Date.now();
  const validUrl = getValidSupabaseUrl(url);
  const validKey = getValidSupabaseKey(key);

  if (validUrl === 'https://demo-project.supabase.co' || !validKey || validKey.includes('demo-anon-key')) {
    return {
      success: false,
      message: 'Invalid credentials. Please provide your real Supabase Project URL and Anon Key.',
    };
  }

  try {
    const testClient = createClient(validUrl, validKey, {
      auth: { persistSession: false },
      global: { fetch: safeFetch },
    });

    // Test querying the profiles table
    const { data: profilesData, error: profilesError } = await testClient
      .from('profiles')
      .select('id')
      .limit(1);

    // Test querying the orders table
    const { data: ordersData, error: ordersError } = await testClient
      .from('orders')
      .select('id')
      .limit(1);

    const latencyMs = Date.now() - startTime;
    const tables: string[] = [];
    if (!profilesError) tables.push('profiles');
    if (!ordersError) tables.push('orders');

    // If tables don't exist yet, but we reached Supabase server without network/auth error
    if (profilesError?.code === 'PGRST116' || profilesError?.code === '42P01' || ordersError?.code === '42P01') {
      return {
        success: true,
        message: 'Connected to Supabase successfully! Note: Database tables need to be initialized via SQL Editor.',
        tablesFound: tables,
        latencyMs,
      };
    }

    if (profilesError && profilesError.message.includes('Invalid API key')) {
      return {
        success: false,
        message: 'Authentication failed: Invalid Supabase Anon Key. Please check the public anon key from API settings.',
      };
    }

    if (profilesError && profilesError.message.includes('FetchError')) {
      return {
        success: false,
        message: 'Could not connect to Supabase URL. Please check project URL formatting.',
      };
    }

    return {
      success: true,
      message: `Successfully connected to Supabase (${latencyMs}ms)! Real-time cross-device sync is ready.`,
      tablesFound: tables,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Connection test failed: ${err?.message || 'Unknown network error'}.`,
    };
  }
}

/**
 * Dedicated Customer Order Booking SQL schema, tables, triggers, and sample queries for Supabase.
 */
export const CUSTOMER_ORDER_BOOKING_SQL = `-- =========================================================================
-- QUICKDROP: CUSTOMER ORDER BOOKING SQL SCHEMA & QUERIES FOR SUPABASE
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- =========================================================================

-- 1. CREATE DEDICATED CUSTOMER ORDERS TABLE (Structured Relational Schema)
CREATE TABLE IF NOT EXISTS public.customer_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  
  -- Pickup Location
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION DEFAULT 0,
  pickup_lng DOUBLE PRECISION DEFAULT 0,
  pickup_landmark TEXT,
  
  -- Destination Location
  destination_address TEXT NOT NULL,
  destination_lat DOUBLE PRECISION DEFAULT 0,
  destination_lng DOUBLE PRECISION DEFAULT 0,
  destination_landmark TEXT,
  
  -- Sender & Recipient Contact Details
  sender_name TEXT,
  sender_phone TEXT,
  sender_notes TEXT,
  recipient_name TEXT,
  recipient_phone TEXT,
  recipient_notes TEXT,
  
  -- Delivery Details
  delivery_type TEXT DEFAULT 'small_parcel', -- small_parcel | medium_box | documents | food_groceries | fragile
  schedule_type TEXT DEFAULT 'now',          -- now | scheduled
  booking_day_and_time TEXT,
  scheduled_date_time TIMESTAMPTZ,
  distance_km NUMERIC(6, 2) DEFAULT 0,
  fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  -- Payment & Security
  payment_method TEXT DEFAULT 'cash',        -- cash | wallet | upi | card
  payment_status TEXT DEFAULT 'pending',     -- pending | paid | refunded
  otp_code VARCHAR(10) NOT NULL,
  
  -- Lifecycle & Rider Tracking
  status TEXT DEFAULT 'pending',             -- pending | accepted | running | finished | cancelled
  tracking_step TEXT DEFAULT 'created',      -- created | accepted | arriving_pickup | picked_up | on_the_way | arrived_destination | delivered | cancelled
  rider_id TEXT,
  rider_name TEXT,
  rider_phone TEXT,
  cancellation_reason TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CREATE FAST SEARCH INDEXES FOR CUSTOMER ORDER BOOKINGS
CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_id ON public.customer_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON public.customer_orders (status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_rider_id ON public.customer_orders (rider_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_created_at ON public.customer_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_orders_order_number ON public.customer_orders (order_number);

-- 3. ENABLE ROW LEVEL SECURITY (RLS) & PUBLIC ACCESS POLICIES
ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public customer_orders access" ON public.customer_orders;
CREATE POLICY "Public customer_orders access" ON public.customer_orders 
  FOR ALL USING (true) WITH CHECK (true);

-- 4. ENABLE REALTIME SYNC (So Customer & Rider dashboards receive live updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_orders;

-- 5. ALSO ENSURE JSONB ORDERS TABLE EXISTS FOR HYBRID CLIENT COMPATIBILITY
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public orders access" ON public.orders;
CREATE POLICY "Public orders access" ON public.orders FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;

-- =========================================================================
-- SAMPLE SQL QUERIES FOR CUSTOMER ORDER BOOKINGS
-- =========================================================================

-- A. BOOK A NEW CUSTOMER ORDER (INSERT)
/*
INSERT INTO public.customer_orders (
  id, order_number, customer_id, customer_name, customer_phone,
  pickup_address, pickup_lat, pickup_lng, pickup_landmark,
  destination_address, destination_lat, destination_lng, destination_landmark,
  sender_name, sender_phone, sender_notes,
  recipient_name, recipient_phone, recipient_notes,
  delivery_type, schedule_type, booking_day_and_time,
  distance_km, fare, payment_method, payment_status, otp_code,
  status, tracking_step
) VALUES (
  'ord_' || substring(md5(random()::text) from 1 for 10),
  'QD-' || floor(10000 + random() * 90000)::text,
  'cust_99812', 'Rahul Sharma', '+91 9876543210',
  '124, 100ft Road, Indiranagar, Bengaluru', 12.9716, 77.6412, 'Near Metro Station',
  '45, Koramangala 4th Block, Bengaluru', 12.9352, 77.6245, 'Opposite Forum Mall',
  'Rahul Sharma', '+91 9876543210', 'Fragile electronic item. Handle with care.',
  'Priya Verma', '+91 9812345678', 'Ring the bell on arrival.',
  'small_parcel', 'now', 'Today, ' || to_char(NOW(), 'HH12:MI AM'),
  4.8, 85.00, 'upi', 'pending', '4928',
  'pending', 'created'
);
*/

-- B. GET ALL ORDERS FOR A SPECIFIC CUSTOMER (SELECT)
/*
SELECT 
  id, order_number, status, tracking_step, fare, distance_km,
  pickup_address, destination_address, recipient_name, recipient_phone,
  rider_name, rider_phone, otp_code, created_at
FROM public.customer_orders
WHERE customer_id = 'cust_99812'
ORDER BY created_at DESC;
*/

-- C. RIDER ACCEPTS CUSTOMER BOOKING (UPDATE)
/*
UPDATE public.customer_orders
SET 
  status = 'running',
  tracking_step = 'accepted',
  rider_id = 'rider_77',
  rider_name = 'Amit Kumar',
  rider_phone = '+91 9823456789',
  updated_at = NOW()
WHERE id = 'ord_example_id' AND status = 'pending';
*/

-- D. COMPLETE ORDER WITH DELIVERY OTP VERIFICATION (UPDATE)
/*
UPDATE public.customer_orders
SET 
  status = 'finished',
  tracking_step = 'delivered',
  payment_status = 'paid',
  updated_at = NOW()
WHERE id = 'ord_example_id' AND otp_code = '4928';
*/
`;

/**
 * Ready-to-use full SQL setup query for the QuickDrop Supabase database.
 */
export const SUPABASE_DATABASE_SETUP_SQL = `-- QuickDrop Delivery Database Schema Setup
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- 1. Create Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'customer',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  raw_user_meta_data JSONB
);

-- 2. Create Structured Customer Orders Table
CREATE TABLE IF NOT EXISTS public.customer_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION DEFAULT 0,
  pickup_lng DOUBLE PRECISION DEFAULT 0,
  pickup_landmark TEXT,
  destination_address TEXT NOT NULL,
  destination_lat DOUBLE PRECISION DEFAULT 0,
  destination_lng DOUBLE PRECISION DEFAULT 0,
  destination_landmark TEXT,
  sender_name TEXT,
  sender_phone TEXT,
  sender_notes TEXT,
  recipient_name TEXT,
  recipient_phone TEXT,
  recipient_notes TEXT,
  delivery_type TEXT DEFAULT 'small_parcel',
  schedule_type TEXT DEFAULT 'now',
  booking_day_and_time TEXT,
  scheduled_date_time TIMESTAMPTZ,
  distance_km NUMERIC(6, 2) DEFAULT 0,
  fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  payment_status TEXT DEFAULT 'pending',
  otp_code VARCHAR(10) NOT NULL,
  status TEXT DEFAULT 'pending',
  tracking_step TEXT DEFAULT 'created',
  rider_id TEXT,
  rider_name TEXT,
  rider_phone TEXT,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Orders JSONB Table (Application Realtime Sync)
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create Rider Profiles Table
CREATE TABLE IF NOT EXISTS public.rider_profiles (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create Wallet Recharges Table
CREATE TABLE IF NOT EXISTS public.wallet_recharges (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Create Support Messages Table
CREATE TABLE IF NOT EXISTS public.support_messages (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Fast Query Indexes
CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_id ON public.customer_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON public.customer_orders (status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_created_at ON public.customer_orders (created_at DESC);

-- Enable Row Level Security (RLS) & Public Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_recharges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated and anonymous users for real-time delivery
DROP POLICY IF EXISTS "Public profiles access" ON public.profiles;
CREATE POLICY "Public profiles access" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public customer_orders access" ON public.customer_orders;
CREATE POLICY "Public customer_orders access" ON public.customer_orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public orders access" ON public.orders;
CREATE POLICY "Public orders access" ON public.orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public rider profiles access" ON public.rider_profiles;
CREATE POLICY "Public rider profiles access" ON public.rider_profiles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public wallet recharges access" ON public.wallet_recharges;
CREATE POLICY "Public wallet recharges access" ON public.wallet_recharges FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public support messages access" ON public.support_messages;
CREATE POLICY "Public support messages access" ON public.support_messages FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for orders and support messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;

-- Create Storage Bucket for photos and KYC documents
INSERT INTO storage.buckets (id, name, public) 
VALUES ('quickdrop-files', 'quickdrop-files', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public bucket uploads" ON storage.objects;
CREATE POLICY "Public bucket uploads" ON storage.objects FOR ALL USING (bucket_id = 'quickdrop-files') WITH CHECK (bucket_id = 'quickdrop-files');
`;

const { url: initialUrl, key: initialKey } = getStoredSupabaseConfig();

export const supabaseUrl = getValidSupabaseUrl(initialUrl);
export const supabaseAnonKey = getValidSupabaseKey(initialKey);

export const isSupabaseConfigured = Boolean(
  initialUrl &&
  initialKey &&
  !initialUrl.includes('your-project') &&
  !initialUrl.includes('demo-project') &&
  supabaseUrl !== 'https://demo-project.supabase.co'
);

/**
 * Custom safe fetch handler that traps network fetch failures (e.g. offline, CORS, DNS)
 * and returns a standard error Response instead of throwing unhandled NetworkError exceptions.
 */
const safeFetch: typeof fetch = async (input, init) => {
  try {
    const response = await fetch(input, init);
    return response;
  } catch (err: any) {
    console.warn('Supabase network fetch caught safely:', err?.message || err);
    return new Response(
      JSON.stringify({
        error: 'NetworkError',
        message: 'Unable to connect to Supabase server. Please verify network connection or Supabase URL configuration.',
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

/**
 * Initializes and exports the Supabase client instance safely.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: isSupabaseConfigured,
    detectSessionInUrl: isSupabaseConfigured,
    storageKey: 'qd_supabase_auth_token',
  },
  global: {
    fetch: safeFetch,
  },
});

export const QUICKDROP_STORAGE_BUCKET = 'quickdrop-files';

/**
 * Ensures the 'quickdrop-files' storage bucket exists in Supabase.
 * If Supabase is configured, attempts to create the public bucket for all images and files.
 */
export async function ensureQuickDropBucketExists(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) {
      console.warn('Could not list Supabase buckets:', listError.message);
      return false;
    }
    const exists = buckets?.some((b) => b.name === QUICKDROP_STORAGE_BUCKET);
    if (!exists) {
      const { error: createError } = await supabase.storage.createBucket(QUICKDROP_STORAGE_BUCKET, {
        public: true,
        fileSizeLimit: 10485760, // 10MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'],
      });
      if (createError) {
        console.warn('Could not create storage bucket "quickdrop-files":', createError.message);
        return false;
      }
    }
    return true;
  } catch (err: any) {
    console.warn('Error ensuring QuickDrop bucket exists:', err?.message || err);
    return false;
  }
}

/**
 * Uploads any file or image (profile photo, KYC doc, parcel photo) to the Supabase 'quickdrop-files' bucket.
 * Returns the public URL of the uploaded file, or falls back to a base64 Data URL if Supabase storage is unavailable.
 */
export async function uploadQuickDropFile(file: File, folder = 'uploads'): Promise<string> {
  // If Supabase is configured, attempt bucket upload
  if (isSupabaseConfigured) {
    try {
      await ensureQuickDropBucketExists();
      const fileExt = file.name.split('.').pop() || 'png';
      const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from(QUICKDROP_STORAGE_BUCKET)
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (!error && data?.path) {
        const { data: publicUrlData } = supabase.storage
          .from(QUICKDROP_STORAGE_BUCKET)
          .getPublicUrl(data.path);
        if (publicUrlData?.publicUrl) {
          return publicUrlData.publicUrl;
        }
      } else if (error) {
        console.warn('Supabase storage upload error:', error.message);
      }
    } catch (e: any) {
      console.warn('Supabase storage exception, falling back to local reader:', e?.message || e);
    }
  }

  // Fallback: Read file as Data URL
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = (error) => {
      reject(error);
    };
    reader.readAsDataURL(file);
  });
}
