import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Role, SupabaseUserProfile } from '../types';

export interface AuthContextType {
  user: SupabaseUserProfile | null;
  loading: boolean;
  error: string | null;
  isDemoMode: boolean;
  activeRole: Role;
  setActiveRole: (role: Role) => void;
  signUpWithEmail: (
    email: string,
    password: string,
    fullName: string,
    role?: Role
  ) => Promise<{ success: boolean; user?: SupabaseUserProfile; error?: string }>;
  signInWithEmail: (
    email: string,
    password: string,
    role?: Role,
    fullName?: string
  ) => Promise<{ success: boolean; user?: SupabaseUserProfile; error?: string }>;
  sendOtp?: (phoneWithCountryCode: string, name?: string, role?: Role) => Promise<{ success: boolean; error?: string; isDemoOtp?: boolean }>;
  verifyOtp?: (phoneWithCountryCode: string, token: string, name?: string, role?: Role) => Promise<{ success: boolean; user?: SupabaseUserProfile; error?: string }>;
  signOut: () => Promise<void>;
  clearError: () => void;
  updateUserProfile: (updates: Partial<SupabaseUserProfile>) => Promise<void>;
}

export const ADMIN_EMAIL = 'freelanceseoservices01@gmail.com';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Storage keys for persistent sessions
const LOCAL_STORAGE_USER_KEY = 'qd_supabase_authenticated_user_v1';
const LOCAL_STORAGE_SESSION_KEY = 'qd_supabase_auth_session_v1';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SupabaseUserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<Role>('customer');

  // Check if live Supabase project is connected
  const isDemoMode = !isSupabaseConfigured;

  // Sync profile from Supabase profiles table
  const fetchOrCreateProfile = async (
    userId: string,
    email: string,
    fullName?: string,
    selectedRole: Role = 'customer',
    phone?: string
  ): Promise<SupabaseUserProfile> => {
    // Admin role enforcement: strictly restrict admin role to ADMIN_EMAIL
    const cleanEmail = (email || '').trim().toLowerCase();
    let validatedRole = selectedRole;
    if (validatedRole === 'admin' && cleanEmail !== ADMIN_EMAIL.toLowerCase()) {
      validatedRole = 'customer';
    }

    if (isSupabaseConfigured) {
      try {
        // Try to fetch existing profile
        const { data: existingProfile, error: fetchErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (existingProfile && !fetchErr) {
          let userRole = (existingProfile.role as Role) || validatedRole;
          if (validatedRole && existingProfile.role !== validatedRole) {
            userRole = validatedRole;
            try {
              await supabase.from('profiles').update({ role: validatedRole }).eq('id', userId);
            } catch (e) {
              console.warn('Could not update profile role in database:', e);
            }
          }
          if (userRole === 'admin' && cleanEmail !== ADMIN_EMAIL.toLowerCase()) {
            userRole = 'customer';
          }
          const profile: SupabaseUserProfile = {
            id: existingProfile.id,
            email: existingProfile.email || email,
            phone: existingProfile.phone || phone || '',
            full_name: (existingProfile.full_name && existingProfile.full_name !== 'User' && existingProfile.full_name !== 'Demo User' && existingProfile.full_name !== 'Verified User') ? existingProfile.full_name : (fullName || (email ? email.split('@')[0] : 'Customer')),
            role: userRole,
            avatar_url: existingProfile.avatar_url,
            created_at: existingProfile.created_at || new Date().toISOString(),
          };
          return profile;
        }

        // Create new profile record in Supabase
        const newProfileData = {
          id: userId,
          email,
          phone: phone || '',
          full_name: fullName || (email ? email.split('@')[0] : 'Customer'),
          role: validatedRole,
          avatar_url: `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80`,
          created_at: new Date().toISOString(),
        };

        const { data: createdData, error: createErr } = await supabase
          .from('profiles')
          .upsert([newProfileData])
          .select('*')
          .single();

        if (!createErr && createdData) {
          let createdRole = createdData.role as Role;
          if (createdRole === 'admin' && cleanEmail !== ADMIN_EMAIL.toLowerCase()) {
            createdRole = 'customer';
          }
          return {
            id: createdData.id,
            email: createdData.email || email,
            phone: createdData.phone || '',
            full_name: createdData.full_name,
            role: createdRole,
            avatar_url: createdData.avatar_url,
            created_at: createdData.created_at,
          };
        }
      } catch (err) {
        console.warn('Supabase database sync note:', err);
      }
    }

    // Fallback profile object for local persistence
    const fallbackProfile: SupabaseUserProfile = {
      id: userId || `usr_${Date.now()}`,
      email,
      phone: phone || '',
      full_name: fullName || (email ? email.split('@')[0] : 'Valued Customer'),
      role: validatedRole,
      avatar_url: `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80`,
      created_at: new Date().toISOString(),
    };

    return fallbackProfile;
  };

  // 1. Initialize & listen for Auth session changes
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      setLoading(true);
      try {
        if (isSupabaseConfigured) {
          // Get current session from Supabase
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user && mounted) {
            const userEmail = session.user.email || '';
            const userMetaName = session.user.user_metadata?.full_name;
            const userMetaRole = (session.user.user_metadata?.role as Role) || activeRole;
            const profile = await fetchOrCreateProfile(
              session.user.id,
              userEmail,
              userMetaName,
              userMetaRole,
              session.user.phone
            );
            setUser(profile);
            setActiveRole(profile.role);
          }
        } else {
          // Check local stored session for app restart persistence
          const savedUserRaw = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
          if (savedUserRaw && mounted) {
            try {
              const parsedUser: SupabaseUserProfile = JSON.parse(savedUserRaw);
              if (parsedUser.role === 'admin' && parsedUser.email?.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
                parsedUser.role = 'customer';
                localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(parsedUser));
              }
              setUser(parsedUser);
              setActiveRole(parsedUser.role);
            } catch (e) {
              localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
            }
          }
        }
      } catch (err: any) {
        console.error('Auth initialization error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    // Subscribe to auth changes if Supabase is configured
    let authListener: any = null;
    if (isSupabaseConfigured) {
      const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          const profile = await fetchOrCreateProfile(
            session.user.id,
            session.user.email || '',
            session.user.user_metadata?.full_name,
            session.user.user_metadata?.role || activeRole,
            session.user.phone
          );
          setUser(profile);
          setActiveRole(profile.role);
          localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
        }
      });
      authListener = listener;
    }

    return () => {
      mounted = false;
      if (authListener?.subscription) {
        authListener.subscription.unsubscribe();
      }
    };
  }, []);

  // Format Supabase Auth errors safely into human-readable strings
  const formatSupabaseError = (err: any, fallbackMsg: string): string => {
    if (!err) return fallbackMsg;

    if (typeof err === 'string') {
      const trimmed = err.trim();
      if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') return trimmed;
    }

    if (err.message && typeof err.message === 'string') {
      const trimmed = err.message.trim();
      if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') {
        return trimmed;
      }
    }

    if (err.error_description && typeof err.error_description === 'string') {
      const trimmed = err.error_description.trim();
      if (trimmed && trimmed !== '{}') return trimmed;
    }

    if (err.status) {
      if (err.status === 503) {
        return 'Supabase authentication service is temporarily unavailable. Using instant local authentication mode.';
      }
      if (err.status === 429) {
        return 'Too many authentication attempts. Please wait a minute and try again.';
      }
      return `Supabase Auth error (Status ${err.status}). Please verify login credentials.`;
    }

    return fallbackMsg;
  };

  // 2. Supabase Email Sign Up
  const signUpWithEmail = async (
    email: string,
    password: string,
    fullName: string,
    selectedRole: Role = 'customer'
  ): Promise<{ success: boolean; user?: SupabaseUserProfile; error?: string }> => {
    setError(null);
    if (!email || !email.includes('@')) {
      const msg = 'Please enter a valid email address.';
      setError(msg);
      return { success: false, error: msg };
    }
    if (selectedRole === 'admin' && email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      const msg = '⚠️ Warning:\nRestricted area Do not Proceed Stop';
      setError(msg);
      return { success: false, error: msg };
    }
    if (!password || password.length < 6) {
      const msg = 'Password must be at least 6 characters long.';
      setError(msg);
      return { success: false, error: msg };
    }

    setLoading(true);

    if (isSupabaseConfigured) {
      try {
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
          options: {
            data: {
              full_name: fullName.trim(),
              role: selectedRole,
            },
          },
        });

        if (signUpErr) {
          console.warn('Supabase signUp error caught:', signUpErr);
          const cleanErr = formatSupabaseError(signUpErr, 'Failed to create account with email.');

          // If network / 503 error, fallback to instant local session creation
          if (signUpErr.status === 503 || cleanErr.includes('temporarily unavailable') || cleanErr.includes('NetworkError')) {
            const mockUserId = `spb_email_${Date.now().toString(36)}`;
            const profile = await fetchOrCreateProfile(
              mockUserId,
              email.trim(),
              fullName.trim() || (email ? email.split('@')[0] : 'Customer'),
              selectedRole
            );
            setUser(profile);
            setActiveRole(profile.role);
            localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
            setLoading(false);
            return { success: true, user: profile };
          }

          setError(cleanErr);
          setLoading(false);
          return { success: false, error: cleanErr };
        }

        // Check if user account already exists in Supabase (identities array is empty)
        if (data?.user?.identities && data.user.identities.length === 0) {
          const msg = 'An account with this email already exists. Please Sign In instead.';
          setError(msg);
          setLoading(false);
          return { success: false, error: msg };
        }

        if (data?.user) {
          const profile = await fetchOrCreateProfile(
            data.user.id,
            email.trim(),
            fullName.trim() || data.user.user_metadata?.full_name,
            selectedRole
          );
          setUser(profile);
          setActiveRole(profile.role);
          localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
          setLoading(false);
          return { success: true, user: profile };
        }
      } catch (err: any) {
        console.warn('Supabase signUp exception:', err);
        const cleanErr = formatSupabaseError(err, 'Failed to sign up with email.');
        setError(cleanErr);
        setLoading(false);
        return { success: false, error: cleanErr };
      }
    }

    // Demo / Fallback Mode Sign Up
    const mockUserId = `spb_email_${Date.now().toString(36)}`;
    const profile = await fetchOrCreateProfile(
      mockUserId,
      email.trim(),
      fullName.trim() || (email ? email.split('@')[0] : 'Customer'),
      selectedRole
    );
    setUser(profile);
    setActiveRole(profile.role);
    localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
    setLoading(false);
    return { success: true, user: profile };
  };

  // 3. Supabase Email Sign In
  const signInWithEmail = async (
    email: string,
    password: string,
    selectedRole?: Role,
    fullName?: string
  ): Promise<{ success: boolean; user?: SupabaseUserProfile; error?: string }> => {
    setError(null);
    if (!email || !email.includes('@')) {
      const msg = 'Please enter a valid email address.';
      setError(msg);
      return { success: false, error: msg };
    }
    if (selectedRole === 'admin' && email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      const msg = '⚠️ Warning:\nRestricted area Do not Proceed Stop';
      setError(msg);
      return { success: false, error: msg };
    }
    if (!password) {
      const msg = 'Please enter your password.';
      setError(msg);
      return { success: false, error: msg };
    }

    setLoading(true);

    if (isSupabaseConfigured) {
      try {
        const { data, error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });

        if (signInErr) {
          console.warn('Supabase signIn error caught:', signInErr);
          const cleanErr = formatSupabaseError(signInErr, 'Invalid email or password.');

          if (signInErr.status === 503 || cleanErr.includes('temporarily unavailable') || cleanErr.includes('NetworkError')) {
            const mockUserId = `spb_email_${Date.now().toString(36)}`;
            const targetRole = selectedRole || activeRole;
            const profile = await fetchOrCreateProfile(
              mockUserId,
              email.trim(),
              email ? email.split('@')[0] : 'Customer',
              targetRole
            );
            setUser(profile);
            setActiveRole(profile.role);
            localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
            setLoading(false);
            return { success: true, user: profile };
          }

          setError(cleanErr);
          setLoading(false);
          return { success: false, error: cleanErr };
        }

        if (data?.user) {
          const userMetaRole = selectedRole || (data.user.user_metadata?.role as Role) || 'customer';
          const resolvedName = fullName?.trim() || data.user.user_metadata?.full_name || (email ? email.split('@')[0] : 'Customer');
          const profile = await fetchOrCreateProfile(
            data.user.id,
            email.trim(),
            resolvedName,
            userMetaRole,
            data.user.phone
          );
          setUser(profile);
          setActiveRole(profile.role);
          localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
          setLoading(false);
          return { success: true, user: profile };
        }
      } catch (err: any) {
        console.warn('Supabase signIn exception:', err);
        const cleanErr = formatSupabaseError(err, 'Invalid email or password.');
        setError(cleanErr);
        setLoading(false);
        return { success: false, error: cleanErr };
      }
    }

    // Demo / Fallback Mode Sign In
    const mockUserId = `spb_email_${Date.now().toString(36)}`;
    const targetRole = selectedRole || activeRole;
    const profile = await fetchOrCreateProfile(
      mockUserId,
      email.trim(),
      email ? email.split('@')[0] : 'Customer',
      targetRole
    );
    setUser(profile);
    setActiveRole(profile.role);
    localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
    setLoading(false);
    return { success: true, user: profile };
  };

  // 4. Send Phone OTP (Legacy helper)
  const sendOtp = async (
    phoneWithCountryCode: string,
    name?: string,
    role: Role = 'customer'
  ) => {
    return { success: true, isDemoOtp: true };
  };

  // 5. Verify Phone OTP (Legacy helper)
  const verifyOtp = async (
    phoneWithCountryCode: string,
    token: string,
    name?: string,
    selectedRole: Role = 'customer'
  ) => {
    const mockUserId = `spb_${Date.now().toString(36)}`;
    const profile = await fetchOrCreateProfile(
      mockUserId,
      `${phoneWithCountryCode}@user.quickdrop`,
      name || `Customer (${phoneWithCountryCode.slice(-4)})`,
      selectedRole,
      phoneWithCountryCode
    );

    setUser(profile);
    setActiveRole(profile.role);
    localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
    return { success: true, user: profile };
  };

  // 6. Sign Out
  const signOut = async () => {
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.warn('Signout error:', e);
    } finally {
      setUser(null);
      localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
      localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
      setLoading(false);
    }
  };

  // 7. Update Profile
  const updateUserProfile = async (updates: Partial<SupabaseUserProfile>) => {
    if (!user) return;
    const updatedProfile: SupabaseUserProfile = {
      ...user,
      ...updates,
    };

    setUser(updatedProfile);
    if (updates.role) {
      setActiveRole(updates.role);
    }
    localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(updatedProfile));

    if (isSupabaseConfigured) {
      try {
        await supabase.from('profiles').upsert([updatedProfile]);
      } catch (e) {
        console.warn('Profile update db error:', e);
      }
    }
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        isDemoMode,
        activeRole,
        setActiveRole,
        signUpWithEmail,
        signInWithEmail,
        sendOtp,
        verifyOtp,
        signOut,
        clearError,
        updateUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};
