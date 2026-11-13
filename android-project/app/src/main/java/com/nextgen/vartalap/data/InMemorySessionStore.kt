package com.nextgen.vartalap.data

import com.nextgen.vartalap.domain.AccountProfile
import com.nextgen.vartalap.domain.ChatMessage
import com.nextgen.vartalap.domain.Conversation
import com.nextgen.vartalap.domain.ConversationCategory
import com.nextgen.vartalap.domain.ConversationFilter
import com.nextgen.vartalap.domain.EmailFolder
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import java.util.concurrent.ConcurrentHashMap

private data class ThreadCacheMetadata(
    val historyId: String?,
    val isFullHydrated: Boolean,
    val lastMetadataFetchedAtMillis: Long,
    val lastFullFetchedAtMillis: Long
)

class InMemorySessionStore {

    private val _account = MutableStateFlow<AccountProfile?>(null)
    val account: Flow<AccountProfile?> = _account

    private val _conversations = MutableStateFlow<Map<String, Conversation>>(emptyMap())
    private val _messagesByThread = MutableStateFlow<Map<String, List<ChatMessage>>>(emptyMap())
    private val _folderThreadIds = MutableStateFlow<Map<EmailFolder, List<String>>>(emptyMap())
    private val _folderNextPageTokens = MutableStateFlow<Map<EmailFolder, String?>>(emptyMap())
    private val _inboxNextPageToken = MutableStateFlow<String?>(null)

    private val threadCacheMeta = ConcurrentHashMap<String, ThreadCacheMetadata>()
    private val folderLoadedAtMillis = ConcurrentHashMap<EmailFolder, Long>()

    fun setAccount(profile: AccountProfile?) {
        _account.value = profile
    }

    fun getAccount(): AccountProfile? = _account.value

    fun getInboxNextPageToken(): String? = _inboxNextPageToken.value

    fun setInboxNextPageToken(token: String?) {
        _inboxNextPageToken.value = token
    }

    fun getFolderNextPageToken(folder: EmailFolder): String? = _folderNextPageTokens.value[folder]

    fun setFolderNextPageToken(folder: EmailFolder, token: String?) {
        _folderNextPageTokens.value = _folderNextPageTokens.value.toMutableMap().apply {
            put(folder, token)
        }
    }

    fun isFolderLoaded(folder: EmailFolder): Boolean = folderLoadedAtMillis.containsKey(folder)

    fun getFolderLoadedAt(folder: EmailFolder): Long = folderLoadedAtMillis[folder] ?: 0L

    fun markFolderLoaded(folder: EmailFolder, timestampMillis: Long = System.currentTimeMillis()) {
        folderLoadedAtMillis[folder] = timestampMillis
    }

    fun shouldFetchThreadForList(
        threadId: String,
        remoteHistoryId: String?,
        ttlMillis: Long = LIST_METADATA_TTL_MS
    ): Boolean {
        val existing = _conversations.value[threadId] ?: return true
        val meta = threadCacheMeta[threadId] ?: return true
        if (!remoteHistoryId.isNullOrBlank() && !meta.historyId.isNullOrBlank()) {
            return meta.historyId != remoteHistoryId
        }
        return (System.currentTimeMillis() - meta.lastMetadataFetchedAtMillis) > ttlMillis &&
            existing.messageCount == 0
    }

    fun shouldFetchFullThread(
        threadId: String,
        ttlMillis: Long = FULL_THREAD_TTL_MS
    ): Boolean {
        val meta = threadCacheMeta[threadId] ?: return true
        if (!meta.isFullHydrated) return true
        if (_messagesByThread.value[threadId].isNullOrEmpty()) return true
        return (System.currentTimeMillis() - meta.lastFullFetchedAtMillis) > ttlMillis
    }

    fun isThreadFullHydrated(threadId: String): Boolean =
        threadCacheMeta[threadId]?.isFullHydrated == true

    fun getConversationSnapshot(threadId: String): Conversation? = _conversations.value[threadId]

    fun observeConversations(filter: ConversationFilter, query: String): Flow<List<Conversation>> {
        val cleanQuery = query.trim().lowercase()
        return _conversations.map { map ->
            map.values
                .filter { conv ->
                    val inActiveConversations = !conv.isArchived &&
                        !conv.folderLabels.contains("TRASH") &&
                        !conv.folderLabels.contains("SPAM") &&
                        conv.category != ConversationCategory.AUTOMATED

                    val matchesFilter = when (filter) {
                        ConversationFilter.ALL -> inActiveConversations
                        ConversationFilter.UNREAD -> inActiveConversations && conv.unreadCount > 0
                        ConversationFilter.IMPORTANT -> inActiveConversations &&
                            (conv.isImportant || conv.category == ConversationCategory.IMPORTANT)
                        ConversationFilter.WORK -> inActiveConversations && conv.category == ConversationCategory.WORK
                        ConversationFilter.PERSONAL -> inActiveConversations && conv.category == ConversationCategory.PERSONAL
                    }

                    val matchesQuery = cleanQuery.isEmpty() ||
                        conv.contactName.lowercase().contains(cleanQuery) ||
                        conv.contactEmail.lowercase().contains(cleanQuery) ||
                        conv.subject.lowercase().contains(cleanQuery) ||
                        conv.lastMessagePreview.lowercase().contains(cleanQuery)

                    matchesFilter && matchesQuery
                }
                .sortedByDescending { it.lastMessageTimestamp }
        }
    }

