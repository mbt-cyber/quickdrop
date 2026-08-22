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

const rawEnvUrl = import.meta.env.VITE_SUPABASE_URL;
const rawEnvKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseUrl = getValidSupabaseUrl(rawEnvUrl);
export const supabaseAnonKey = getValidSupabaseKey(rawEnvKey);

export const isSupabaseConfigured = Boolean(
  rawEnvUrl &&
  rawEnvKey &&
  !rawEnvUrl.includes('your-project') &&
  !rawEnvUrl.includes('demo-project') &&
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
