package com.nextgen.vartalap.domain

enum class ThemeMode(val label: String) {
    FOREST_MINT("Forest & Mint"),
    SOFT_IVORY("Soft Ivory"),
    MIDNIGHT_JADE("Midnight Jade")
}

enum class MessageDirection {
    INCOMING,
    OUTGOING
}

enum class MessageSendStatus {
    SENT,
    SENDING,
    FAILED
}

enum class ConversationFilter(val label: String) {
    ALL("All"),
    UNREAD("Unread"),
    IMPORTANT("Important"),
    WORK("Work"),
    PERSONAL("Personal")
}

enum class ConversationCategory(val label: String) {
    PERSONAL("Personal"),
    WORK("Work"),
    IMPORTANT("Important"),
    AUTOMATED("Automated / Bulk")
}

enum class EmailFolder(val label: String, val gmailLabelId: String?) {
    INBOX("Inbox", "INBOX"),
    SENT("Sent", "SENT"),
    DRAFTS("Drafts", "DRAFT"),
    STARRED("Starred", "STARRED"),
    SPAM("Spam", "SPAM"),
    TRASH("Trash", "TRASH"),
    ARCHIVE("Archive", null)
}

data class AccountProfile(
    val email: String,
    val displayName: String,
    val avatarUrl: String?,
    val messagesTotal: Long = 0L,
    val threadsTotal: Long = 0L
)

data class Attachment(
    val id: String,
    val messageId: String,
    val gmailAttachmentId: String?,
    val fileName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val tempLocalUri: String? = null
)

data class DriveFileItem(
    val id: String,
    val name: String,
    val mimeType: String,
    val sizeBytes: Long,
    val modifiedTime: String?,
    val webViewLink: String?
)

data class ChatMessage(
    val messageId: String,
    val threadId: String,
    val senderName: String,
    val senderEmail: String,
    val recipientEmails: List<String>,
    val ccEmails: List<String>,
    val subject: String,
    val bodyPlain: String,
    val bodyHtmlSanitized: String?,
    val quotedText: String?,
    val timestampMillis: Long,
    val direction: MessageDirection,
    val sendStatus: MessageSendStatus,
    val isRead: Boolean,
    val labelIds: List<String>,
    val rfcMessageIdHeader: String?,
    val inReplyToHeader: String?,
    val referencesHeader: String?,
    val isAutomatedHeader: Boolean,
    val attachments: List<Attachment>
)

data class Conversation(
    val threadId: String,
    val contactName: String,
    val contactEmail: String,
    val participantsSummary: String,
    val subject: String,
    val lastMessagePreview: String,
    val lastMessageTimestamp: Long,
    val unreadCount: Int,
    val hasAttachments: Boolean,
    val isStarred: Boolean,
    val isArchived: Boolean,
    val isImportant: Boolean,
    val isAutomatedOrBulk: Boolean,
    val category: ConversationCategory,
    val folderLabels: Set<String>,
    val messageCount: Int
)

data class AppSettings(
    val themeMode: ThemeMode = ThemeMode.FOREST_MINT,
    val notificationsEnabled: Boolean = true,
    val syncIntervalMinutes: Int = 15,
    val driveFeatureEnabled: Boolean = false,
    val lastSyncTimestamp: Long = 0L,
    val localCacheBytes: Long = 0L
)

data class SyncProgress(
    val isSyncing: Boolean = false,
    val lastSyncedAt: Long = 0L,
    val error: VartalapError? = null
)

sealed class VartalapError(val userMessage: String) {
    data object NoInternet : VartalapError("No internet connection. Active session is offline.")
    data object AuthExpired : VartalapError("Your Google authorization has expired. Please reconnect your Gmail account.")
    data class QuotaExceeded(val retryAfterSeconds: Long = 60L) : VartalapError(
        if (retryAfterSeconds > 0L) {
            "Gmail is temporarily busy due to API rate limits. Showing cached conversations — please wait ${retryAfterSeconds}s before syncing again."
        } else {
            "Gmail is temporarily busy due to API rate limits. Showing cached conversations — please wait a moment before syncing again."
        }
    )
    data class AuthFailed(val reason: String) : VartalapError("Google sign-in failed: $reason")
    data class SendFailed(val reason: String) : VartalapError("Email delivery failed: $reason")
    data class AttachmentFailed(val reason: String) : VartalapError("Attachment transfer failed: $reason")
    data class SyncFailed(val reason: String) : VartalapError("Synchronization failed: $reason")
}

data class OutgoingAttachment(
    val uriString: String,
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is OutgoingAttachment) return false
        return uriString == other.uriString && fileName == other.fileName && mimeType == other.mimeType
    }

    override fun hashCode(): Int {
        var result = uriString.hashCode()
        result = 31 * result + fileName.hashCode()
        result = 31 * result + mimeType.hashCode()
        return result
    }
}
