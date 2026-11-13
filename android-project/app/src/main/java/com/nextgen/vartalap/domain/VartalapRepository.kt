package com.nextgen.vartalap.domain

import android.net.Uri
import kotlinx.coroutines.flow.Flow

interface VartalapRepository {
    val activeAccount: Flow<AccountProfile?>
    val settings: Flow<AppSettings>
    val syncProgress: Flow<SyncProgress>

    fun observeConversations(filter: ConversationFilter, query: String): Flow<List<Conversation>>
    fun observeFolderEmails(folder: EmailFolder, query: String): Flow<List<Conversation>>
    fun observeConversation(threadId: String): Flow<Conversation?>
    fun observeMessages(threadId: String): Flow<List<ChatMessage>>

    suspend fun restoreSessionIfAuthenticated(): Result<AccountProfile?>
    suspend fun completeSignIn(): Result<AccountProfile>
    suspend fun syncInitialOrIncremental(forceFull: Boolean = false): Result<Int>
    suspend fun loadMoreConversations(): Result<Boolean>
    suspend fun loadFolderEmails(folder: EmailFolder, loadMore: Boolean = false): Result<Boolean>
    fun isFolderLoaded(folder: EmailFolder): Boolean
    suspend fun setConversationCategory(threadId: String, category: ConversationCategory)
    suspend fun refreshThread(threadId: String): Result<Unit>
    suspend fun markThreadRead(threadId: String): Result<Unit>
    suspend fun toggleStar(threadId: String, starred: Boolean): Result<Unit>
    suspend fun toggleArchive(threadId: String, archived: Boolean): Result<Unit>

    suspend fun sendNewConversation(
        toEmails: List<String>,
        subject: String,
        bodyText: String,
        attachments: List<OutgoingAttachment>
    ): Result<ChatMessage>

    suspend fun replyToThread(
        threadId: String,
        replyAll: Boolean,
        bodyText: String,
        attachments: List<OutgoingAttachment>
    ): Result<ChatMessage>

    suspend fun streamAttachmentToTempUri(attachment: Attachment): Result<String>
    suspend fun saveAttachmentToSafUri(attachment: Attachment, destinationUri: Uri): Result<Unit>

    suspend fun setDriveFeatureEnabled(enabled: Boolean)
    suspend fun listUserDriveFiles(nameQuery: String = ""): Result<List<DriveFileItem>>
    suspend fun saveAttachmentToUserDrive(attachment: Attachment): Result<DriveFileItem>
    suspend fun downloadDriveFileAsAttachment(driveFile: DriveFileItem): Result<OutgoingAttachment>

    suspend fun updateThemeMode(mode: ThemeMode)
    suspend fun updateNotificationsEnabled(enabled: Boolean)
    suspend fun updateSyncInterval(minutes: Int)
    suspend fun clearTemporaryCache(): Long
    suspend fun disconnectAndLogout()
}
