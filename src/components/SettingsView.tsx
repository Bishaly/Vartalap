import { useState } from 'react';
import {
  Bell,
  Database,
  FolderOpen,
  HardDrive,
  LogOut,
  Palette,
  RefreshCw,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import type {
  AppPreferences,
  DriveFileEntry,
  GmailAccountProfile,
  ThemeMode
} from '../types';

interface SettingsViewProps {
  profile: GmailAccountProfile | null;
  preferences: AppPreferences;
  sessionMemoryBytes: number;
  lastSyncedAt: number | null;
  driveFiles: DriveFileEntry[];
  isDriveConnected: boolean;
  isLoadingDrive: boolean;
  onEnableDrive: () => void;
  onDisableDrive: () => void;
  onRefreshDriveFiles: (query: string) => void;
  onUpdatePreferences: (next: AppPreferences) => void;
  onManualSync: () => void;
  onClearSessionCache: () => void;
  onDisconnect: () => void;
  isSyncing: boolean;
}

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  label: string;
  description: string;
  swatch: [string, string];
}> = [
  {
    id: 'forest-mint',
    label: 'Forest & Mint',
    description: 'Deep Forest, Jade Green & Mint Mist',
    swatch: ['#183B38', '#DCEBE2']
  },
  {
    id: 'soft-ivory',
    label: 'Soft Ivory',
    description: 'Warm daylight ivory & charcoal',
    swatch: ['#F5F7F4', '#237D68']
  },
  {
    id: 'midnight-jade',
    label: 'Midnight Jade',
    description: 'Calm dark charcoal & jade green',
    swatch: ['#151B19', '#237D68']
  }
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SettingsView({
  profile,
  preferences,
  sessionMemoryBytes,
  lastSyncedAt,
  driveFiles,
  isDriveConnected,
  isLoadingDrive,
  onEnableDrive,
  onDisableDrive,
  onRefreshDriveFiles,
  onUpdatePreferences,
  onManualSync,
  onClearSessionCache,
  onDisconnect,
  isSyncing
}: SettingsViewProps) {
  const [driveSearch, setDriveSearch] = useState('');

  const handleToggleNotifications = async () => {
    const nextEnabled = !preferences.notificationsEnabled;
    if (nextEnabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      onUpdatePreferences({
        ...preferences,
        notificationsEnabled: permission === 'granted'
      });
      return;
    }
    onUpdatePreferences({
      ...preferences,
      notificationsEnabled: nextEnabled
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--v-text)]">Settings</h2>
        <p className="text-sm text-[var(--v-muted)] mt-1">
          Direct-to-Google configuration with zero developer servers or databases.
        </p>
      </div>

      {/* Connected Account */}
      <section className="rounded-2xl bg-[var(--v-surface)] border border-[var(--v-border)] p-6">
        <h3 className="text-sm font-semibold text-[var(--v-text)]">Connected Gmail Account</h3>
        {profile ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              {profile.photoUrl ? (
                <img
                  src={profile.photoUrl}
                  alt={profile.displayName}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-[var(--v-primary)] text-white flex items-center justify-center font-semibold">
                  {profile.displayName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-[var(--v-text)]">{profile.displayName}</p>
                <p className="text-xs text-[var(--v-muted)]">{profile.email}</p>
                <p className="text-xs text-[var(--v-muted)] mt-0.5 tabular-nums">
                  {profile.threadsTotal.toLocaleString()} threads ·{' '}
                  {profile.messagesTotal.toLocaleString()} messages
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onDisconnect}
              className="min-h-[40px] px-4 py-2 rounded-xl border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Disconnect Gmail</span>
            </button>
          </div>
        ) : (
          <p className="text-sm text-[var(--v-muted)] mt-2">
            No Gmail account is currently connected.
          </p>
        )}
      </section>

      {/* Theme Appearance (3 Vartalap Themes) */}
      <section className="rounded-2xl bg-[var(--v-surface)] border border-[var(--v-border)] p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Palette className="w-5 h-5 text-[var(--v-secondary)] mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--v-text)]">Theme Appearance</h3>
            <p className="text-xs text-[var(--v-muted)] mt-0.5">
              Choose between Forest &amp; Mint, Soft Ivory, and Midnight Jade. Stored locally as a
              minimal preference.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {THEME_OPTIONS.map((theme) => {
            const active = preferences.themeMode === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onUpdatePreferences({ ...preferences, themeMode: theme.id })}
                className={`text-left p-4 rounded-xl border transition-colors ${
                  active
                    ? 'border-[var(--v-secondary)] bg-[var(--v-chip)]/60'
                    : 'border-[var(--v-border)] hover:bg-[var(--v-surface-alt)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-semibold text-[var(--v-text)]">{theme.label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className="w-4 h-4 rounded-full border border-black/10"
                      style={{ backgroundColor: theme.swatch[0] }}
                    />
                    <span
                      className="w-4 h-4 rounded-full border border-black/10"
                      style={{ backgroundColor: theme.swatch[1] }}
                    />
                  </div>
                </div>
                <p className="text-xs text-[var(--v-muted)]">{theme.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Optional User-Owned Google Drive */}
      <section className="rounded-2xl bg-[var(--v-surface)] border border-[var(--v-border)] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <HardDrive className="w-5 h-5 text-[var(--v-secondary)] mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--v-text)]">
                Optional User-Owned Google Drive
              </h3>
              <p className="text-xs text-[var(--v-muted)] mt-0.5 max-w-xl leading-relaxed">
                Connect your own Google Drive account only when needed to save selected email
                attachments or browse files you choose. Attachments are never automatically
                uploaded.
              </p>
            </div>
          </div>

          {isDriveConnected && preferences.driveFeatureEnabled ? (
            <button
              type="button"
              onClick={onDisableDrive}
              className="min-h-[38px] px-4 py-1.5 rounded-xl border border-[var(--v-border)] text-xs font-semibold text-[var(--v-text)] hover:bg-[var(--v-surface-alt)]"
            >
              Disable Drive
            </button>
          ) : (
            <button
              type="button"
              onClick={onEnableDrive}
              disabled={!profile}
              className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[var(--v-primary)] hover:opacity-95 text-white text-xs font-semibold disabled:opacity-50"
            >
              Connect My Google Drive
            </button>
          )}
        </div>

        {isDriveConnected && preferences.driveFeatureEnabled && (
          <div className="pt-4 border-t border-[var(--v-border)] space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={driveSearch}
                onChange={(e) => setDriveSearch(e.target.value)}
                placeholder="Search your Google Drive files..."
                className="flex-1 min-h-[38px] px-3 py-1.5 text-xs rounded-xl bg-[var(--v-bg)] border border-[var(--v-border)] text-[var(--v-text)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onRefreshDriveFiles(driveSearch)}
                disabled={isLoadingDrive}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-[var(--v-border)] text-xs font-semibold text-[var(--v-text)]"
              >
                {isLoadingDrive ? 'Loading...' : 'Browse Drive'}
              </button>
            </div>

            {driveFiles.length > 0 ? (
              <div className="max-h-56 overflow-y-auto divide-y divide-[var(--v-border)] rounded-xl border border-[var(--v-border)]">
                {driveFiles.map((file) => (
                  <div
                    key={file.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FolderOpen className="w-4 h-4 text-[var(--v-secondary)] shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--v-text)] truncate">{file.name}</p>
                        <p className="text-[11px] text-[var(--v-muted)] tabular-nums">
                          {file.mimeType} · {formatBytes(file.sizeBytes)}
                        </p>
                      </div>
                    </div>
                    {file.webViewLink && (
                      <a
                        href={file.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--v-secondary)] font-semibold hover:underline shrink-0"
                      >
                        Open
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--v-muted)]">
                Click &ldquo;Browse Drive&rdquo; to list files from your Google Drive.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Notifications, Sync & In-Memory Session Cache */}
      <section className="rounded-2xl bg-[var(--v-surface)] border border-[var(--v-border)] divide-y divide-[var(--v-border)]">
        <div className="p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell className="w-5 h-5 text-[var(--v-secondary)] mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--v-text)]">
                Incoming Message Notifications
              </h3>
              <p className="text-xs text-[var(--v-muted)] mt-0.5">
                Periodic sync checks Gmail directly; instant push notifications require a backend.
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={preferences.notificationsEnabled}
            onClick={handleToggleNotifications}
            className={`min-h-[36px] px-4 rounded-xl text-xs font-semibold transition-colors ${
              preferences.notificationsEnabled
                ? 'bg-[var(--v-primary)] text-white'
                : 'bg-[var(--v-surface-alt)] text-[var(--v-muted)]'
            }`}
          >
            {preferences.notificationsEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <RefreshCw className="w-5 h-5 text-[var(--v-secondary)] mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-[var(--v-text)]">
                  Gmail Sync &amp; Background Limitation
                </h3>
                <p className="text-xs text-[var(--v-muted)] mt-0.5">
                  Android WorkManager enforces a 15-minute minimum periodic interval without a
                  developer push backend.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onManualSync}
              disabled={isSyncing || !profile}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[var(--v-primary)] hover:opacity-95 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
            >
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="inline-flex items-center gap-2">
              {[15, 30, 60].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() =>
                    onUpdatePreferences({ ...preferences, syncIntervalMinutes: minutes })
                  }
                  className={`min-h-[36px] px-3.5 rounded-xl text-xs font-semibold tabular-nums border transition-colors ${
                    preferences.syncIntervalMinutes === minutes
                      ? 'border-[var(--v-secondary)] bg-[var(--v-chip)] text-[var(--v-text)]'
                      : 'border-[var(--v-border)] text-[var(--v-muted)]'
                  }`}
                >
                  Every {minutes} min
                </button>
              ))}
            </div>
            <span className="text-xs text-[var(--v-muted)] tabular-nums">
              {lastSyncedAt
                ? `Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}`
                : 'Not yet synced'}
            </span>
          </div>
        </div>

        <div className="p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Database className="w-5 h-5 text-[var(--v-secondary)] mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--v-text)]">
                Active In-Memory Session Cache
              </h3>
              <p className="text-xs text-[var(--v-muted)] mt-0.5 tabular-nums">
                Zero database persistence. Current active session memory:{' '}
                {formatBytes(sessionMemoryBytes)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClearSessionCache}
            className="min-h-[40px] px-4 py-2 rounded-xl border border-[var(--v-border)] text-xs font-semibold text-[var(--v-text)] hover:bg-[var(--v-surface-alt)] inline-flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear Session Cache</span>
          </button>
        </div>
      </section>

      {/* Privacy & Architecture */}
      <section className="rounded-2xl bg-[var(--v-surface)] border border-[var(--v-border)] p-6 space-y-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-[var(--v-secondary)]" />
          <h3 className="text-sm font-semibold text-[var(--v-text)]">
            User-Owned Infrastructure &amp; Privacy
          </h3>
        </div>
        <p className="text-xs text-[var(--v-muted)] leading-relaxed">
          Vartalap runs directly against Google&apos;s official Gmail API and optional user-owned
          Google Drive API over HTTPS. There is no developer server, no Room/SQLite/remote email
          database, and no third-party file hosting.
        </p>
        <p className="text-xs text-[var(--v-muted)]">
          Vartalap · com.nextgen.vartalap · Conversations, made simple.
        </p>
      </section>
    </div>
  );
}
