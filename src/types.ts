export type NavDestination = 'conversations' | 'folders' | 'settings' | 'android';

export type ThemeMode = 'forest-mint' | 'soft-ivory' | 'midnight-jade';

export type ConversationFilter = 'all' | 'unread' | 'important' | 'work' | 'personal';

export type ConversationCategory = 'personal' | 'work' | 'important' | 'automated';

export type EmailFolder =
  | 'INBOX'
  | 'SENT'
  | 'DRAFT'
  | 'STARRED'
  | 'SPAM'
  | 'TRASH'
  | 'ARCHIVE';

export interface GmailAccountProfile {
  email: string;
  displayName: string;
  photoUrl: string | null;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string | null;
}

export interface EmailAttachment {
  id: string;
  messageId: string;
  gmailAttachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
}

export interface OutgoingAttachmentFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64Content: string;
}

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string | null;
  webViewLink: string | null;
}

export interface ChatMessage {
  messageId: string;
  threadId: string;
  senderName: string;
  senderEmail: string;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  bodyPlain: string;
  bodyHtmlSanitized: string | null;
  quotedText: string | null;
  timestampMillis: number;
  direction: 'incoming' | 'outgoing';
  sendStatus: 'sent' | 'sending' | 'failed';
  isRead: boolean;
  labelIds: string[];
  rfcMessageIdHeader: string | null;
  inReplyToHeader: string | null;
  referencesHeader: string | null;
  isAutomatedHeader: boolean;
  attachments: EmailAttachment[];
}

export interface ConversationThread {
  threadId: string;
  contactName: string;
  contactEmail: string;
  participantsSummary: string;
  subject: string;
  lastMessagePreview: string;
  lastMessageTimestamp: number;
  unreadCount: number;
  hasAttachments: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isImportant: boolean;
  isAutomatedOrBulk: boolean;
  category: ConversationCategory;
  folderLabels: string[];
  messageCount: number;
  messages: ChatMessage[];
  historyId?: string | null;
  hydratedLevel?: 'metadata' | 'full';
  lastFullFetchedAt?: number;
}

export interface AppPreferences {
  themeMode: ThemeMode;
  notificationsEnabled: boolean;
  syncIntervalMinutes: number;
  driveFeatureEnabled: boolean;
}

export type GmailErrorKind =
  | 'offline'
  | 'auth_expired'
  | 'quota_exceeded'
  | 'delivery_failed'
  | 'attachment_failed'
  | 'sync_failed';

export interface AppErrorState {
  kind: GmailErrorKind;
  message: string;
}

export interface PendingConfirmation {
  title: string;
  description: string;
  details: string[];
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}
