import type { AppPreferences, ConversationCategory, ConversationThread, ThemeMode } from '../types';

const PREFS_STORAGE_KEY = 'vartalap_minimal_preferences_v2';
const CATEGORY_OVERRIDES_KEY = 'vartalap_category_overrides_v1';

const VALID_THEMES: ThemeMode[] = ['forest-mint', 'soft-ivory', 'midnight-jade'];

const DEFAULT_PREFERENCES: AppPreferences = {
  themeMode: 'forest-mint',
  notificationsEnabled: true,
  syncIntervalMinutes: 15,
  driveFeatureEnabled: false
};

// Minimal preferences only (no email contents, no tokens, no persistent database).
export function loadPreferences(): AppPreferences {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    const themeMode =
      parsed.themeMode && VALID_THEMES.includes(parsed.themeMode)
        ? parsed.themeMode
        : 'forest-mint';
    return {
      themeMode,
      notificationsEnabled: Boolean(parsed.notificationsEnabled ?? true),
      syncIntervalMinutes: Math.max(15, Number(parsed.syncIntervalMinutes ?? 15)),
      driveFeatureEnabled: Boolean(parsed.driveFeatureEnabled ?? false)
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: AppPreferences): void {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadCategoryOverrides(): Record<string, ConversationCategory> {
  try {
    const raw = window.localStorage.getItem(CATEGORY_OVERRIDES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ConversationCategory>;
  } catch {
    return {};
  }
}

export function saveCategoryOverride(
  threadId: string,
  category: ConversationCategory
): Record<string, ConversationCategory> {
  const current = loadCategoryOverrides();
  const next = { ...current, [threadId]: category };
  try {
    window.localStorage.setItem(CATEGORY_OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

export function estimateSessionMemoryBytes(threads: ConversationThread[]): number {
  if (threads.length === 0) return 0;
  return new Blob([JSON.stringify(threads)]).size;
}