    fun observeFolderEmails(folder: EmailFolder, query: String): Flow<List<Conversation>> {
        val cleanQuery = query.trim().lowercase()
        return _conversations.map { map ->
            val explicitIds = _folderThreadIds.value[folder]
            val items = if (explicitIds != null) {
                explicitIds.mapNotNull { map[it] }
            } else {
                map.values.filter { conv -> matchesFolder(conv, folder) }
            }
            items
                .filter { conv ->
                    cleanQuery.isEmpty() ||
                        conv.contactName.lowercase().contains(cleanQuery) ||
                        conv.contactEmail.lowercase().contains(cleanQuery) ||
                        conv.subject.lowercase().contains(cleanQuery) ||
                        conv.lastMessagePreview.lowercase().contains(cleanQuery)
                }
                .sortedByDescending { it.lastMessageTimestamp }
        }
    }

    fun setFolderThreads(folder: EmailFolder, threadIds: List<String>, append: Boolean) {
        val current = if (append) _folderThreadIds.value[folder].orEmpty() else emptyList()
        val combined = (current + threadIds).distinct()
        _folderThreadIds.value = _folderThreadIds.value.toMutableMap().apply {
            put(folder, combined)
        }
    }

    fun observeConversation(threadId: String): Flow<Conversation?> =
        _conversations.map { it[threadId] }

    fun observeMessages(threadId: String): Flow<List<ChatMessage>> =
        _messagesByThread.map { it[threadId].orEmpty().sortedBy { msg -> msg.timestampMillis } }

    fun getMessages(threadId: String): List<ChatMessage> =
        _messagesByThread.value[threadId].orEmpty().sortedBy { it.timestampMillis }

    fun hasMessage(threadId: String, messageId: String): Boolean =
        _messagesByThread.value[threadId]?.any { it.messageId == messageId } == true

    fun upsertThread(
        conversation: Conversation,
        messages: List<ChatMessage>,
        historyId: String?,
        isFullHydrated: Boolean
    ) {
        val existingMeta = threadCacheMeta[conversation.threadId]
        val existingMessages = _messagesByThread.value[conversation.threadId].orEmpty()

        // Preserve already-fetched full bodies/attachments if a metadata-only refresh hits the same historyId
        val shouldPreserveExistingFull = !isFullHydrated &&
            existingMeta?.isFullHydrated == true &&
            existingMessages.size == messages.size &&
            existingMessages.map { it.messageId } == messages.map { it.messageId }

        val mergedMessages = if (shouldPreserveExistingFull) {
            val incomingById = messages.associateBy { it.messageId }
            existingMessages.map { oldMsg ->
                val freshMeta = incomingById[oldMsg.messageId]
                if (freshMeta != null) {
                    oldMsg.copy(
                        isRead = freshMeta.isRead,
                        labelIds = freshMeta.labelIds
                    )
                } else {
                    oldMsg
                }
            }
        } else {
            messages.sortedBy { it.timestampMillis }
        }

        val now = System.currentTimeMillis()
        threadCacheMeta[conversation.threadId] = ThreadCacheMetadata(
            historyId = historyId ?: existingMeta?.historyId,
            isFullHydrated = isFullHydrated || shouldPreserveExistingFull,
            lastMetadataFetchedAtMillis = now,
            lastFullFetchedAtMillis = if (isFullHydrated) now else (existingMeta?.lastFullFetchedAtMillis ?: 0L)
        )

        _conversations.value = _conversations.value.toMutableMap().apply {
            put(conversation.threadId, conversation)
        }
        _messagesByThread.value = _messagesByThread.value.toMutableMap().apply {
            put(conversation.threadId, mergedMessages)
        }
    }

    fun updateConversation(threadId: String, transform: (Conversation) -> Conversation) {
        val existing = _conversations.value[threadId] ?: return
        _conversations.value = _conversations.value.toMutableMap().apply {
            put(threadId, transform(existing))
        }
    }

    fun appendOrReplaceMessage(threadId: String, message: ChatMessage) {
        val existing = _messagesByThread.value[threadId].orEmpty()
            .filterNot { it.messageId == message.messageId } + message
        _messagesByThread.value = _messagesByThread.value.toMutableMap().apply {
            put(threadId, existing.sortedBy { it.timestampMillis })
        }
    }

    fun removeMessage(threadId: String, messageId: String) {
        val existing = _messagesByThread.value[threadId].orEmpty()
            .filterNot { it.messageId == messageId }
        _messagesByThread.value = _messagesByThread.value.toMutableMap().apply {
            put(threadId, existing)
        }
    }

    fun markThreadRead(threadId: String) {
        updateConversation(threadId) { it.copy(unreadCount = 0) }
        val msgs = _messagesByThread.value[threadId]?.map { it.copy(isRead = true) } ?: return
        _messagesByThread.value = _messagesByThread.value.toMutableMap().apply {
            put(threadId, msgs)
        }
    }

    fun clearConversationsAndMessages() {
        _conversations.value = emptyMap()
        _messagesByThread.value = emptyMap()
        _folderThreadIds.value = emptyMap()
        _folderNextPageTokens.value = emptyMap()
        _inboxNextPageToken.value = null
        threadCacheMeta.clear()
        folderLoadedAtMillis.clear()
    }

    fun clearAll() {
        clearConversationsAndMessages()
        _account.value = null
    }

    private fun matchesFolder(conv: Conversation, folder: EmailFolder): Boolean {
        val labels = conv.folderLabels
        return when (folder) {
            EmailFolder.INBOX -> labels.contains("INBOX")
            EmailFolder.SENT -> labels.contains("SENT")
            EmailFolder.DRAFTS -> labels.contains("DRAFT")
            EmailFolder.STARRED -> conv.isStarred
            EmailFolder.SPAM -> labels.contains("SPAM")
            EmailFolder.TRASH -> labels.contains("TRASH")
            EmailFolder.ARCHIVE -> conv.isArchived
        }
    }

    companion object {
        private const val LIST_METADATA_TTL_MS = 60_000L
        private const val FULL_THREAD_TTL_MS = 120_000L
    }
}
