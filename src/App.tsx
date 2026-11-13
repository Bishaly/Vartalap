import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2,
  FolderOpen,
  MessageSquare,
  Plus,
  Settings
} from 'lucide-react';
import { AndroidStudioView } from './components/AndroidStudioView';
import { BrandMark } from './components/BrandMark';
import { ChatThreadView } from './components/ChatThreadView';
import { ConfirmationModal } from './components/ConfirmationModal';
import { ConversationList } from './components/ConversationList';
import { EmailFolderView } from './components/EmailFolderView';
import { NewConversationModal } from './components/NewConversationModal';
import { SettingsView } from './components/SettingsView';
import { WelcomeView } from './components/WelcomeView';
import { listUserDriveFiles, uploadAttachmentToUserDrive } from './lib/driveClient';
import {
  disconnectGoogleAccount,
  getAccessToken,
  initAuth,
  isDriveConsentGranted,
  requestOptionalDriveAccess,
  signInWithGoogleGmail
} from './lib/firebaseAuth';
import {
  buildFriendlyQuotaMessage,
  clearGmailQuotaCooldown,
  downloadGmailAttachment,
  fetchFolderThreadsPage,
  fetchGmailProfile,
  fetchSingleThread,
  fetchThreadsPage,
  getGmailQuotaCooldownSeconds,
  GmailApiError,
  logGmailCacheHit,
  modifyThreadLabels,
  sendGmailMimeMessage,
  syncIncrementalHistory
} from './lib/gmailClient';
import {
  estimateSessionMemoryBytes,
  loadCategoryOverrides,
  loadPreferences,
  saveCategoryOverride,
  savePreferences
} from './lib/localCache';
import type {
  AppErrorState,
  AppPreferences,
  ConversationCategory,
  ConversationFilter,
  ConversationThread,
  DriveFileEntry,
  EmailAttachment,
  EmailFolder,
  GmailAccountProfile,
  NavDestination,
  OutgoingAttachmentFile,
  PendingConfirmation
} from './types';

const PAGE_SIZE = 15;
const MIN_SYNC_INTERVAL_MS = 30_000;
const MANUAL_REFRESH_DEBOUNCE_MS = 1_500;
const FULL_THREAD_CACHE_TTL_MS = 120_000;
const MIN_BACKGROUND_SYNC_GAP_MS = 5 * 60 * 1000;

