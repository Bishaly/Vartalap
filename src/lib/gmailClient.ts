import DOMPurify from 'dompurify';
import type {
  ChatMessage,
  ConversationCategory,
  ConversationThread,
  EmailAttachment,
  EmailFolder,
  GmailAccountProfile,
  GmailErrorKind,
  OutgoingAttachmentFile
} from '../types';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DEFAULT_PAGE_SIZE = 15;
const MAX_THREAD_CONCURRENCY = 3;
const MAX_HISTORY_PAGES = 3;
const MAX_RETRY_ATTEMPTS = 2;

const METADATA_HEADERS = [
  'From',
  'To',
  'Cc',
  'Subject',
  'Message-ID',
  'In-Reply-To',
  'References',
  'List-Unsubscribe',
  'Precedence',
  'Auto-Submitted'
];

let gmailCooldownUntilMillis = 0;
const endpointCallCounts: Record<string, number> = {};
let cacheHitCount = 0;

export function getGmailQuotaCooldownSeconds(now = Date.now()): number {
  const remaining = gmailCooldownUntilMillis - now;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function clearGmailQuotaCooldown(): void {
  gmailCooldownUntilMillis = 0;
}

export function buildFriendlyQuotaMessage(retryAfterSeconds: number): string {
  const safeSeconds = Math.max(5, Math.min(300, Math.round(retryAfterSeconds)));
  return `Gmail API quota is temporarily exceeded. Please wait about ${safeSeconds}s before refreshing again.`;
}

export function logGmailCacheHit(operation: string): void {
  cacheHitCount += 1;
  console.debug(
    `[VartalapGmailQuota] CACHE_HIT operation=${operation} sessionCacheHits=${cacheHitCount}`
  );
}

function classifyEndpoint(path: string, method = 'GET'): string {
  const clean = path.split('?')[0];
  const query = path.split('?')[1] ?? '';
  if (clean === '/profile') return 'profile.get';
  if (clean === '/threads') return 'threads.list';
  if (clean.startsWith('/threads/') && clean.endsWith('/modify')) return 'threads.modify';
  if (clean.startsWith('/threads/')) {
    const format = query.includes('format=metadata') ? 'metadata' : 'full';
    return `threads.get(${format})`;
  }
  if (clean === '/history') return 'history.list';
  if (clean === '/messages/send' && method === 'POST') return 'messages.send';
  if (clean.includes('/attachments/')) return 'attachments.get';
  return `${method}:${clean}`;
}

function recordEndpointLog(endpointKey: string, status: number, durationMs: number): void {
  const nextCount = (endpointCallCounts[endpointKey] ?? 0) + 1;
  endpointCallCounts[endpointKey] = nextCount;
  const totalCalls = Object.values(endpointCallCounts).reduce((sum, n) => sum + n, 0);
  console.debug(
    `[VartalapGmailQuota] API_CALL endpoint=${endpointKey} status=${status} durationMs=${durationMs} endpointCalls=${nextCount} totalCalls=${totalCalls}`
  );
}

function parseRetryAfterSeconds(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.max(5, Math.min(300, Number(trimmed)));
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    const diffSec = Math.ceil((parsedDate - Date.now()) / 1000);
    return Math.max(5, Math.min(300, diffSec));
  }
  return null;
}

