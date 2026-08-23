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
 * Ready-to-use SQL setup query for the QuickDrop Supabase database.
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

-- 2. Create Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Rider Profiles Table
CREATE TABLE IF NOT EXISTS public.rider_profiles (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create Wallet Recharges Table
CREATE TABLE IF NOT EXISTS public.wallet_recharges (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create Support Messages Table
CREATE TABLE IF NOT EXISTS public.support_messages (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) & Public Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_recharges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated and anonymous users for real-time delivery
DROP POLICY IF EXISTS "Public profiles access" ON public.profiles;
CREATE POLICY "Public profiles access" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public orders access" ON public.orders;
CREATE POLICY "Public orders access" ON public.orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public rider profiles access" ON public.rider_profiles;
CREATE POLICY "Public rider profiles access" ON public.rider_profiles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public wallet recharges access" ON public.wallet_recharges;
CREATE POLICY "Public wallet recharges access" ON public.wallet_recharges FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public support messages access" ON public.support_messages;
CREATE POLICY "Public support messages access" ON public.support_messages FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for orders and support messages
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