function mergeThreadLists(
  existing: ConversationThread[],
  incoming: ConversationThread[]
): ConversationThread[] {
  const map = new Map<string, ConversationThread>();
  existing.forEach((t) => map.set(t.threadId, t));
  incoming.forEach((next) => {
    const prev = map.get(next.threadId);
    if (
      prev?.hydratedLevel === 'full' &&
      next.hydratedLevel === 'metadata' &&
      prev.messages.length === next.messages.length
    ) {
      map.set(next.threadId, {
        ...next,
        hydratedLevel: 'full',
        lastFullFetchedAt: prev.lastFullFetchedAt,
        hasAttachments: prev.hasAttachments || next.hasAttachments,
        lastMessagePreview: prev.lastMessagePreview || next.lastMessagePreview,
        messages: prev.messages.map((m, idx) => {
          const updatedMeta = next.messages[idx];
          return updatedMeta
            ? { ...m, isRead: updatedMeta.isRead, labelIds: updatedMeta.labelIds }
            : m;
        })
      });
    } else {
      map.set(next.threadId, next);
    }
  });
  return Array.from(map.values()).sort(
    (a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp
  );
}

export default function App() {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [profile, setProfile] = useState<GmailAccountProfile | null>(null);
  // Active session conversations live strictly in memory (zero DB persistence).
  const [conversations, setConversations] = useState<ConversationThread[]>([]);
  const [folderThreads, setFolderThreads] = useState<Partial<Record<EmailFolder, ConversationThread[]>>>({});
  const [folderNextPages, setFolderNextPages] = useState<Partial<Record<EmailFolder, string | null>>>({});
  const [activeFolder, setActiveFolder] = useState<EmailFolder>('INBOX');
  const [isFolderLoading, setIsFolderLoading] = useState(false);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeDestination, setActiveDestination] = useState<NavDestination>('conversations');
  const [activeFilter, setActiveFilter] = useState<ConversationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, ConversationCategory>>(
    () => loadCategoryOverrides()
  );

  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<AppErrorState | null>(null);

  // Optional user-owned Google Drive state
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileEntry[]>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);

  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>(() => loadPreferences());

  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);

  const sendLockRef = useRef<Set<string>>(new Set());
  const historyIdRef = useRef<string | null>(null);
  const syncInFlightRef = useRef<boolean>(false);
  const folderInFlightRef = useRef<boolean>(false);
  const paginationInFlightRef = useRef<boolean>(false);
  const inFlightThreadFetchesRef = useRef<Map<string, Promise<ConversationThread | null>>>(new Map());
  const lastSyncCompletedAtRef = useRef<number>(0);
  const lastManualRefreshAtRef = useRef<number>(0);
  const manualRefreshTimerRef = useRef<number | null>(null);
  const folderLoadedAtRef = useRef<Partial<Record<EmailFolder, number>>>({});
  const knownThreadsRef = useRef<Map<string, ConversationThread>>(new Map());

  useEffect(() => {
    const map = new Map<string, ConversationThread>();
    conversations.forEach((t) => map.set(t.threadId, t));
    (Object.values(folderThreads) as Array<ConversationThread[] | undefined>).forEach((list) => {
      list?.forEach((t) => {
        const existing = map.get(t.threadId);
        if (!existing || (existing.hydratedLevel !== 'full' && t.hydratedLevel === 'full')) {
          map.set(t.threadId, t);
        }
      });
    });
    knownThreadsRef.current = map;
  }, [conversations, folderThreads]);

  useEffect(() => {
    return () => {
      if (manualRefreshTimerRef.current !== null) {
        window.clearTimeout(manualRefreshTimerRef.current);
      }
    };
  }, []);

  const sessionMemoryBytes = useMemo(
    () => estimateSessionMemoryBytes(conversations),
    [conversations]
  );

  // Apply Forest & Mint, Soft Ivory, or Midnight Jade theme
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', preferences.themeMode);
    root.classList.toggle('dark', preferences.themeMode === 'midnight-jade');
  }, [preferences.themeMode]);

  // Monitor online/offline state
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      () => {
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const notifyNewIncoming = useCallback(
    (updatedThreads: ConversationThread[]) => {
      if (!preferences.notificationsEnabled) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const unread = updatedThreads.find((t) => t.unreadCount > 0 && !t.isAutomatedOrBulk);
      if (!unread) return;
      const n = new Notification(unread.contactName, {
        body: unread.lastMessagePreview,
        tag: unread.threadId
      });
      n.onclick = () => {
        setActiveDestination('conversations');
        setSelectedThreadId(unread.threadId);
      };
    },
    [preferences.notificationsEnabled]
  );

  const performSync = useCallback(
    async (tokenOverride?: string, accountOverride?: GmailAccountProfile, forceFull = false) => {
      const token = tokenOverride ?? getAccessToken();
      const activeProfile = accountOverride ?? profile;
      if (!token || !activeProfile) {
        setNeedsAuth(true);
        return;
      }

      const cooldown = getGmailQuotaCooldownSeconds();
      if (cooldown > 0) {
        setErrorState({
          kind: 'quota_exceeded',
          message: buildFriendlyQuotaMessage(cooldown)
        });
        return;
      }

      if (syncInFlightRef.current) {
        logGmailCacheHit('sync.dedup_in_flight');
        return;
      }

      if (!forceFull && Date.now() - lastSyncCompletedAtRef.current < MIN_SYNC_INTERVAL_MS) {
        logGmailCacheHit('sync.min_interval_skip');
        return;
      }

      syncInFlightRef.current = true;
      setIsSyncing(true);
      setErrorState(null);
      try {
        let updated: ConversationThread[] = [];

        if (!forceFull && historyIdRef.current) {
          const inc = await syncIncrementalHistory(
            token,
            activeProfile.email,
            historyIdRef.current,
            categoryOverrides,
            knownThreadsRef.current
          );
          if (inc.requiresFullSync) {
            const page = await fetchThreadsPage(token, activeProfile.email, {
              maxResults: PAGE_SIZE,
              categoryOverrides,
              knownThreads: knownThreadsRef.current
            });
            updated = page.conversations;
            setNextPageToken(page.nextPageToken);
            if (page.latestHistoryId) {
              historyIdRef.current = page.latestHistoryId;
            } else {
              const latestProfile = await fetchGmailProfile(
                token,
                activeProfile.displayName,
                activeProfile.photoUrl
              );
              historyIdRef.current = latestProfile.historyId;
              setProfile(latestProfile);
            }
          } else {
            updated = inc.updatedThreads;
            historyIdRef.current = inc.latestHistoryId;
            if (updated.length > 0) {
              notifyNewIncoming(updated);
            }
          }
        } else {
          const page = await fetchThreadsPage(token, activeProfile.email, {
            maxResults: PAGE_SIZE,
            categoryOverrides,
            knownThreads: knownThreadsRef.current
          });
          updated = page.conversations;
          setNextPageToken(page.nextPageToken);
          if (page.latestHistoryId) {
            historyIdRef.current = page.latestHistoryId;
          } else if (!historyIdRef.current) {
            const latestProfile = await fetchGmailProfile(
              token,
              activeProfile.displayName,
              activeProfile.photoUrl
            );
            historyIdRef.current = latestProfile.historyId;
            setProfile(latestProfile);
          }
        }

        const now = Date.now();
        lastSyncCompletedAtRef.current = now;
        folderLoadedAtRef.current.INBOX = now;
        setLastSyncedAt(now);
        setConversations((prev) => (forceFull ? updated : mergeThreadLists(prev, updated)));
      } catch (err) {
        if (err instanceof GmailApiError) {
          setErrorState({ kind: err.kind, message: err.message });
          if (err.kind === 'auth_expired') {
            setNeedsAuth(true);
          }
        } else {
          setErrorState({
            kind: 'sync_failed',
            message: err instanceof Error ? err.message : 'Synchronization failed.'
          });
        }
      } finally {
        syncInFlightRef.current = false;
        setIsSyncing(false);
      }
    },
    [categoryOverrides, notifyNewIncoming, profile]
  );

  const handleDebouncedRefresh = useCallback(() => {
    const cooldown = getGmailQuotaCooldownSeconds();
    if (cooldown > 0) {
      setErrorState({
        kind: 'quota_exceeded',
        message: buildFriendlyQuotaMessage(cooldown)
      });
      return;
    }

    const now = Date.now();
    if (now - lastManualRefreshAtRef.current < MANUAL_REFRESH_DEBOUNCE_MS) {
      logGmailCacheHit('sync.manual_debounce_skip');
      return;
    }
    lastManualRefreshAtRef.current = now;

    if (manualRefreshTimerRef.current !== null) {
      window.clearTimeout(manualRefreshTimerRef.current);
    }
    manualRefreshTimerRef.current = window.setTimeout(() => {
      manualRefreshTimerRef.current = null;
      performSync(undefined, undefined, false);
    }, 350);
  }, [performSync]);

  const loadFolder = useCallback(
    async (folder: EmailFolder, loadMore = false) => {
      const token = getAccessToken();
      if (!token || !profile) return;

      const cooldown = getGmailQuotaCooldownSeconds();
      if (cooldown > 0) {
        setErrorState({
          kind: 'quota_exceeded',
          message: buildFriendlyQuotaMessage(cooldown)
        });
        return;
      }

      if (folderInFlightRef.current) {
        logGmailCacheHit(`folder.dedup_${folder}`);
        return;
      }

      const lastFolderLoad = folderLoadedAtRef.current[folder] ?? 0;
      if (!loadMore && lastFolderLoad > 0 && Date.now() - lastFolderLoad < MIN_SYNC_INTERVAL_MS) {
        logGmailCacheHit(`folder.cooldown_skip_${folder}`);
        return;
      }

      const pageToken = loadMore ? folderNextPages[folder] ?? null : null;
      if (loadMore && !pageToken) return;

      folderInFlightRef.current = true;
      setIsFolderLoading(true);
      try {
        const res = await fetchFolderThreadsPage(token, profile.email, folder, {
          pageToken,
          maxResults: PAGE_SIZE,
          categoryOverrides,
          knownThreads: knownThreadsRef.current
        });
        folderLoadedAtRef.current[folder] = Date.now();
        setFolderThreads((prev) => ({
          ...prev,
          [folder]: loadMore
            ? mergeThreadLists(prev[folder] ?? [], res.conversations)
            : res.conversations
        }));
        setFolderNextPages((prev) => ({
          ...prev,
          [folder]: res.nextPageToken
        }));
      } catch (err) {
        if (err instanceof GmailApiError) {
          setErrorState({ kind: err.kind, message: err.message });
          if (err.kind === 'auth_expired') {
            setNeedsAuth(true);
          }
        }
      } finally {
        folderInFlightRef.current = false;
        setIsFolderLoading(false);
      }
    },
    [categoryOverrides, folderNextPages, profile]
  );

  useEffect(() => {
    if (
      activeDestination === 'folders' &&
      !needsAuth &&
      profile &&
      !folderThreads[activeFolder] &&
      !folderInFlightRef.current
    ) {
      loadFolder(activeFolder, false);
    }
  }, [activeDestination, activeFolder, folderThreads, loadFolder, needsAuth, profile]);

  // Periodic sync when connected (minimum 15 minutes; skips during cooldown or recent foreground sync)
  useEffect(() => {
    if (needsAuth || !profile) return;
    const ms = Math.max(15, preferences.syncIntervalMinutes) * 60 * 1000;
    const timer = window.setInterval(() => {
      if (getGmailQuotaCooldownSeconds() > 0) return;
      if (Date.now() - lastSyncCompletedAtRef.current < MIN_BACKGROUND_SYNC_GAP_MS) return;
      performSync(undefined, undefined, false);
    }, ms);
    return () => window.clearInterval(timer);
  }, [needsAuth, preferences.syncIntervalMinutes, performSync, profile]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const { user, accessToken } = await signInWithGoogleGmail();
      const loadedProfile = await fetchGmailProfile(
        accessToken,
        user.displayName ?? user.email?.split('@')[0] ?? 'Gmail User',
        user.photoURL ?? null
      );
      setProfile(loadedProfile);
      historyIdRef.current = loadedProfile.historyId;
      setDriveConnected(isDriveConsentGranted());
      setNeedsAuth(false);
      await performSync(accessToken, loadedProfile, true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleEnableDrive = async () => {
    try {
      const token = await requestOptionalDriveAccess();
      setDriveConnected(true);
      const nextPrefs = { ...preferences, driveFeatureEnabled: true };
      setPreferences(nextPrefs);
      savePreferences(nextPrefs);
      setIsLoadingDrive(true);
      const files = await listUserDriveFiles(token);
      setDriveFiles(files);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Could not enable Google Drive.');
    } finally {
      setIsLoadingDrive(false);
    }
  };

  const handleDisableDrive = () => {
    setDriveConnected(false);
    setDriveFiles([]);
    const nextPrefs = { ...preferences, driveFeatureEnabled: false };
    setPreferences(nextPrefs);
    savePreferences(nextPrefs);
  };

  const handleRefreshDriveFiles = async (query: string) => {
    const token = getAccessToken();
    if (!token || !driveConnected) return;
    setIsLoadingDrive(true);
    try {
      const files = await listUserDriveFiles(token, query);
      setDriveFiles(files);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to list Google Drive files.');
    } finally {
      setIsLoadingDrive(false);
    }
  };

  const handleSaveAttachmentToDrive = (att: EmailAttachment) => {
    const token = getAccessToken();
    if (!token || !driveConnected) {
      setSendError('Enable your Google Drive in Settings first.');
      return;
    }

    setPendingConfirmation({
      title: 'Save attachment to your Google Drive?',
      description:
        'Only this selected attachment will be streamed from Gmail and uploaded to your own Google Drive.',
      details: [`File: ${att.fileName}`, `Type: ${att.mimeType}`],
      confirmLabel: 'Upload to My Drive',
      onConfirm: async () => {
        const { bytes } = await downloadGmailAttachment(token, att);
        await uploadAttachmentToUserDrive(token, {
          fileName: att.fileName,
          mimeType: att.mimeType,
          bytes
        });
        const files = await listUserDriveFiles(token);
        setDriveFiles(files);
      }
    });
  };

  const handleLoadMore = async () => {
    const token = getAccessToken();
    if (!token || !profile || !nextPageToken || paginationInFlightRef.current) return;
    const cooldown = getGmailQuotaCooldownSeconds();
    if (cooldown > 0) {
      setErrorState({
        kind: 'quota_exceeded',
        message: buildFriendlyQuotaMessage(cooldown)
      });
      return;
    }

    paginationInFlightRef.current = true;
    setIsLoadingMore(true);
    try {
      const page = await fetchThreadsPage(token, profile.email, {
        pageToken: nextPageToken,
        maxResults: PAGE_SIZE,
        categoryOverrides,
        knownThreads: knownThreadsRef.current
      });
      setNextPageToken(page.nextPageToken);
      setConversations((prev) => mergeThreadLists(prev, page.conversations));
    } catch (err) {
      if (err instanceof GmailApiError) {
        setErrorState({ kind: err.kind, message: err.message });
      }
    } finally {
      paginationInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  };

  const handleSelectThread = async (threadId: string) => {
    setSelectedThreadId(threadId);
    const token = getAccessToken();
    if (!token || !profile) return;

    const existing = knownThreadsRef.current.get(threadId);

    if (existing && existing.unreadCount > 0) {
      try {
        await modifyThreadLabels(token, threadId, [], ['UNREAD']);
        const markRead = (list: ConversationThread[]) =>
          list.map((c) =>
            c.threadId === threadId
              ? {
                  ...c,
                  unreadCount: 0,
                  messages: c.messages.map((m) => ({ ...m, isRead: true }))
                }
              : c
          );
        setConversations(markRead);
        setFolderThreads((prev) => ({
          ...prev,
          [activeFolder]: prev[activeFolder] ? markRead(prev[activeFolder]!) : undefined
        }));
      } catch {
        // Ignore if offline or quota-limited
      }
    } else if (existing) {
      logGmailCacheHit('threads.modify(read_skip)');
    }

    const isFreshFull =
      existing?.hydratedLevel === 'full' &&
      existing.lastFullFetchedAt !== undefined &&
      Date.now() - existing.lastFullFetchedAt < FULL_THREAD_CACHE_TTL_MS;

    if (isFreshFull) {
      logGmailCacheHit(`threads.get(full)_${threadId}`);
      return;
    }

    if (getGmailQuotaCooldownSeconds() > 0) {
      return;
    }

    try {
      let inFlight = inFlightThreadFetchesRef.current.get(threadId);
      if (!inFlight) {
        inFlight = fetchSingleThread(token, profile.email, threadId, categoryOverrides).finally(
          () => {
            inFlightThreadFetchesRef.current.delete(threadId);
          }
        );
        inFlightThreadFetchesRef.current.set(threadId, inFlight);
      } else {
        logGmailCacheHit(`threads.get(full_dedup)_${threadId}`);
      }

      const fresh = await inFlight;
      if (fresh) {
        setConversations((prev) => mergeThreadLists(prev, [fresh]));
        setFolderThreads((prev) => {
          const current = prev[activeFolder];
          if (!current) return prev;
          return {
            ...prev,
            [activeFolder]: current.map((item) => (item.threadId === threadId ? fresh : item))
          };
        });
      }
    } catch (err) {
      if (err instanceof GmailApiError && err.kind === 'quota_exceeded') {
        setErrorState({ kind: err.kind, message: err.message });
      }
    }
  };

  const handleSetCategory = (threadId: string, category: ConversationCategory) => {
    const updatedOverrides = saveCategoryOverride(threadId, category);
    setCategoryOverrides(updatedOverrides);

    const applyUpdate = (list: ConversationThread[]) =>
      list.map((t) =>
        t.threadId === threadId
          ? {
              ...t,
              category,
              isAutomatedOrBulk: category === 'automated',
              isImportant: category === 'important' || t.isImportant
            }
          : t
      );

    setConversations(applyUpdate);
    setFolderThreads((prev) => {
      const next: Partial<Record<EmailFolder, ConversationThread[]>> = {};
      (Object.keys(prev) as EmailFolder[]).forEach((folder) => {
        const items = prev[folder];
        if (items) next[folder] = applyUpdate(items);
      });
      return next;
    });
  };

  const handleToggleStar = (thread: ConversationThread) => {
    const token = getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    const nextStarred = !thread.isStarred;
    setPendingConfirmation({
      title: nextStarred ? 'Star conversation?' : 'Remove star from conversation?',
      description: `Update Gmail labels for "${thread.subject}" with ${thread.contactName}.`,
      details: [
        `Thread: ${thread.subject}`,
        `Action: ${nextStarred ? 'Add STARRED label' : 'Remove STARRED label'}`
      ],
      confirmLabel: nextStarred ? 'Star Thread' : 'Remove Star',
      onConfirm: async () => {
        await modifyThreadLabels(
          token,
          thread.threadId,
          nextStarred ? ['STARRED'] : [],
          nextStarred ? [] : ['STARRED']
        );
        setConversations((prev) =>
          prev.map((c) =>
            c.threadId === thread.threadId ? { ...c, isStarred: nextStarred } : c
          )
        );
      }
    });
  };

  const handleToggleArchive = (thread: ConversationThread) => {
    const token = getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    const nextArchived = !thread.isArchived;
    setPendingConfirmation({
      title: nextArchived ? 'Archive conversation?' : 'Move conversation back to Inbox?',
      description: nextArchived
        ? 'Archiving removes the INBOX label in Gmail while keeping all messages searchable.'
        : 'Restoring adds the INBOX label back to this Gmail thread.',
      details: [`Thread: ${thread.subject}`, `Contact: ${thread.contactEmail}`],
      confirmLabel: nextArchived ? 'Archive' : 'Move to Inbox',
      onConfirm: async () => {
        await modifyThreadLabels(
          token,
          thread.threadId,
          nextArchived ? [] : ['INBOX'],
          nextArchived ? ['INBOX'] : []
        );
        setConversations((prev) =>
          prev.map((c) =>
            c.threadId === thread.threadId ? { ...c, isArchived: nextArchived } : c
          )
        );
      }
    });
  };

  const handleSendReply = (params: {
    thread: ConversationThread;
    replyAll: boolean;
    bodyText: string;
    attachments: OutgoingAttachmentFile[];
    onSuccess: () => void;
  }) => {
    const token = getAccessToken();
    if (!token || !profile) {
      setNeedsAuth(true);
      return;
    }

    const latest = params.thread.messages[params.thread.messages.length - 1];
    const recipients = new Set<string>();
    if (latest.senderEmail.toLowerCase() !== profile.email.toLowerCase()) {
      recipients.add(latest.senderEmail);
    }
    if (params.replyAll || recipients.size === 0) {
      latest.toEmails
        .filter((e) => e.toLowerCase() !== profile.email.toLowerCase())
        .forEach((e) => recipients.add(e));
    }
    const toList = Array.from(recipients);
    if (toList.length === 0 && latest.senderEmail) {
      toList.push(latest.senderEmail);
    }

    const ccList = params.replyAll
      ? latest.ccEmails.filter((e) => e.toLowerCase() !== profile.email.toLowerCase())
      : [];

    const replySubject = latest.subject.toLowerCase().startsWith('re:')
      ? latest.subject
      : `Re: ${latest.subject}`;

    setPendingConfirmation({
      title: params.replyAll ? 'Send Reply All via Gmail?' : 'Send Reply via Gmail?',
      description: 'Confirm sending this email reply directly through your Gmail account.',
      details: [
        `To: ${toList.join(', ')}`,
        ...(ccList.length > 0 ? [`Cc: ${ccList.join(', ')}`] : []),
        `Subject: ${replySubject}`,
        ...(params.attachments.length > 0
          ? [`Attachments: ${params.attachments.map((a) => a.fileName).join(', ')}`]
          : [])
      ],
      confirmLabel: 'Send Email',
      onConfirm: async () => {
        const dedupeKey = `reply:${params.thread.threadId}:${params.bodyText}`;
        if (sendLockRef.current.has(dedupeKey)) return;
        sendLockRef.current.add(dedupeKey);
        setIsSending(true);
        setSendError(null);
        try {
          const references = [latest.referencesHeader, latest.rfcMessageIdHeader]
            .filter(Boolean)
            .join(' ')
            .trim();

          await sendGmailMimeMessage(token, {
            fromEmail: profile.email,
            toEmails: toList,
            ccEmails: ccList,
            subject: replySubject,
            bodyText: params.bodyText,
            threadId: params.thread.threadId,
            inReplyTo: latest.rfcMessageIdHeader,
            references: references || null,
            attachments: params.attachments
          });

          const fresh = await fetchSingleThread(
            token,
            profile.email,
            params.thread.threadId,
            categoryOverrides
          );
          if (fresh) {
            setConversations((prev) => mergeThreadLists(prev, [fresh]));
          }
          params.onSuccess();
        } catch (err) {
          setSendError(err instanceof Error ? err.message : 'Failed to deliver reply.');
        } finally {
          sendLockRef.current.delete(dedupeKey);
          setIsSending(false);
        }
      }
    });
  };

  const handleSendNewConversation = (params: {
    toEmails: string[];
    subject: string;
    bodyText: string;
    attachments: OutgoingAttachmentFile[];
    onSuccess: () => void;
  }) => {
    const token = getAccessToken();
    if (!token || !profile) {
      setNeedsAuth(true);
      return;
    }

    setPendingConfirmation({
      title: 'Send New Email via Gmail?',
      description: 'Confirm sending this new conversation directly through your Gmail account.',
      details: [
        `To: ${params.toEmails.join(', ')}`,
        `Subject: ${params.subject}`,
        ...(params.attachments.length > 0
          ? [`Attachments: ${params.attachments.map((a) => a.fileName).join(', ')}`]
          : [])
      ],
      confirmLabel: 'Send Email',
      onConfirm: async () => {
        const dedupeKey = `new:${params.toEmails.join(',')}:${params.subject}:${params.bodyText}`;
        if (sendLockRef.current.has(dedupeKey)) return;
        sendLockRef.current.add(dedupeKey);
        setIsSending(true);
        setSendError(null);
        try {
          const sent = await sendGmailMimeMessage(token, {
            fromEmail: profile.email,
            toEmails: params.toEmails,
            subject: params.subject,
            bodyText: params.bodyText,
            attachments: params.attachments
          });

          const fresh = await fetchSingleThread(
            token,
            profile.email,
            sent.threadId,
            categoryOverrides
          );
          if (fresh) {
            setConversations((prev) => mergeThreadLists(prev, [fresh]));
            setActiveDestination('conversations');
            setSelectedThreadId(fresh.threadId);
          }
          params.onSuccess();
        } catch (err) {
          setSendError(err instanceof Error ? err.message : 'Failed to send email.');
        } finally {
          sendLockRef.current.delete(dedupeKey);
          setIsSending(false);
        }
      }
    });
  };

  const handleDownloadAttachment = async (att: EmailAttachment): Promise<string | null> => {
    const token = getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return null;
    }
    try {
      const { dataUrl } = await downloadGmailAttachment(token, att);
      return dataUrl;
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Attachment download failed.');
      return null;
    }
  };

  const handleUpdatePreferences = (next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  };

  const handleClearSessionCache = () => {
    setPendingConfirmation({
      title: 'Clear active session cache?',
      description:
        'Clears in-memory conversation data from this browser session without modifying Gmail.',
      details: ['Zero emails are stored in any database.'],
      confirmLabel: 'Clear Session',
      destructive: true,
      onConfirm: () => {
        setConversations([]);
        setFolderThreads({});
        setSelectedThreadId(null);
        folderLoadedAtRef.current = {};
        lastSyncCompletedAtRef.current = 0;
        clearGmailQuotaCooldown();
      }
    });
  };

  const handleDisconnectGmail = () => {
    setPendingConfirmation({
      title: 'Disconnect Gmail account?',
      description:
        'Your OAuth access token will be revoked and removed from memory, and your active session will be cleared.',
      details: profile ? [`Account: ${profile.email}`] : [],
      confirmLabel: 'Disconnect & Logout',
      destructive: true,
      onConfirm: async () => {
        await disconnectGoogleAccount();
        setProfile(null);
        setConversations([]);
        setFolderThreads({});
        setDriveFiles([]);
        setDriveConnected(false);
        setSelectedThreadId(null);
        setNeedsAuth(true);
        setActiveDestination('conversations');
        folderLoadedAtRef.current = {};
        lastSyncCompletedAtRef.current = 0;
        clearGmailQuotaCooldown();
      }
    });
  };

  // Smart Conversations view: excludes newsletters/bulk/archived unless manually categorized otherwise
  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      if (c.isArchived || c.isAutomatedOrBulk || c.category === 'automated') return false;
      if (activeFilter === 'unread' && c.unreadCount === 0) return false;
      if (activeFilter === 'important' && !c.isImportant && c.category !== 'important') {
        return false;
      }
      if (activeFilter === 'work' && c.category !== 'work') return false;
      if (activeFilter === 'personal' && c.category !== 'personal') return false;

      if (!q) return true;
      return (
        c.contactName.toLowerCase().includes(q) ||
        c.contactEmail.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q)
      );
    });
  }, [activeFilter, conversations, searchQuery]);

  const filteredFolderThreads = useMemo(() => {
    const items = folderThreads[activeFolder] ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.contactName.toLowerCase().includes(q) ||
        c.contactEmail.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q)
    );
  }, [activeFolder, folderThreads, searchQuery]);

  const selectedThread = useMemo(() => {
    if (!selectedThreadId) return null;
    const fromConv = conversations.find((c) => c.threadId === selectedThreadId);
    if (fromConv) return fromConv;
    for (const folder of Object.keys(folderThreads) as EmailFolder[]) {
      const found = folderThreads[folder]?.find((c) => c.threadId === selectedThreadId);
      if (found) return found;
    }
    return null;
  }, [conversations, folderThreads, selectedThreadId]);

  const navItems: Array<{ id: NavDestination; label: string; icon: typeof MessageSquare }> = [
    { id: 'conversations', label: 'Conversations', icon: MessageSquare },
    { id: 'folders', label: 'Email Folder', icon: FolderOpen },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'android', label: 'Android Project', icon: Code2 }
  ];

  const isSplitPaneView = activeDestination === 'conversations' || activeDestination === 'folders';

  return (
    <div className="min-h-screen flex flex-col bg-[var(--v-bg)] text-[var(--v-text)]">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 bg-[var(--v-surface)] border-b border-[var(--v-border)] flex items-center justify-between gap-6">
        <button
          type="button"
          onClick={() => setActiveDestination('conversations')}
          className="flex items-center gap-2.5 whitespace-nowrap shrink-0 text-left"
        >
          <BrandMark size="sm" />
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-lg font-bold tracking-tight text-[var(--v-text)]">
              Vartalap
            </span>
            {!needsAuth && (
              <span className="hidden sm:inline text-xs font-medium text-[var(--v-secondary)]">
                {isOnline ? 'Connected to Gmail' : 'Offline session'}
              </span>
            )}
          </div>
        </button>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          {navItems.map((item) => {
            const active = activeDestination === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveDestination(item.id);
                  if (item.id === 'conversations' || item.id === 'folders') {
                    setSelectedThreadId(null);
                  }
                }}
                className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                  active
                    ? 'border-[var(--v-secondary)] text-[var(--v-secondary)] font-semibold'
                    : 'border-transparent text-[var(--v-muted)] hover:text-[var(--v-text)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          {needsAuth ? (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[var(--v-primary)] hover:opacity-95 text-white text-xs font-semibold transition-opacity whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {isSigningIn ? 'Connecting...' : 'Continue with Google'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsComposeOpen(true)}
                className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[var(--v-primary)] hover:opacity-95 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-opacity whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>New Message</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveDestination('settings')}
                aria-label="Account profile and settings"
                className="w-9 h-9 rounded-full overflow-hidden bg-[var(--v-chip)] text-[var(--v-text)] flex items-center justify-center text-xs font-bold shrink-0 border border-[var(--v-border)]"
              >
                {profile?.photoUrl ? (
                  <img
                    src={profile.photoUrl}
                    alt={profile.displayName}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (profile?.displayName ?? 'V').slice(0, 2).toUpperCase()
                )}
              </button>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col pb-16 md:pb-0">
        {activeDestination === 'android' ? (
          <AndroidStudioView />
        ) : needsAuth ? (
          <WelcomeView
            onSignIn={handleGoogleSignIn}
            onOpenAndroidStudio={() => setActiveDestination('android')}
            isSigningIn={isSigningIn}
            authError={authError}
          />
        ) : activeDestination === 'settings' ? (
          <SettingsView
            profile={profile}
            preferences={preferences}
            sessionMemoryBytes={sessionMemoryBytes}
            lastSyncedAt={lastSyncedAt}
            driveFiles={driveFiles}
            isDriveConnected={driveConnected}
            isLoadingDrive={isLoadingDrive}
            onEnableDrive={handleEnableDrive}
            onDisableDrive={handleDisableDrive}
            onRefreshDriveFiles={handleRefreshDriveFiles}
            onUpdatePreferences={handleUpdatePreferences}
            onManualSync={handleDebouncedRefresh}
            onClearSessionCache={handleClearSessionCache}
            onDisconnect={handleDisconnectGmail}
            isSyncing={isSyncing}
          />
        ) : isSplitPaneView ? (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 h-[calc(100vh-3.5rem)] overflow-hidden">
            <div
              className={`lg:col-span-4 xl:col-span-4 h-full overflow-hidden ${
                selectedThread ? 'hidden lg:block' : 'block'
              }`}
            >
              {activeDestination === 'conversations' ? (
                <ConversationList
                  conversations={filteredConversations}
                  selectedThreadId={selectedThreadId}
                  activeFilter={activeFilter}
                  onFilterChange={setActiveFilter}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onSelectThread={handleSelectThread}
                  onRefresh={handleDebouncedRefresh}
                  onLoadMore={handleLoadMore}
                  hasMorePages={Boolean(nextPageToken)}
                  isSyncing={isSyncing}
                  isLoadingMore={isLoadingMore}
                  isOnline={isOnline}
                  errorState={errorState}
                  onReauth={handleGoogleSignIn}
                  onComposeNew={() => setIsComposeOpen(true)}
                />
              ) : (
                <EmailFolderView
                  activeFolder={activeFolder}
                  onSelectFolder={(folder) => {
                    setActiveFolder(folder);
                    if (!folderThreads[folder]) {
                      loadFolder(folder, false);
                    }
                  }}
                  threads={filteredFolderThreads}
                  selectedThreadId={selectedThreadId}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onSelectThread={handleSelectThread}
                  onRefreshFolder={() => loadFolder(activeFolder, false)}
                  onLoadMoreFolder={() => loadFolder(activeFolder, true)}
                  hasMorePages={Boolean(folderNextPages[activeFolder])}
                  isLoading={isFolderLoading}
                />
              )}
            </div>

            <div
              className={`lg:col-span-8 xl:col-span-8 h-full overflow-hidden ${
                selectedThread ? 'block' : 'hidden lg:block'
              }`}
            >
              <ChatThreadView
                thread={selectedThread}
                driveEnabled={driveConnected && preferences.driveFeatureEnabled}
                onBack={() => setSelectedThreadId(null)}
                onToggleStar={handleToggleStar}
                onToggleArchive={handleToggleArchive}
                onSetCategory={handleSetCategory}
                onSendReply={handleSendReply}
                onDownloadAttachment={handleDownloadAttachment}
                onSaveAttachmentToDrive={handleSaveAttachmentToDrive}
                isSending={isSending}
                sendError={sendError}
                onClearSendError={() => setSendError(null)}
              />
            </div>
          </div>
        ) : null}
      </main>

      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-14 bg-[var(--v-surface)]/95 backdrop-blur-md border-t border-[var(--v-border)] grid grid-cols-4"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeDestination === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveDestination(item.id);
                if (item.id === 'conversations' || item.id === 'folders') {
                  setSelectedThreadId(null);
                }
              }}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active ? 'text-[var(--v-secondary)] font-semibold' : 'text-[var(--v-muted)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-full px-1">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <NewConversationModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        onSubmit={handleSendNewConversation}
        isSending={isSending}
      />

      <ConfirmationModal
        confirmation={pendingConfirmation}
        onClose={() => setPendingConfirmation(null)}
      />
    </div>
  );
}