function isRateLimitBody(errBody: unknown): boolean {
  if (!errBody || typeof errBody !== 'object') return false;
  const record = errBody as {
    error?: { message?: string; errors?: Array<{ reason?: string }> };
  };
  const reasons = (record.error?.errors ?? []).map((e) => (e.reason ?? '').toLowerCase());
  if (
    reasons.some((r) =>
      [
        'ratelimitexceeded',
        'userratelimitexceeded',
        'quotaexceeded',
        'dailylimitexceeded'
      ].includes(r)
    )
  ) {
    return true;
  }
  const msg = (record.error?.message ?? '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('user-rate limit') ||
    msg.includes('total query cost')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class GmailApiError extends Error {
  readonly kind: GmailErrorKind;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    kind: GmailErrorKind,
    message: string,
    status = 0,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailBody {
  attachmentId?: string;
  size?: number;
  data?: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPart[];
}

interface GmailMessageRaw {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface GmailThreadRaw {
  id: string;
  historyId?: string;
  messages?: GmailMessageRaw[];
}

async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new GmailApiError('offline', 'No internet connection. Active session is offline.');
  }

  const remainingCooldown = getGmailQuotaCooldownSeconds();
  if (remainingCooldown > 0) {
    throw new GmailApiError(
      'quota_exceeded',
      buildFriendlyQuotaMessage(remainingCooldown),
      429,
      remainingCooldown
    );
  }

  const method = (init?.method ?? 'GET').toUpperCase();
  const endpointKey = classifyEndpoint(path, method);

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const startMs = performance.now();
    let res: Response;
    try {
      res = await fetch(`${GMAIL_API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {})
        }
      });
    } catch {
      throw new GmailApiError('offline', 'Network request failed. Check your connection.');
    }

    const durationMs = Math.round(performance.now() - startMs);
    recordEndpointLog(endpointKey, res.status, durationMs);

    if (res.status === 401) {
      throw new GmailApiError(
        'auth_expired',
        'Your Gmail session expired. Please sign in again to continue syncing.',
        401
      );
    }

    if (res.ok) {
      return res.json() as Promise<T>;
    }

    let errBody: { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null =
      null;
    try {
      errBody = await res.json();
    } catch {
      errBody = null;
    }

    const isQuotaOrTransient =
      res.status === 429 ||
      res.status === 503 ||
      (res.status === 403 && isRateLimitBody(errBody));

    if (isQuotaOrTransient) {
      const retryAfterSec = parseRetryAfterSeconds(res.headers.get('Retry-After'));

      // If Retry-After asks us to wait longer than 12s or retries are exhausted, enter shared cooldown immediately
      if ((retryAfterSec !== null && retryAfterSec > 12) || attempt >= MAX_RETRY_ATTEMPTS) {
        const cooldownSeconds = retryAfterSec ?? 30;
        gmailCooldownUntilMillis = Date.now() + cooldownSeconds * 1000;
        throw new GmailApiError(
          'quota_exceeded',
          buildFriendlyQuotaMessage(cooldownSeconds),
          res.status,
          cooldownSeconds
        );
      }

      const exponentialMs = 1000 * Math.pow(2, attempt);
      const jitterMs = Math.floor(Math.random() * 500);
      const waitMs = Math.min(12_000, Math.max((retryAfterSec ?? 0) * 1000, exponentialMs + jitterMs));
      await sleep(waitMs);
      continue;
    }

    const detail = errBody?.error?.message ?? `Gmail API error (${res.status})`;
    throw new GmailApiError('sync_failed', detail, res.status);
  }

  const fallbackCooldown = Math.max(30, getGmailQuotaCooldownSeconds());
  gmailCooldownUntilMillis = Date.now() + fallbackCooldown * 1000;
  throw new GmailApiError(
    'quota_exceeded',
    buildFriendlyQuotaMessage(fallbackCooldown),
    429,
    fallbackCooldown
  );
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current]);
    }
  });

  await Promise.all(runners);
  return results;
}

export function decodeBase64UrlToUint8(data?: string): Uint8Array {
  if (!data) return new Uint8Array(0);
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decodeBase64UrlText(data?: string): string {
  const bytes = decodeBase64UrlToUint8(data);
  if (bytes.length === 0) return '';
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function encodeUint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseAddressList(raw?: string): Array<{ name: string; email: string }> {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const start = entry.lastIndexOf('<');
      const end = entry.lastIndexOf('>');
      if (start !== -1 && end > start) {
        const email = entry.slice(start + 1, end).trim();
        const name = entry
          .slice(0, start)
          .trim()
          .replace(/^"|"$/g, '');
        return { name: name || email.split('@')[0], email };
      }
      const email = entry.replace(/^"|"$/g, '');
      return { name: email.split('@')[0], email };
    });
}

function splitQuotedContent(plain: string): { main: string; quoted: string | null } {
  const lines = plain.split(/\r?\n/);
  const splitIdx = lines.findIndex((line) => {
    const t = line.trim();
    return (
      (t.startsWith('On ') && t.endsWith('wrote:')) ||
      t === '-----Original Message-----' ||
      t.startsWith('> ')
    );
  });
  if (splitIdx <= 0) {
    return { main: plain.trim(), quoted: null };
  }
  const main = lines.slice(0, splitIdx).join('\n').trim();
  const quoted = lines.slice(splitIdx).join('\n').trim();
  return {
    main: main || plain.trim(),
    quoted: quoted || null
  };
}

export function sanitizeEmailHtml(rawHtml: string): string {
  return DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'style'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus'],
    ALLOW_DATA_ATTR: false
  });
}

function htmlToPlainText(rawHtml: string): string {
  const clean = sanitizeEmailHtml(rawHtml);
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+\n/g, '\n').trim();
}

function parseGmailMessage(raw: GmailMessageRaw, accountEmail: string): ChatMessage {
  const headers = raw.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

  const fromParsed = parseAddressList(getHeader('From'))[0] ?? {
    name: 'Unknown',
    email: ''
  };
  const toEmails = parseAddressList(getHeader('To')).map((a) => a.email);
  const ccEmails = parseAddressList(getHeader('Cc')).map((a) => a.email);
  const subject = getHeader('Subject')?.trim() || '(No subject)';
  const rfcMessageIdHeader = getHeader('Message-ID') ?? getHeader('Message-Id') ?? null;
  const inReplyToHeader = getHeader('In-Reply-To') ?? null;
  const referencesHeader = getHeader('References') ?? null;

  const listUnsubscribe = getHeader('List-Unsubscribe');
  const precedence = (getHeader('Precedence') ?? '').toLowerCase();
  const autoSubmitted = (getHeader('Auto-Submitted') ?? '').toLowerCase();
  const senderLower = fromParsed.email.toLowerCase();
  const labels = raw.labelIds ?? [];

  const isAutomatedHeader =
    Boolean(listUnsubscribe) ||
    precedence === 'bulk' ||
    precedence === 'list' ||
    precedence === 'junk' ||
    (Boolean(autoSubmitted) && autoSubmitted !== 'no') ||
    senderLower.includes('noreply') ||
    senderLower.includes('no-reply') ||
    senderLower.includes('notifications@') ||
    senderLower.includes('mailer-daemon') ||
    labels.includes('CATEGORY_PROMOTIONS') ||
    labels.includes('CATEGORY_UPDATES') ||
    labels.includes('CATEGORY_FORUMS') ||
    labels.includes('CATEGORY_SOCIAL');

  const timestampMillis = raw.internalDate ? Number(raw.internalDate) : Date.now();
  const isOutgoing =
    labels.includes('SENT') ||
    fromParsed.email.toLowerCase() === accountEmail.toLowerCase();
  const isRead = !labels.includes('UNREAD');

  const plainParts: string[] = [];
  const htmlParts: string[] = [];
  const attachments: EmailAttachment[] = [];

  const walk = (part?: GmailPart) => {
    if (!part) return;
    const mime = (part.mimeType ?? '').toLowerCase();
    const filename = part.filename?.trim() ?? '';
    const attachmentId = part.body?.attachmentId;

    if (filename && attachmentId) {
      attachments.push({
        id: `${raw.id}_${attachmentId}`,
        messageId: raw.id,
        gmailAttachmentId: attachmentId,
        fileName: filename,
        mimeType: mime || 'application/octet-stream',
        sizeBytes: part.body?.size ?? 0
      });
    } else if (mime === 'text/plain' && part.body?.data) {
      plainParts.push(decodeBase64UrlText(part.body.data));
    } else if (mime === 'text/html' && part.body?.data) {
      htmlParts.push(decodeBase64UrlText(part.body.data));
    }

    part.parts?.forEach(walk);
  };

  walk(raw.payload);

  const combinedHtml = htmlParts.join('\n').trim();
  const sanitizedHtml = combinedHtml ? sanitizeEmailHtml(combinedHtml) : null;
  const rawPlain =
    plainParts.join('\n').trim() ||
    (combinedHtml ? htmlToPlainText(combinedHtml) : raw.snippet ?? '');

  const { main, quoted } = splitQuotedContent(rawPlain);

  return {
    messageId: raw.id,
    threadId: raw.threadId,
    senderName: fromParsed.name,
    senderEmail: fromParsed.email,
    toEmails,
    ccEmails,
    subject,
    bodyPlain: main || raw.snippet || '(Empty message)',
    bodyHtmlSanitized: sanitizedHtml,
    quotedText: quoted,
    timestampMillis,
    direction: isOutgoing ? 'outgoing' : 'incoming',
    sendStatus: 'sent',
    isRead,
    labelIds: labels,
    rfcMessageIdHeader,
    inReplyToHeader,
    referencesHeader,
    isAutomatedHeader,
    attachments
  };
}

function inferConversationCategory(
  isAutomatedOrBulk: boolean,
  isImportant: boolean,
  contactEmail: string,
  subject: string
): ConversationCategory {
  if (isAutomatedOrBulk) return 'automated';
  if (isImportant) return 'important';
  const domain = contactEmail.split('@')[1]?.toLowerCase() ?? '';
  const publicDomains = new Set([
    'gmail.com',
    'yahoo.com',
    'outlook.com',
    'hotmail.com',
    'icloud.com',
    'proton.me',
    'protonmail.com'
  ]);
  const workHints = ['invoice', 'project', 'meeting', 'review', 'contract', 'sprint', 'proposal'];
  if (
    (domain && !publicDomains.has(domain)) ||
    workHints.some((hint) => subject.toLowerCase().includes(hint))
  ) {
    return 'work';
  }
  return 'personal';
}

function buildConversationFromThread(
  rawThread: GmailThreadRaw,
  accountEmail: string,
  categoryOverrides: Record<string, ConversationCategory> = {},
  hydratedLevel: 'metadata' | 'full' = 'full',
  existingThread?: ConversationThread
): ConversationThread | null {
  const rawMessages = rawThread.messages ?? [];
  if (rawMessages.length === 0) return null;

  const parsedMessages = rawMessages
    .map((m) => parseGmailMessage(m, accountEmail))
    .sort((a, b) => a.timestampMillis - b.timestampMillis);

  // Preserve full message bodies already hydrated in session when metadata refresh arrives
  const existingMsgMap = new Map(
    (existingThread?.messages ?? []).map((m) => [m.messageId, m])
  );
  const messages = parsedMessages.map((msg) => {
    if (hydratedLevel === 'metadata') {
      const prev = existingMsgMap.get(msg.messageId);
      if (prev && (prev.bodyHtmlSanitized || prev.attachments.length > 0)) {
        return {
          ...prev,
          isRead: msg.isRead,
          labelIds: msg.labelIds
        };
      }
    }
    return msg;
  });

  const lastMessage = messages[messages.length - 1];
  const primaryContactMsg =
    [...messages].reverse().find((m) => m.direction === 'incoming') ?? lastMessage;

  let contactName = primaryContactMsg.senderName;
  let contactEmail = primaryContactMsg.senderEmail;
  if (contactEmail.toLowerCase() === accountEmail.toLowerCase()) {
    const firstTo = primaryContactMsg.toEmails[0] ?? 'Recipient';
    contactEmail = firstTo;
    contactName = firstTo.split('@')[0];
  }

  const allLabels = Array.from(new Set(rawMessages.flatMap((m) => m.labelIds ?? [])));
  const isStarred = allLabels.includes('STARRED');
  const isArchived =
    !allLabels.includes('INBOX') &&
    !allLabels.includes('SENT') &&
    !allLabels.includes('SPAM') &&
    !allLabels.includes('TRASH');
  const isImportant = allLabels.includes('IMPORTANT') || isStarred;
  const unreadCount = messages.filter((m) => !m.isRead).length;
  const hasAttachments =
    messages.some((m) => m.attachments.length > 0) ||
    (hydratedLevel === 'metadata' && Boolean(existingThread?.hasAttachments));
  const isAutomatedOrBulk =
    messages.some((m) => m.isAutomatedHeader) ||
    allLabels.includes('SPAM') ||
    allLabels.includes('TRASH');

  const override = categoryOverrides[rawThread.id];
  const category =
    override ??
    inferConversationCategory(isAutomatedOrBulk, isImportant, contactEmail, lastMessage.subject);

  const participantSet = Array.from(
    new Set(
      messages
        .flatMap((m) => [m.senderEmail, ...m.toEmails])
        .filter((e) => e && e.toLowerCase() !== accountEmail.toLowerCase())
    )
  );
  const participantsSummary =
    participantSet.length > 1
      ? `${contactName} + ${participantSet.length - 1} others`
      : contactEmail;

  const preservedLevel =
    hydratedLevel === 'full' ||
    (existingThread?.hydratedLevel === 'full' &&
      existingThread.messages.length === messages.length)
      ? 'full'
      : 'metadata';

  return {
    threadId: rawThread.id,
    contactName,
    contactEmail,
    participantsSummary,
    subject: lastMessage.subject,
    lastMessagePreview: lastMessage.bodyPlain.replace(/\s+/g, ' ').slice(0, 140),
    lastMessageTimestamp: lastMessage.timestampMillis,
    unreadCount,
    hasAttachments,
    isStarred,
    isArchived,
    isImportant,
    isAutomatedOrBulk: override ? override === 'automated' : isAutomatedOrBulk,
    category,
    folderLabels: allLabels,
    messageCount: messages.length,
    messages,
    historyId: rawThread.historyId ?? rawMessages[rawMessages.length - 1]?.historyId ?? null,
    hydratedLevel: preservedLevel,
    lastFullFetchedAt:
      hydratedLevel === 'full' ? Date.now() : existingThread?.lastFullFetchedAt
  };
}

function buildThreadMetadataQuery(): string {
  const params = new URLSearchParams();
  params.set('format', 'metadata');
  METADATA_HEADERS.forEach((header) => params.append('metadataHeaders', header));
  return params.toString();
}

export async function fetchGmailProfile(
  accessToken: string,
  displayNameFallback: string,
  photoUrl: string | null
): Promise<GmailAccountProfile> {
  const data = await gmailFetch<{
    emailAddress: string;
    messagesTotal?: number;
    threadsTotal?: number;
    historyId?: string;
  }>(accessToken, '/profile');

  return {
    email: data.emailAddress,
    displayName: displayNameFallback || data.emailAddress.split('@')[0],
    photoUrl,
    messagesTotal: data.messagesTotal ?? 0,
    threadsTotal: data.threadsTotal ?? 0,
    historyId: data.historyId ?? null
  };
}

export async function fetchThreadsPage(
  accessToken: string,
  accountEmail: string,
  options: {
    pageToken?: string | null;
    q?: string;
    labelIds?: string[];
    maxResults?: number;
    categoryOverrides?: Record<string, ConversationCategory>;
    knownThreads?: Map<string, ConversationThread>;
    forceRefresh?: boolean;
  } = {}
): Promise<{
  conversations: ConversationThread[];
  nextPageToken: string | null;
  latestHistoryId: string | null;
}> {
  const params = new URLSearchParams();
  params.set('maxResults', String(options.maxResults ?? DEFAULT_PAGE_SIZE));
  if (options.pageToken) params.set('pageToken', options.pageToken);
  if (options.q?.trim()) params.set('q', options.q.trim());
  options.labelIds?.forEach((id) => params.append('labelIds', id));

  const list = await gmailFetch<{
    threads?: Array<{ id: string; historyId?: string }>;
    nextPageToken?: string;
  }>(accessToken, `/threads?${params.toString()}`);

  const summaries = list.threads ?? [];
  const metadataQuery = buildThreadMetadataQuery();

  const hydrated = await runWithConcurrency(
    summaries,
    MAX_THREAD_CONCURRENCY,
    async (item) => {
      const cached = options.knownThreads?.get(item.id);
      if (
        !options.forceRefresh &&
        cached &&
        item.historyId &&
        cached.historyId === item.historyId
      ) {
        logGmailCacheHit(`threads.get(metadata)_${item.id}`);
        return cached;
      }

      const rawThread = await gmailFetch<GmailThreadRaw>(
        accessToken,
        `/threads/${encodeURIComponent(item.id)}?${metadataQuery}`
      );
      return buildConversationFromThread(
        rawThread,
        accountEmail,
        options.categoryOverrides,
        'metadata',
        cached
      );
    }
  );

  const conversations = hydrated.filter((c): c is ConversationThread => c !== null);
  const latestHistoryId =
    summaries[0]?.historyId ?? conversations[0]?.historyId ?? null;

  return {
    conversations,
    nextPageToken: list.nextPageToken ?? null,
    latestHistoryId
  };
}

export async function fetchFolderThreadsPage(
  accessToken: string,
  accountEmail: string,
  folder: EmailFolder,
  options: {
    pageToken?: string | null;
    maxResults?: number;
    categoryOverrides?: Record<string, ConversationCategory>;
    knownThreads?: Map<string, ConversationThread>;
    forceRefresh?: boolean;
  } = {}
): Promise<{ conversations: ConversationThread[]; nextPageToken: string | null }> {
  if (folder === 'ARCHIVE') {
    const res = await fetchThreadsPage(accessToken, accountEmail, {
      pageToken: options.pageToken,
      q: '-in:inbox -in:trash -in:spam -in:draft',
      maxResults: options.maxResults ?? DEFAULT_PAGE_SIZE,
      categoryOverrides: options.categoryOverrides,
      knownThreads: options.knownThreads,
      forceRefresh: options.forceRefresh
    });
    return { conversations: res.conversations, nextPageToken: res.nextPageToken };
  }

  const res = await fetchThreadsPage(accessToken, accountEmail, {
    pageToken: options.pageToken,
    labelIds: [folder],
    maxResults: options.maxResults ?? DEFAULT_PAGE_SIZE,
    categoryOverrides: options.categoryOverrides,
    knownThreads: options.knownThreads,
    forceRefresh: options.forceRefresh
  });
  return { conversations: res.conversations, nextPageToken: res.nextPageToken };
}

export async function fetchSingleThread(
  accessToken: string,
  accountEmail: string,
  threadId: string,
  categoryOverrides: Record<string, ConversationCategory> = {}
): Promise<ConversationThread | null> {
  const rawThread = await gmailFetch<GmailThreadRaw>(
    accessToken,
    `/threads/${encodeURIComponent(threadId)}?format=full`
  );
  return buildConversationFromThread(rawThread, accountEmail, categoryOverrides, 'full');
}

export async function syncIncrementalHistory(
  accessToken: string,
  accountEmail: string,
  startHistoryId: string,
  categoryOverrides: Record<string, ConversationCategory> = {},
  knownThreads?: Map<string, ConversationThread>
): Promise<{
  updatedThreads: ConversationThread[];
  latestHistoryId: string;
  requiresFullSync: boolean;
}> {
  try {
    const touchedIds = new Set<string>();
    let latestHistoryId = startHistoryId;
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      const params = new URLSearchParams();
      params.set('startHistoryId', startHistoryId);
      params.set('maxResults', '100');
      params.append('historyTypes', 'messageAdded');
      params.append('historyTypes', 'labelAdded');
      params.append('historyTypes', 'labelRemoved');
      if (pageToken) params.set('pageToken', pageToken);

      const history = await gmailFetch<{
        history?: Array<{
          messagesAdded?: Array<{ message: { threadId: string } }>;
          labelsAdded?: Array<{ message: { threadId: string } }>;
          labelsRemoved?: Array<{ message: { threadId: string } }>;
        }>;
        historyId?: string;
        nextPageToken?: string;
      }>(accessToken, `/history?${params.toString()}`);

      (history.history ?? []).forEach((record) => {
        record.messagesAdded?.forEach((item) => touchedIds.add(item.message.threadId));
        record.labelsAdded?.forEach((item) => touchedIds.add(item.message.threadId));
        record.labelsRemoved?.forEach((item) => touchedIds.add(item.message.threadId));
      });
      if (history.historyId) {
        latestHistoryId = history.historyId;
      }
      pageToken = history.nextPageToken;
      pageCount += 1;
    } while (pageToken && pageCount < MAX_HISTORY_PAGES);

    if (touchedIds.size === 0) {
      logGmailCacheHit('history.no_changes');
      return {
        updatedThreads: [],
        latestHistoryId,
        requiresFullSync: false
      };
    }

    const metadataQuery = buildThreadMetadataQuery();
    const targetIds = Array.from(touchedIds).slice(0, DEFAULT_PAGE_SIZE);
    const updated = await runWithConcurrency(
      targetIds,
      MAX_THREAD_CONCURRENCY,
      async (id) => {
        const rawThread = await gmailFetch<GmailThreadRaw>(
          accessToken,
          `/threads/${encodeURIComponent(id)}?${metadataQuery}`
        );
        return buildConversationFromThread(
          rawThread,
          accountEmail,
          categoryOverrides,
          'metadata',
          knownThreads?.get(id)
        );
      }
    );

    return {
      updatedThreads: updated.filter((c): c is ConversationThread => c !== null),
      latestHistoryId,
      requiresFullSync: false
    };
  } catch (err) {
    if (err instanceof GmailApiError && err.status === 404) {
      return {
        updatedThreads: [],
        latestHistoryId: startHistoryId,
        requiresFullSync: true
      };
    }
    throw err;
  }
}

export async function downloadGmailAttachment(
  accessToken: string,
  attachment: EmailAttachment
): Promise<{ bytes: Uint8Array; dataUrl: string }> {
  try {
    const res = await gmailFetch<{ data?: string }>(
      accessToken,
      `/messages/${encodeURIComponent(attachment.messageId)}/attachments/${encodeURIComponent(
        attachment.gmailAttachmentId
      )}`
    );
    const bytes = decodeBase64UrlToUint8(res.data);
    const blob = new Blob([bytes as BlobPart], { type: attachment.mimeType });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Failed to read attachment blob'));
      reader.readAsDataURL(blob);
    });
    return { bytes, dataUrl };
  } catch (err) {
    if (err instanceof GmailApiError) throw err;
    throw new GmailApiError('attachment_failed', 'Could not download attachment from Gmail.');
  }
}

export async function modifyThreadLabels(
  accessToken: string,
  threadId: string,
  addLabelIds: string[],
  removeLabelIds: string[]
): Promise<void> {
  await gmailFetch(accessToken, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds, removeLabelIds })
  });
}

export async function sendGmailMimeMessage(
  accessToken: string,
  params: {
    fromEmail: string;
    toEmails: string[];
    ccEmails?: string[];
    subject: string;
    bodyText: string;
    threadId?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
    attachments?: OutgoingAttachmentFile[];
  }
): Promise<{ id: string; threadId: string }> {
  const lines: string[] = [
    `From: ${params.fromEmail}`,
    `To: ${params.toEmails.join(', ')}`
  ];
  if (params.ccEmails && params.ccEmails.length > 0) {
    lines.push(`Cc: ${params.ccEmails.join(', ')}`);
  }
  lines.push(`Subject: ${params.subject}`);
  lines.push('MIME-Version: 1.0');
  if (params.inReplyTo) {
    lines.push(`In-Reply-To: ${params.inReplyTo}`);
  }
  if (params.references) {
    lines.push(`References: ${params.references}`);
  }

  const attachments = params.attachments ?? [];
  if (attachments.length === 0) {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(params.bodyText);
  } else {
    const boundary = `vartalap_${crypto.randomUUID().replace(/-/g, '')}`;
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(params.bodyText);

    for (const file of attachments) {
      const safeName = file.fileName.replace(/"/g, '_');
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${file.mimeType || 'application/octet-stream'}; name="${safeName}"`);
      lines.push(`Content-Disposition: attachment; filename="${safeName}"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      const wrapped = file.base64Content.match(/.{1,76}/g)?.join('\r\n') ?? file.base64Content;
      lines.push(wrapped);
    }
    lines.push(`--${boundary}--`);
  }

  const rawText = lines.join('\r\n');
  const rawBytes = new TextEncoder().encode(rawText);
  const raw = encodeUint8ToBase64Url(rawBytes);

  try {
    return await gmailFetch<{ id: string; threadId: string }>(
      accessToken,
      '/messages/send',
      {
        method: 'POST',
        body: JSON.stringify({
          raw,
          ...(params.threadId ? { threadId: params.threadId } : {})
        })
      }
    );
  } catch (err) {
    if (err instanceof GmailApiError) {
      throw new GmailApiError('delivery_failed', err.message, err.status, err.retryAfterSeconds);
    }
    throw new GmailApiError('delivery_failed', 'Failed to deliver message via Gmail.');
  }
}
