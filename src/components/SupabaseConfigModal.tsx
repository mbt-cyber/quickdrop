import React, { useState, useEffect } from 'react';
import {
  X,
  Database,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Key,
  Globe,
  ExternalLink,
  ShieldCheck,
  Code2,
  Eye,
  EyeOff,
  Zap,
} from 'lucide-react';
import {
  getStoredSupabaseConfig,
  clearSupabaseCredentials,
  saveSupabaseCredentials,
  testSupabaseConnection,
  isSupabaseConfigured,
  SUPABASE_DATABASE_SETUP_SQL,
  CUSTOMER_ORDER_BOOKING_SQL,
} from '../lib/supabase';

interface SupabaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupabaseConfigModal: React.FC<SupabaseConfigModalProps> = ({ isOpen, onClose }) => {
  const [urlInput, setUrlInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    tablesFound?: string[];
    latencyMs?: number;
  } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedBookingSql, setCopiedBookingSql] = useState(false);
  const [showSqlGuide, setShowSqlGuide] = useState(false);
  const [sqlTab, setSqlTab] = useState<'booking' | 'full'>('booking');

  const currentConfig = getStoredSupabaseConfig();
  const isCustom = currentConfig.isCustom;

  useEffect(() => {
    if (isOpen) {
      const { url, key } = getStoredSupabaseConfig();
      setUrlInput(url && !url.includes('demo-project') ? url : '');
      setKeyInput(key && !key.includes('demo-anon-key') ? key : '');
      setTestResult(null);
      setErrorMessage(null);
      setSaveSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    if (!urlInput.trim() || !keyInput.trim()) {
      setErrorMessage('Please enter both Supabase Project URL and Anon Key before testing.');
      return;
    }
    setIsTesting(true);
    setErrorMessage(null);
    setTestResult(null);
    try {
      const result = await testSupabaseConnection(urlInput.trim(), keyInput.trim());
      setTestResult(result);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Connection test failed.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const res = saveSupabaseCredentials(urlInput, keyInput);
    if (!res.success) {
      setErrorMessage(res.error || 'Failed to save credentials.');
      return;
    }

    setSaveSuccess(true);
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  const handleRemoveDatabase = () => {
    if (window.confirm('Are you sure you want to remove current Supabase database credentials? This will disconnect the database and switch to local offline storage.')) {
      clearSupabaseCredentials();
      setUrlInput('');
      setKeyInput('');
      setTestResult(null);
      setSaveSuccess(true);
      setTimeout(() => {
        window.location.reload();
      }, 800);
    }
  };

  const handleCopySql = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(SUPABASE_DATABASE_SETUP_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    }
  };

  const handleCopyBookingSql = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(CUSTOMER_ORDER_BOOKING_SQL);
      setCopiedBookingSql(true);
      setTimeout(() => setCopiedBookingSql(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 font-bold">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black font-heading tracking-tight text-white flex items-center gap-2">
                <span>Supabase Database Credentials</span>
                {isSupabaseConfigured ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                    <span>Live Connected</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Local Storage
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-300">
                Remove existing database credentials or connect a new Supabase project for real-time cross-device sync.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 text-slate-800">
          {/* Active Database Status Bar */}
          <div
            className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              isSupabaseConfigured
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-start gap-3">
              {isSupabaseConfigured ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="text-xs font-black uppercase tracking-wider">
                  {isSupabaseConfigured ? 'Database Online & Synchronized' : 'Offline / Local Demo Mode'}
                </div>
                <p className="text-xs mt-0.5 text-slate-600">
                  {isSupabaseConfigured
                    ? `Connected to: ${currentConfig.url || 'Configured'}`
                    : 'Currently saving orders in browser local storage. Connect your Supabase database to sync orders across mobile devices.'}
                </p>
              </div>
            </div>

            {/* Remove / Disconnect Button */}
            {(isSupabaseConfigured || isCustom) && (
              <button
                type="button"
                onClick={handleRemoveDatabase}
                className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs self-start sm:self-auto"
                title="Remove current Supabase database"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Database</span>
              </button>
            )}
          </div>

          {/* Connect New Credentials Form */}
          <form onSubmit={handleSaveCredentials} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-indigo-600" />
                <span>New Supabase Database Credentials</span>
              </h3>
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <span>Open Supabase Dashboard</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Project URL */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                Supabase Project URL <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  required
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://xyzabcdefghijk.supabase.co"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition-all"
                />
              </div>
              <p className="text-[10px] text-slate-500">
                Found under: <em>Supabase Dashboard &gt; Project Settings &gt; API &gt; Project URL</em>
              </p>
            </div>

            {/* Anon / Public Key */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                Supabase Anon / Public Key <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Key className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showKey ? 'text' : 'password'}
                  required
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                Found under: <em>Supabase Dashboard &gt; Project Settings &gt; API &gt; Project API keys &gt; anon (public)</em>
              </p>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Test Result Message */}
            {testResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  testResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-bold">{testResult.success ? 'Connection Verified' : 'Connection Error'}</div>
                  <p className="mt-0.5">{testResult.message}</p>
                </div>
              </div>
            )}

            {/* Save Success Alert */}
            {saveSuccess && (
              <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Supabase credentials updated! Reloading application...</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold shadow-md transition-all cursor-pointer flex items-center gap-2 active:scale-95"
              >
                <Check className="w-4 h-4" />
                <span>Save & Connect Database</span>
              </button>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isTesting ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                ) : (
                  <Zap className="w-4 h-4 text-indigo-600" />
                )}
                <span>{isTesting ? 'Testing Connection...' : 'Test Connection'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUrlInput('');
                  setKeyInput('');
                  setTestResult(null);
                  setErrorMessage(null);
                }}
                className="px-3.5 py-2.5 text-slate-500 hover:text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-100 transition-colors ml-auto cursor-pointer"
              >
                Clear Inputs
              </button>
            </div>
          </form>

          {/* Database Setup SQL Helper */}
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowSqlGuide(!showSqlGuide)}
                className="text-xs font-bold text-slate-700 hover:text-indigo-600 flex items-center gap-1.5 cursor-pointer"
              >
                <Code2 className="w-4 h-4 text-indigo-600" />
                <span>Need Customer Order Booking SQL or full Supabase table setup? Click for scripts</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyBookingSql}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  {copiedBookingSql ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedBookingSql ? 'Copied Booking SQL!' : 'Copy Booking SQL'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopySql}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSql ? 'Copied Full Schema!' : 'Copy Full Schema'}</span>
                </button>
              </div>
            </div>

            {showSqlGuide && (
              <div className="bg-slate-900 text-slate-200 p-4 rounded-2xl text-[11px] font-mono space-y-2.5 border border-slate-800">
                {/* Tab Switcher */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSqlTab('booking')}
                      className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                        sqlTab === 'booking'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      Customer Order Booking SQL
                    </button>
                    <button
                      type="button"
                      onClick={() => setSqlTab('full')}
                      className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                        sqlTab === 'full'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      Complete Setup SQL
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={sqlTab === 'booking' ? handleCopyBookingSql : handleCopySql}
                    className="text-indigo-400 hover:text-indigo-300 font-bold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>
                      {sqlTab === 'booking'
                        ? copiedBookingSql ? '✓ Copied' : 'Copy Booking SQL'
                        : copiedSql ? '✓ Copied' : 'Copy Full Setup'}
                    </span>
                  </button>
                </div>

                <div className="text-[10px] text-slate-400">
                  {sqlTab === 'booking'
                    ? 'Customer Orders Table + Indexes + RLS + Realtime + INSERT, SELECT, UPDATE booking queries.'
                    : 'Complete setup for profiles, customer_orders, orders, rider_profiles, wallet_recharges, and support_messages.'}
                </div>

                <pre className="overflow-x-auto max-h-48 text-slate-300 scrollbar-thin leading-relaxed">
                  {sqlTab === 'booking' ? CUSTOMER_ORDER_BOOKING_SQL : SUPABASE_DATABASE_SETUP_SQL}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0 text-xs text-slate-500">
          <div className="flex items-center gap-1.5 text-[11px]">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Credentials are securely stored locally in your browser session.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
