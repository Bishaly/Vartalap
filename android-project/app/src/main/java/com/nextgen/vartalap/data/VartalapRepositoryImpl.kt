package com.nextgen.vartalap.data

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import com.nextgen.vartalap.authentication.GoogleOAuthManager
import com.nextgen.vartalap.domain.AccountProfile
import com.nextgen.vartalap.domain.AppSettings
import com.nextgen.vartalap.domain.Attachment
import com.nextgen.vartalap.domain.ChatMessage
import com.nextgen.vartalap.domain.Conversation
import com.nextgen.vartalap.domain.ConversationCategory
import com.nextgen.vartalap.domain.ConversationFilter
import com.nextgen.vartalap.domain.DriveFileItem
import com.nextgen.vartalap.domain.EmailFolder
import com.nextgen.vartalap.domain.MessageDirection
import com.nextgen.vartalap.domain.MessageSendStatus
import com.nextgen.vartalap.domain.OutgoingAttachment
import com.nextgen.vartalap.domain.SyncProgress
import com.nextgen.vartalap.domain.ThemeMode
import com.nextgen.vartalap.domain.VartalapError
import com.nextgen.vartalap.domain.VartalapRepository
import com.nextgen.vartalap.drive.GoogleDriveApiService
import com.nextgen.vartalap.drive.GoogleDriveNetworkClient
import com.nextgen.vartalap.gmail.GmailApiService
import com.nextgen.vartalap.gmail.GmailQuotaExceededException
import com.nextgen.vartalap.gmail.GmailQuotaGuard
import com.nextgen.vartalap.gmail.MimeMessageBuilder
import com.nextgen.vartalap.gmail.MimeParser
import com.nextgen.vartalap.gmail.dto.GmailModifyRequest
import com.nextgen.vartalap.gmail.dto.GmailSendRequest
import com.nextgen.vartalap.gmail.dto.GmailThreadDto
import com.nextgen.vartalap.preferences.AppPreferencesStore
import com.nextgen.vartalap.utils.ConnectivityObserver
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class VartalapRepositoryImpl(
    private val context: Context,
    private val sessionStore: InMemorySessionStore,
    private val prefsStore: AppPreferencesStore,
    private val gmailApi: GmailApiService,
    private val driveApi: GoogleDriveApiService,
    private val oauthManager: GoogleOAuthManager,
    private val connectivityObserver: ConnectivityObserver,
    private val quotaGuard: GmailQuotaGuard
) : VartalapRepository {

    private val syncMutex = Mutex()
    private val paginationMutex = Mutex()
    private val folderMutex = Mutex()
    private val inFlightThreadsMutex = Mutex()
    private val inFlightThreadFetches = ConcurrentHashMap<String, CompletableDeferred<Result<Unit>>>()

    private val sendInFlightKeys = mutableSetOf<String>()
    private val _syncProgress = MutableStateFlow(SyncProgress())
    @Volatile
    private var lastSyncCompletedAtMillis: Long = 0L

    override val activeAccount: Flow<AccountProfile?> = sessionStore.account

    override val settings: Flow<AppSettings> = prefsStore.observeSettings(
        cacheBytesProvider = { calculateTemporaryCacheBytes() }
    )

    override val syncProgress: Flow<SyncProgress> = _syncProgress

    override fun observeConversations(
        filter: ConversationFilter,
        query: String
    ): Flow<List<Conversation>> = sessionStore.observeConversations(filter, query)

    override fun observeFolderEmails(folder: EmailFolder, query: String): Flow<List<Conversation>> =
        sessionStore.observeFolderEmails(folder, query)

    override fun observeConversation(threadId: String): Flow<Conversation?> =
        sessionStore.observeConversation(threadId)

    override fun observeMessages(threadId: String): Flow<List<ChatMessage>> =
        sessionStore.observeMessages(threadId)

    override fun isFolderLoaded(folder: EmailFolder): Boolean = sessionStore.isFolderLoaded(folder)

    override suspend fun restoreSessionIfAuthenticated(): Result<AccountProfile?> =
        withContext(Dispatchers.IO) {
            if (!oauthManager.hasAuthenticatedSession()) {
                return@withContext Result.success(null)
            }
            sessionStore.getAccount()?.let { existing ->
                return@withContext Result.success(existing)
            }
            completeSignIn().map { it }
        }

    override suspend fun completeSignIn(): Result<AccountProfile> = withContext(Dispatchers.IO) {
        sessionStore.getAccount()?.let { cached ->
            quotaGuard.logCacheHit("profile.get")
            return@withContext Result.success(cached)
        }
        runCatching {
            val profile = gmailApi.getProfile()
            val displayName = profile.emailAddress.substringBefore("@")
                .replace(".", " ")
                .split(" ")
                .joinToString(" ") { word -> word.replaceFirstChar { it.uppercase() } }
                .ifBlank { profile.emailAddress }

            val account = AccountProfile(
                email = profile.emailAddress,
                displayName = displayName,
                avatarUrl = null,
                messagesTotal = profile.messagesTotal,
                threadsTotal = profile.threadsTotal
            )
            sessionStore.setAccount(account)
            if (!profile.historyId.isNullOrBlank() && prefsStore.getLastHistoryId().isNullOrBlank()) {
                prefsStore.setSyncCheckpoint(profile.historyId, System.currentTimeMillis())
            }
            account
        }
    }

    override suspend fun syncInitialOrIncremental(forceFull: Boolean): Result<Int> =
        withContext(Dispatchers.IO) {
            if (!connectivityObserver.isConnected()) {
                _syncProgress.value = _syncProgress.value.copy(
                    isSyncing = false,
                    error = VartalapError.NoInternet
                )
                return@withContext Result.failure(IOException("No internet connection"))
            }

            val cooldownRemaining = quotaGuard.remainingCooldownSeconds()
            if (cooldownRemaining > 0L) {
                val err = VartalapError.QuotaExceeded(cooldownRemaining)
                _syncProgress.value = _syncProgress.value.copy(isSyncing = false, error = err)
                return@withContext Result.failure(GmailQuotaExceededException(cooldownRemaining))
            }

            // Prevent simultaneous duplicate syncs; also honor minimum foreground sync interval
            if (syncMutex.isLocked) {
                quotaGuard.logCacheHit("sync.dedup_in_flight")
                return@withContext Result.success(0)
            }

            val nowBeforeLock = System.currentTimeMillis()
            val persistedLastSync = if (lastSyncCompletedAtMillis == 0L) {
                settings.first().lastSyncTimestamp
            } else {
                lastSyncCompletedAtMillis
            }
            if (!forceFull && (nowBeforeLock - persistedLastSync) < MIN_SYNC_INTERVAL_MS) {
                quotaGuard.logCacheHit("sync.min_interval_skip")
                return@withContext Result.success(0)
            }

            syncMutex.withLock {
                _syncProgress.value = _syncProgress.value.copy(isSyncing = true, error = null)
                return@withLock try {
                    val account = sessionStore.getAccount() ?: completeSignIn().getOrThrow()
                    val overrides = prefsStore.getCategoryOverrides()
                    val lastHistoryId = prefsStore.getLastHistoryId()

                    val newIncomingMessages = if (forceFull || lastHistoryId.isNullOrBlank()) {
                        performFullMetadataSyncInternal(account.email, overrides)
                    } else {
                        performIncrementalSyncInternal(account.email, lastHistoryId, overrides)
                    }

                    val now = System.currentTimeMillis()
                    lastSyncCompletedAtMillis = now
                    _syncProgress.value = SyncProgress(isSyncing = false, lastSyncedAt = now, error = null)
                    Result.success(newIncomingMessages)
                } catch (throwable: Throwable) {
                    val mapped = mapThrowableToError(throwable)
                    _syncProgress.value = _syncProgress.value.copy(isSyncing = false, error = mapped)
                    Result.failure(throwable)
                }
            }
        }

    private suspend fun performFullMetadataSyncInternal(
        accountEmail: String,
        overrides: Map<String, ConversationCategory>
    ): Int {
        val threadList = gmailApi.listThreads(
            maxResults = PAGE_SIZE,
            pageToken = null,
            labelIds = listOf("INBOX")
        )
        val summaries = threadList.threads.orEmpty()
        val fetchedThreads = hydrateThreadsWithMetadata(
            threadIdsAndHistories = summaries.map { it.id to it.historyId }
        )

        var newIncoming = 0
        fetchedThreads.forEach { dto ->
            newIncoming += cacheThreadInMemory(
                thread = dto,
                accountEmail = accountEmail,
                categoryOverrides = overrides,
                isFullHydrated = false
            )
        }

        sessionStore.setInboxNextPageToken(threadList.nextPageToken)
        sessionStore.markFolderLoaded(EmailFolder.INBOX)

        val latestHistoryId = summaries.firstOrNull()?.historyId
            ?: fetchedThreads.firstOrNull()?.historyId
            ?: prefsStore.getLastHistoryId()
            ?: gmailApi.getProfile().historyId

        prefsStore.setSyncCheckpoint(latestHistoryId, System.currentTimeMillis())
        return newIncoming
    }

    private suspend fun performIncrementalSyncInternal(
        accountEmail: String,
        startHistoryId: String,
        overrides: Map<String, ConversationCategory>
    ): Int {
        val touchedThreadIds = linkedSetOf<String>()
        var latestHistoryId = startHistoryId
        var pageToken: String? = null
        var pageCount = 0

        try {
            do {
                val historyResponse = gmailApi.listHistory(
                    startHistoryId = startHistoryId,
                    pageToken = pageToken,
                    maxResults = 100,
                    historyTypes = listOf("messageAdded", "labelAdded", "labelRemoved")
                )
                historyResponse.history.orEmpty().forEach { record ->
                    record.messagesAdded.orEmpty().forEach { touchedThreadIds.add(it.message.threadId) }
                    record.labelsAdded.orEmpty().forEach { touchedThreadIds.add(it.message.threadId) }
                    record.labelsRemoved.orEmpty().forEach { touchedThreadIds.add(it.message.threadId) }
                }
                if (!historyResponse.historyId.isNullOrBlank()) {
                    latestHistoryId = historyResponse.historyId
                }
                pageToken = historyResponse.nextPageToken
                pageCount++
            } while (!pageToken.isNullOrBlank() && pageCount < MAX_HISTORY_PAGES)
        } catch (httpEx: HttpException) {
            if (httpEx.code() == 404) {
                prefsStore.setSyncCheckpoint(null, System.currentTimeMillis())
                // Safe non-reentrant call while already holding syncMutex (prevents deadlock)
                return performFullMetadataSyncInternal(accountEmail, overrides)
            }
            throw httpEx
        }

        if (touchedThreadIds.isEmpty()) {
            quotaGuard.logCacheHit("history.no_changes")
            prefsStore.setSyncCheckpoint(latestHistoryId, System.currentTimeMillis())
            return 0
        }

        val fetchedThreads = hydrateThreadsWithMetadata(
            threadIdsAndHistories = touchedThreadIds.take(PAGE_SIZE).map { it to null },
            forceRefresh = true
        )
        var newIncoming = 0
        fetchedThreads.forEach { dto ->
            newIncoming += cacheThreadInMemory(
                thread = dto,
                accountEmail = accountEmail,
                categoryOverrides = overrides,
                isFullHydrated = false
            )
        }

        prefsStore.setSyncCheckpoint(latestHistoryId, System.currentTimeMillis())
        return newIncoming
    }

    override suspend fun loadMoreConversations(): Result<Boolean> = withContext(Dispatchers.IO) {
        if (!connectivityObserver.isConnected()) {
            return@withContext Result.failure(IOException("No internet connection"))
        }
        val cooldown = quotaGuard.remainingCooldownSeconds()
        if (cooldown > 0L) {
            return@withContext Result.failure(GmailQuotaExceededException(cooldown))
        }
        if (paginationMutex.isLocked) {
            quotaGuard.logCacheHit("pagination.dedup")
            return@withContext Result.success(sessionStore.getInboxNextPageToken() != null)
        }

        paginationMutex.withLock {
            runCatching {
                val account = sessionStore.getAccount() ?: return@runCatching false
                val pageToken = sessionStore.getInboxNextPageToken() ?: return@runCatching false
                val overrides = prefsStore.getCategoryOverrides()

                val page = gmailApi.listThreads(
                    maxResults = PAGE_SIZE,
                    pageToken = pageToken,
                    labelIds = listOf("INBOX")
                )
                val summaries = page.threads.orEmpty()
                val fetched = hydrateThreadsWithMetadata(summaries.map { it.id to it.historyId })
                fetched.forEach { dto ->
                    cacheThreadInMemory(
                        thread = dto,
                        accountEmail = account.email,
                        categoryOverrides = overrides,
                        isFullHydrated = false
                    )
                }
                sessionStore.setInboxNextPageToken(page.nextPageToken)
                page.nextPageToken != null
            }
        }
    }

    override suspend fun loadFolderEmails(
        folder: EmailFolder,
        loadMore: Boolean
    ): Result<Boolean> = withContext(Dispatchers.IO) {
        if (!connectivityObserver.isConnected()) {
            return@withContext Result.failure(IOException("No internet connection"))
        }
        val cooldown = quotaGuard.remainingCooldownSeconds()
        if (cooldown > 0L) {
            return@withContext Result.failure(GmailQuotaExceededException(cooldown))
        }

        // Prevent duplicate concurrent folder fetches during rapid recomposition/clicks
        if (folderMutex.isLocked) {
            quotaGuard.logCacheHit("folder.dedup_${folder.name}")
            return@withContext Result.success(sessionStore.getFolderNextPageToken(folder) != null)
        }

        folderMutex.withLock {
            if (!loadMore &&
                sessionStore.isFolderLoaded(folder) &&
                (System.currentTimeMillis() - sessionStore.getFolderLoadedAt(folder)) < MIN_SYNC_INTERVAL_MS
            ) {
                quotaGuard.logCacheHit("folder.cooldown_skip_${folder.name}")
                return@withLock Result.success(sessionStore.getFolderNextPageToken(folder) != null)
            }

            runCatching {
                val account = sessionStore.getAccount() ?: completeSignIn().getOrThrow()
                val overrides = prefsStore.getCategoryOverrides()
                val pageToken = if (loadMore) sessionStore.getFolderNextPageToken(folder) else null
                if (loadMore && pageToken == null) return@runCatching false

                val includeSpamTrash = folder == EmailFolder.SPAM || folder == EmailFolder.TRASH
                val query = if (folder == EmailFolder.ARCHIVE) {
                    "-in:inbox -in:trash -in:spam -in:draft"
                } else {
                    null
                }
                val labels = folder.gmailLabelId?.let { listOf(it) }

                val response = gmailApi.listThreads(
                    maxResults = PAGE_SIZE,
                    pageToken = pageToken,
                    query = query,
                    labelIds = labels,
                    includeSpamTrash = includeSpamTrash
                )

                val summaries = response.threads.orEmpty()
                val fetched = hydrateThreadsWithMetadata(summaries.map { it.id to it.historyId })
                fetched.forEach { dto ->
                    cacheThreadInMemory(
                        thread = dto,
                        accountEmail = account.email,
                        categoryOverrides = overrides,
                        isFullHydrated = false
                    )
                }

                sessionStore.setFolderThreads(folder, summaries.map { it.id }, append = loadMore)
                sessionStore.setFolderNextPageToken(folder, response.nextPageToken)
                sessionStore.markFolderLoaded(folder)
                response.nextPageToken != null
            }
        }
    }

    override suspend fun setConversationCategory(
        threadId: String,
        category: ConversationCategory
    ) {
        prefsStore.setThreadCategoryOverride(threadId, category)
        sessionStore.updateConversation(threadId) {
            it.copy(
                category = category,
                isAutomatedOrBulk = category == ConversationCategory.AUTOMATED
            )
        }
    }

    override suspend fun refreshThread(threadId: String): Result<Unit> = withContext(Dispatchers.IO) {
        if (!sessionStore.shouldFetchFullThread(threadId)) {
            quotaGuard.logCacheHit("threads.get(full)_$threadId")
            return@withContext Result.success(Unit)
        }

        val cooldown = quotaGuard.remainingCooldownSeconds()
        if (cooldown > 0L) {
            return@withContext Result.failure(GmailQuotaExceededException(cooldown))
        }

        var isOwner = false
        val deferred = inFlightThreadsMutex.withLock {
            inFlightThreadFetches[threadId] ?: CompletableDeferred<Result<Unit>>().also { created ->
                inFlightThreadFetches[threadId] = created
                isOwner = true
            }
        }

        if (!isOwner) {
            quotaGuard.logCacheHit("threads.get(full_dedup)_$threadId")
            return@withContext deferred.await()
        }

        val result = runCatching {
            val account = sessionStore.getAccount()
                ?: throw IllegalStateException("No connected Gmail account")
            val overrides = prefsStore.getCategoryOverrides()
            val fullThread = gmailApi.getThread(threadId = threadId, format = "full")
            cacheThreadInMemory(
                thread = fullThread,
                accountEmail = account.email,
                categoryOverrides = overrides,
                isFullHydrated = true
            )
            Unit
        }

        inFlightThreadsMutex.withLock {
            inFlightThreadFetches.remove(threadId)
        }
        deferred.complete(result)
        result
    }

    override suspend fun markThreadRead(threadId: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val snapshot = sessionStore.getConversationSnapshot(threadId)
            if (snapshot != null && snapshot.unreadCount == 0) {
                quotaGuard.logCacheHit("threads.modify(read_skip)")
                return@runCatching
            }
            sessionStore.markThreadRead(threadId)
            if (oauthManager.hasModifyScope() && connectivityObserver.isConnected()) {
                gmailApi.modifyThread(
                    threadId = threadId,
                    request = GmailModifyRequest(removeLabelIds = listOf("UNREAD"))
                )
            }
        }
    }

    override suspend fun toggleStar(threadId: String, starred: Boolean): Result<Unit> =
        withContext(Dispatchers.IO) {
            runCatching {
                if (!oauthManager.hasModifyScope()) {
                    throw IllegalStateException("Grant Gmail modify permission to star conversations.")
                }
                val request = if (starred) {
                    GmailModifyRequest(addLabelIds = listOf("STARRED"))
                } else {
                    GmailModifyRequest(removeLabelIds = listOf("STARRED"))
                }
                gmailApi.modifyThread(threadId, request)
                sessionStore.updateConversation(threadId) { it.copy(isStarred = starred) }
            }
        }

    override suspend fun toggleArchive(threadId: String, archived: Boolean): Result<Unit> =
        withContext(Dispatchers.IO) {
            runCatching {
                if (!oauthManager.hasModifyScope()) {
                    throw IllegalStateException("Grant Gmail modify permission to archive conversations.")
                }
                val request = if (archived) {
                    GmailModifyRequest(removeLabelIds = listOf("INBOX"))
                } else {
                    GmailModifyRequest(addLabelIds = listOf("INBOX"))
                }
                gmailApi.modifyThread(threadId, request)
                sessionStore.updateConversation(threadId) { conv ->
                    val updatedLabels = if (archived) {
                        conv.folderLabels - "INBOX"
                    } else {
                        conv.folderLabels + "INBOX"
                    }
                    conv.copy(isArchived = archived, folderLabels = updatedLabels)
                }
            }
        }

    override suspend fun sendNewConversation(
        toEmails: List<String>,
        subject: String,
        bodyText: String,
        attachments: List<OutgoingAttachment>
    ): Result<ChatMessage> = withContext(Dispatchers.IO) {
        val cleanRecipients = toEmails.map { it.trim() }.filter { it.isNotBlank() }
        val dedupeKey = "new:${cleanRecipients.joinToString(",")}:$subject:${bodyText.hashCode()}"
        if (!acquireSendLock(dedupeKey)) {
            return@withContext Result.failure(IllegalStateException("Message send already in progress"))
        }

        try {
            val account = sessionStore.getAccount()
                ?: throw IllegalStateException("No connected Gmail account")
            val overrides = prefsStore.getCategoryOverrides()

            val raw = MimeMessageBuilder.buildRawBase64UrlMessage(
                fromEmail = account.email,
                toEmails = cleanRecipients,
                subject = subject,
                bodyText = bodyText,
                attachments = attachments
            )
            val sentDto = gmailApi.sendMessage(GmailSendRequest(raw = raw, threadId = null))
            val fullThread = gmailApi.getThread(threadId = sentDto.threadId, format = "full")
            cacheThreadInMemory(fullThread, account.email, overrides, isFullHydrated = true)
            Result.success(MimeParser.parseMessage(sentDto, account.email))
        } catch (t: Throwable) {
            Result.failure(t)
        } finally {
            releaseSendLock(dedupeKey)
        }
    }

    override suspend fun replyToThread(
        threadId: String,
        replyAll: Boolean,
        bodyText: String,
        attachments: List<OutgoingAttachment>
    ): Result<ChatMessage> = withContext(Dispatchers.IO) {
        val dedupeKey = "reply:$threadId:${bodyText.hashCode()}"
        if (!acquireSendLock(dedupeKey)) {
            return@withContext Result.failure(IllegalStateException("Reply send already in progress"))
        }

        val account = sessionStore.getAccount()
            ?: return@withContext Result.failure(IllegalStateException("No connected Gmail account"))

        val existingMessages = sessionStore.getMessages(threadId)
        val latest = existingMessages.lastOrNull()
            ?: return@withContext Result.failure(IllegalStateException("Conversation not found in active session"))

        val tempId = "temp_${UUID.randomUUID()}"
        val recipients = buildReplyRecipients(account.email, latest, replyAll)
        val ccList = if (replyAll) {
            latest.ccEmails.filter { !it.equals(account.email, ignoreCase = true) }
        } else {
            emptyList()
        }

        val replySubject = if (latest.subject.startsWith("Re:", ignoreCase = true)) {
            latest.subject
        } else {
            "Re: ${latest.subject}"
        }

        val optimisticMessage = ChatMessage(
            messageId = tempId,
            threadId = threadId,
            senderName = account.displayName,
            senderEmail = account.email,
            recipientEmails = recipients,
            ccEmails = ccList,
            subject = replySubject,
            bodyPlain = bodyText,
            bodyHtmlSanitized = null,
            quotedText = null,
            timestampMillis = System.currentTimeMillis(),
            direction = MessageDirection.OUTGOING,
            sendStatus = MessageSendStatus.SENDING,
            isRead = true,
            labelIds = listOf("SENT"),
            rfcMessageIdHeader = null,
            inReplyToHeader = latest.rfcMessageIdHeader,
            referencesHeader = null,
            isAutomatedHeader = false,
            attachments = emptyList()
        )
        sessionStore.appendOrReplaceMessage(threadId, optimisticMessage)

        return@withContext try {
            val refs = listOfNotNull(latest.referencesHeader, latest.rfcMessageIdHeader)
                .joinToString(" ")
                .trim()
                .ifBlank { null }

            val raw = MimeMessageBuilder.buildRawBase64UrlMessage(
                fromEmail = account.email,
                toEmails = recipients,
                ccEmails = ccList,
                subject = replySubject,
                bodyText = bodyText,
                inReplyTo = latest.rfcMessageIdHeader,
                references = refs,
                attachments = attachments
            )
            val sentDto = gmailApi.sendMessage(GmailSendRequest(raw = raw, threadId = threadId))
            sessionStore.removeMessage(threadId, tempId)
            val overrides = prefsStore.getCategoryOverrides()
            val fullThread = gmailApi.getThread(threadId = sentDto.threadId, format = "full")
            cacheThreadInMemory(fullThread, account.email, overrides, isFullHydrated = true)
            Result.success(MimeParser.parseMessage(sentDto, account.email))
        } catch (t: Throwable) {
            sessionStore.appendOrReplaceMessage(
                threadId,
                optimisticMessage.copy(sendStatus = MessageSendStatus.FAILED)
            )
            Result.failure(t)
        } finally {
            releaseSendLock(dedupeKey)
        }
    }

    override suspend fun streamAttachmentToTempUri(attachment: Attachment): Result<String> =
        withContext(Dispatchers.IO) {
            runCatching {
                val bytes = fetchAttachmentBytesFromGmail(attachment)
                val tempDir = File(context.cacheDir, "attachments").apply { mkdirs() }
                val safeName = attachment.fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                val tempFile = File(tempDir, "${attachment.messageId}_$safeName")
                tempFile.writeBytes(bytes)

                FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    tempFile
                ).toString()
            }
        }

    override suspend fun saveAttachmentToSafUri(
        attachment: Attachment,
        destinationUri: Uri
    ): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val bytes = fetchAttachmentBytesFromGmail(attachment)
            context.contentResolver.openOutputStream(destinationUri)?.use { out ->
                out.write(bytes)
            } ?: throw IOException("Unable to open destination file via Storage Access Framework")
            Unit
        }
    }

    override suspend fun setDriveFeatureEnabled(enabled: Boolean) {
        prefsStore.setDriveFeatureEnabled(enabled)
    }

    override suspend fun listUserDriveFiles(nameQuery: String): Result<List<DriveFileItem>> =
        withContext(Dispatchers.IO) {
            runCatching {
                if (!oauthManager.hasDriveScope()) {
                    throw IllegalStateException("Enable Google Drive permission in Settings first.")
                }
                val clean = nameQuery.trim().replace("'", "\\'")
                val q = if (clean.isEmpty()) {
                    "trashed = false"
                } else {
                    "trashed = false and name contains '$clean'"
                }
                driveApi.listFiles(query = q).files.map { dto ->
                    DriveFileItem(
                        id = dto.id,
                        name = dto.name,
                        mimeType = dto.mimeType,
                        sizeBytes = dto.size?.toLongOrNull() ?: 0L,
                        modifiedTime = dto.modifiedTime,
                        webViewLink = dto.webViewLink
                    )
                }
            }
        }

    override suspend fun saveAttachmentToUserDrive(attachment: Attachment): Result<DriveFileItem> =
        withContext(Dispatchers.IO) {
            runCatching {
                if (!oauthManager.hasDriveScope()) {
                    throw IllegalStateException("Enable Google Drive permission in Settings to save attachments to your Drive.")
                }
                val bytes = fetchAttachmentBytesFromGmail(attachment)
                val (metadataPart, mediaPart) = GoogleDriveNetworkClient.buildUploadParts(
                    fileName = attachment.fileName,
                    mimeType = attachment.mimeType,
                    bytes = bytes
                )
                val uploaded = driveApi.uploadMultipartFile(metadataPart, mediaPart)
                DriveFileItem(
                    id = uploaded.id,
                    name = uploaded.name,
                    mimeType = uploaded.mimeType,
                    sizeBytes = uploaded.size?.toLongOrNull() ?: bytes.size.toLong(),
                    modifiedTime = uploaded.modifiedTime,
                    webViewLink = uploaded.webViewLink
                )
            }
        }

    override suspend fun downloadDriveFileAsAttachment(
        driveFile: DriveFileItem
    ): Result<OutgoingAttachment> = withContext(Dispatchers.IO) {
        runCatching {
            if (!oauthManager.hasDriveScope()) {
                throw IllegalStateException("Google Drive permission is not granted.")
            }
            val bytes = driveApi.downloadFileContent(driveFile.id).use { it.bytes() }
            OutgoingAttachment(
                uriString = "drive://${driveFile.id}",
                fileName = driveFile.name,
                mimeType = driveFile.mimeType,
                bytes = bytes
            )
        }
    }

    override suspend fun updateThemeMode(mode: ThemeMode) {
        prefsStore.setThemeMode(mode)
    }

    override suspend fun updateNotificationsEnabled(enabled: Boolean) {
        prefsStore.setNotificationsEnabled(enabled)
    }

    override suspend fun updateSyncInterval(minutes: Int) {
        prefsStore.setSyncIntervalMinutes(minutes)
    }

    override suspend fun clearTemporaryCache(): Long = withContext(Dispatchers.IO) {
        val tempDir = File(context.cacheDir, "attachments")
        if (tempDir.exists()) {
            tempDir.deleteRecursively()
        }
        sessionStore.clearConversationsAndMessages()
        lastSyncCompletedAtMillis = 0L
        quotaGuard.clearCooldown()
        calculateTemporaryCacheBytes()
    }

    override suspend fun disconnectAndLogout() = withContext(Dispatchers.IO) {
        oauthManager.revokeAndClearTokens()
        clearTemporaryCache()
        sessionStore.clearAll()
        prefsStore.clearSyncCheckpointAndDriveToggle()
    }

    private suspend fun hydrateThreadsWithMetadata(
        threadIdsAndHistories: List<Pair<String, String?>>,
        forceRefresh: Boolean = false
    ): List<GmailThreadDto> = coroutineScope {
        val semaphore = Semaphore(MAX_CONCURRENT_THREAD_FETCHES)
        threadIdsAndHistories
            .distinctBy { it.first }
            .mapNotNull { (threadId, remoteHistoryId) ->
                if (!forceRefresh && !sessionStore.shouldFetchThreadForList(threadId, remoteHistoryId)) {
                    quotaGuard.logCacheHit("threads.get(metadata)_$threadId")
                    return@mapNotNull null
                }
                async {
                    semaphore.withPermit {
                        gmailApi.getThread(
                            threadId = threadId,
                            format = "metadata",
                            metadataHeaders = METADATA_HEADERS
                        )
                    }
                }
            }
            .awaitAll()
    }

    private suspend fun fetchAttachmentBytesFromGmail(attachment: Attachment): ByteArray {
        val gmailAttId = attachment.gmailAttachmentId
            ?: throw IllegalStateException("Attachment ID unavailable")
        val response = gmailApi.getAttachment(attachment.messageId, gmailAttId)
        return MimeParser.decodeBase64Url(response.data)
    }

    private fun cacheThreadInMemory(
        thread: GmailThreadDto,
        accountEmail: String,
        categoryOverrides: Map<String, ConversationCategory>,
        isFullHydrated: Boolean
    ): Int {
        val rawMessages = thread.messages.orEmpty()
        if (rawMessages.isEmpty()) return 0

        var newlyDetectedIncoming = 0
        val parsedMessages = rawMessages.map { dto ->
            val alreadyInSession = sessionStore.hasMessage(thread.id, dto.id)
            val parsed = MimeParser.parseMessage(dto, accountEmail)
            if (!alreadyInSession && parsed.direction == MessageDirection.INCOMING && !parsed.isRead) {
                newlyDetectedIncoming++
            }
            parsed
        }.sortedBy { it.timestampMillis }

        val lastMsg = parsedMessages.last()
        val contactMsg = parsedMessages.lastOrNull { it.direction == MessageDirection.INCOMING } ?: lastMsg
        val contactName = if (contactMsg.senderEmail.equals(accountEmail, ignoreCase = true)) {
            contactMsg.recipientEmails.firstOrNull().orEmpty().ifBlank { "Conversation" }
        } else {
            contactMsg.senderName
        }
        val contactEmail = if (contactMsg.senderEmail.equals(accountEmail, ignoreCase = true)) {
            contactMsg.recipientEmails.firstOrNull().orEmpty()
        } else {
            contactMsg.senderEmail
        }

        val allLabels = rawMessages.flatMap { it.labelIds.orEmpty() }.toSet()
        val isImportant = allLabels.contains("IMPORTANT")
        val isAutomated = parsedMessages.any { it.isAutomatedHeader }
        val userDomain = accountEmail.substringAfter("@", "").lowercase()
        val contactDomain = contactEmail.substringAfter("@", "").lowercase()

        val inferredCategory = categoryOverrides[thread.id] ?: when {
            isAutomated -> ConversationCategory.AUTOMATED
            isImportant -> ConversationCategory.IMPORTANT
            userDomain.isNotBlank() &&
                userDomain !in setOf("gmail.com", "googlemail.com") &&
                contactDomain == userDomain -> ConversationCategory.WORK
            else -> ConversationCategory.PERSONAL
        }

        val participants = parsedMessages
            .flatMap { listOf(it.senderEmail) + it.recipientEmails }
            .filter { it.isNotBlank() && !it.equals(accountEmail, ignoreCase = true) }
            .distinct()
            .joinToString(", ")
            .ifBlank { contactEmail }

        val existingConv = sessionStore.getConversationSnapshot(thread.id)
        val preview = if (isFullHydrated || existingConv == null || lastMsg.bodyPlain.isNotBlank()) {
            lastMsg.bodyPlain.replace("\n", " ").take(140)
        } else {
            existingConv.lastMessagePreview
        }

        val conversation = Conversation(
            threadId = thread.id,
            contactName = contactName,
            contactEmail = contactEmail,
            participantsSummary = participants,
            subject = lastMsg.subject,
            lastMessagePreview = preview,
            lastMessageTimestamp = lastMsg.timestampMillis,
            unreadCount = parsedMessages.count { !it.isRead },
            hasAttachments = parsedMessages.any { it.attachments.isNotEmpty() } ||
                (existingConv?.hasAttachments == true && !isFullHydrated),
            isStarred = allLabels.contains("STARRED"),
            isArchived = !allLabels.contains("INBOX") && !allLabels.contains("SENT") && !allLabels.contains("DRAFT"),
            isImportant = isImportant,
            isAutomatedOrBulk = inferredCategory == ConversationCategory.AUTOMATED,
            category = inferredCategory,
            folderLabels = allLabels,
            messageCount = parsedMessages.size
        )

        sessionStore.upsertThread(
            conversation = conversation,
            messages = parsedMessages,
            historyId = thread.historyId ?: rawMessages.lastOrNull()?.historyId,
            isFullHydrated = isFullHydrated
        )
        return newlyDetectedIncoming
    }

    private fun buildReplyRecipients(
        accountEmail: String,
        latest: ChatMessage,
        replyAll: Boolean
    ): List<String> {
        val candidates = linkedSetOf<String>()
        if (!latest.senderEmail.equals(accountEmail, ignoreCase = true)) {
            candidates.add(latest.senderEmail)
        }
        if (replyAll || candidates.isEmpty()) {
            latest.recipientEmails
                .filter { it.isNotBlank() && !it.equals(accountEmail, ignoreCase = true) }
                .forEach { candidates.add(it) }
        }
        if (candidates.isEmpty() && latest.senderEmail.isNotBlank()) {
            candidates.add(latest.senderEmail)
        }
        return candidates.toList()
    }

    private fun acquireSendLock(key: String): Boolean = synchronized(sendInFlightKeys) {
        sendInFlightKeys.add(key)
    }

    private fun releaseSendLock(key: String) = synchronized(sendInFlightKeys) {
        sendInFlightKeys.remove(key)
    }

    private fun calculateTemporaryCacheBytes(): Long {
        val tempDir = File(context.cacheDir, "attachments")
        if (!tempDir.exists()) return 0L
        return tempDir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
    }

    private fun mapThrowableToError(t: Throwable): VartalapError {
        return when (t) {
            is GmailQuotaExceededException -> VartalapError.QuotaExceeded(t.retryAfterSeconds)
            is IOException -> VartalapError.NoInternet
            is HttpException -> when (t.code()) {
                401 -> VartalapError.AuthExpired
                429, 403 -> VartalapError.QuotaExceeded(quotaGuard.remainingCooldownSeconds().coerceAtLeast(30L))
                else -> VartalapError.SyncFailed("HTTP ${t.code()}")
            }
            else -> VartalapError.SyncFailed(t.message ?: "Unexpected error")
        }
    }

    companion object {
        private const val PAGE_SIZE = 15
        private const val MAX_CONCURRENT_THREAD_FETCHES = 3
        private const val MAX_HISTORY_PAGES = 3
        private const val MIN_SYNC_INTERVAL_MS = 30_000L

        private val METADATA_HEADERS = listOf(
            "From",
            "To",
            "Cc",
            "Subject",
            "Message-ID",
            "In-Reply-To",
            "References",
            "List-Unsubscribe",
            "Precedence",
            "Auto-Submitted"
        )
    }
}
