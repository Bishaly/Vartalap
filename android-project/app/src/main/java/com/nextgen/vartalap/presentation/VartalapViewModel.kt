package com.nextgen.vartalap.presentation

import android.content.Intent
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.nextgen.vartalap.VartalapApp
import com.nextgen.vartalap.domain.AccountProfile
import com.nextgen.vartalap.domain.AppSettings
import com.nextgen.vartalap.domain.Attachment
import com.nextgen.vartalap.domain.ChatMessage
import com.nextgen.vartalap.domain.Conversation
import com.nextgen.vartalap.domain.ConversationCategory
import com.nextgen.vartalap.domain.ConversationFilter
import com.nextgen.vartalap.domain.DriveFileItem
import com.nextgen.vartalap.domain.EmailFolder
import com.nextgen.vartalap.domain.OutgoingAttachment
import com.nextgen.vartalap.domain.SyncProgress
import com.nextgen.vartalap.domain.ThemeMode
import com.nextgen.vartalap.gmail.GmailQuotaExceededException
import com.nextgen.vartalap.utils.AttachmentHelper
import com.nextgen.vartalap.worker.SyncScheduler
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@OptIn(ExperimentalCoroutinesApi::class)
class VartalapViewModel(private val app: VartalapApp) : ViewModel() {

    private val repository = app.container.repository
    private val quotaGuard = app.container.quotaGuard
    val oauthManager = app.container.oauthManager

    private val _selectedFilter = MutableStateFlow(ConversationFilter.ALL)
    val selectedFilter: StateFlow<ConversationFilter> = _selectedFilter

    private val _selectedFolder = MutableStateFlow(EmailFolder.INBOX)
    val selectedFolder: StateFlow<EmailFolder> = _selectedFolder

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery

    private val _authError = MutableStateFlow<String?>(null)
    val authError: StateFlow<String?> = _authError

    private val _isSigningIn = MutableStateFlow(false)
    val isSigningIn: StateFlow<Boolean> = _isSigningIn

    private val _statusBanner = MutableStateFlow<String?>(null)
    val statusBanner: StateFlow<String?> = _statusBanner

    private val _isSending = MutableStateFlow(false)
    val isSending: StateFlow<Boolean> = _isSending

    private val _isFolderLoading = MutableStateFlow(false)
    val isFolderLoading: StateFlow<Boolean> = _isFolderLoading

    private val _driveFiles = MutableStateFlow<List<DriveFileItem>>(emptyList())
    val driveFiles: StateFlow<List<DriveFileItem>> = _driveFiles

    private val _isLoadingDrive = MutableStateFlow(false)
    val isLoadingDrive: StateFlow<Boolean> = _isLoadingDrive

    private var refreshDebounceJob: Job? = null
    private var lastManualRefreshRequestAt: Long = 0L

    val isOnline: StateFlow<Boolean> = app.container.connectivityObserver
        .observeConnectivity()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    val activeAccount: StateFlow<AccountProfile?> = repository.activeAccount
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val settings: StateFlow<AppSettings> = repository.settings
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AppSettings())

    val syncProgress: StateFlow<SyncProgress> = repository.syncProgress
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SyncProgress())

    val conversations: StateFlow<List<Conversation>> = combine(
        _selectedFilter,
        _searchQuery
    ) { filter, query -> filter to query }
        .flatMapLatest { (filter, query) -> repository.observeConversations(filter, query) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val folderEmails: StateFlow<List<Conversation>> = combine(
        _selectedFolder,
        _searchQuery
    ) { folder, query -> folder to query }
        .flatMapLatest { (folder, query) -> repository.observeFolderEmails(folder, query) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    init {
        viewModelScope.launch {
            if (oauthManager.hasAuthenticatedSession()) {
                repository.restoreSessionIfAuthenticated().onSuccess { account ->
                    if (account != null) {
                        // Use incremental sync when a historyId checkpoint already exists
                        repository.syncInitialOrIncremental(forceFull = false)
                    }
                }
            }
        }
    }

    fun selectFilter(filter: ConversationFilter) {
        _selectedFilter.value = filter
    }

    fun selectFolder(folder: EmailFolder) {
        _selectedFolder.value = folder
        ensureFolderLoaded(folder)
    }

    fun ensureFolderLoaded(folder: EmailFolder = _selectedFolder.value) {
        if (repository.isFolderLoaded(folder)) return
        loadFolderEmails(folder, loadMore = false)
    }

    fun loadFolderEmails(folder: EmailFolder = _selectedFolder.value, loadMore: Boolean = false) {
        if (_isFolderLoading.value) return
        val cooldown = quotaGuard.remainingCooldownSeconds()
        if (cooldown > 0L) {
            _statusBanner.value = GmailQuotaExceededException.buildFriendlyMessage(cooldown)
            return
        }
        viewModelScope.launch {
            _isFolderLoading.value = true
            repository.loadFolderEmails(folder, loadMore).onFailure { err ->
                _statusBanner.value = if (err is GmailQuotaExceededException) {
                    err.message
                } else {
                    err.message ?: "Failed to load ${folder.label}"
                }
            }
            _isFolderLoading.value = false
        }
    }

    fun setConversationCategory(threadId: String, category: ConversationCategory) {
        viewModelScope.launch {
            repository.setConversationCategory(threadId, category)
            _statusBanner.value = "Moved conversation to ${category.label}"
        }
    }

    fun updateSearchQuery(query: String) {
        _searchQuery.value = query
    }

    fun buildGoogleSignInIntent(): Intent = oauthManager.buildAuthorizationIntent()

    fun buildDriveConsentIntent(): Intent = oauthManager.buildDriveConsentIntent()

    fun handleOAuthResultIntent(intent: Intent?, enableDriveOnSuccess: Boolean = false) {
        if (intent == null) return
        viewModelScope.launch {
            _isSigningIn.value = true
            _authError.value = null
            oauthManager.handleAuthorizationResponse(intent).fold(
                onSuccess = {
                    if (enableDriveOnSuccess && oauthManager.hasDriveScope()) {
                        repository.setDriveFeatureEnabled(true)
                        loadDriveFiles()
                    }
                    repository.completeSignIn().fold(
                        onSuccess = {
                            SyncScheduler.schedulePeriodicSync(app, settings.value.syncIntervalMinutes)
                            repository.syncInitialOrIncremental(forceFull = true)
                        },
                        onFailure = { err ->
                            _authError.value = err.message ?: "Failed to load Gmail profile"
                        }
                    )
                },
                onFailure = { err ->
                    _authError.value = err.message ?: "Google authorization failed"
                }
            )
            _isSigningIn.value = false
        }
    }

    fun observeConversation(threadId: String): Flow<Conversation?> =
        repository.observeConversation(threadId)

    fun observeMessages(threadId: String): Flow<List<ChatMessage>> =
        repository.observeMessages(threadId)

    fun refreshInbox(forceFull: Boolean = false) {
        val now = System.currentTimeMillis()
        val cooldown = quotaGuard.remainingCooldownSeconds(now)
        if (cooldown > 0L) {
            _statusBanner.value = GmailQuotaExceededException.buildFriendlyMessage(cooldown)
            return
        }

        if (now - lastManualRefreshRequestAt < MANUAL_REFRESH_DEBOUNCE_MS) {
            return
        }
        lastManualRefreshRequestAt = now

        refreshDebounceJob?.cancel()
        refreshDebounceJob = viewModelScope.launch {
            delay(350L)
            repository.syncInitialOrIncremental(forceFull)
        }
    }

    fun loadMoreConversations() {
        val cooldown = quotaGuard.remainingCooldownSeconds()
        if (cooldown > 0L) {
            _statusBanner.value = GmailQuotaExceededException.buildFriendlyMessage(cooldown)
            return
        }
        viewModelScope.launch {
            repository.loadMoreConversations().onFailure { err ->
                if (err is GmailQuotaExceededException) {
                    _statusBanner.value = err.message
                }
            }
        }
    }

    fun openConversation(threadId: String) {
        viewModelScope.launch {
            repository.markThreadRead(threadId)
            repository.refreshThread(threadId).onFailure { err ->
                if (err is GmailQuotaExceededException) {
                    _statusBanner.value = err.message
                }
            }
        }
    }

    fun toggleStar(threadId: String, starred: Boolean) {
        viewModelScope.launch {
            repository.toggleStar(threadId, starred).onFailure {
                _statusBanner.value = it.message ?: "Unable to update star state"
            }
        }
    }

    fun toggleArchive(threadId: String, archived: Boolean) {
        viewModelScope.launch {
            repository.toggleArchive(threadId, archived).onFailure {
                _statusBanner.value = it.message ?: "Unable to update archive state"
            }
        }
    }

    fun sendReply(
        threadId: String,
        replyAll: Boolean,
        bodyText: String,
        attachments: List<OutgoingAttachment>,
        onSent: () -> Unit
    ) {
        if (_isSending.value || bodyText.isBlank()) return
        viewModelScope.launch {
            _isSending.value = true
            _statusBanner.value = null
            repository.replyToThread(threadId, replyAll, bodyText.trim(), attachments).fold(
                onSuccess = { onSent() },
                onFailure = { err -> _statusBanner.value = err.message ?: "Failed to send reply" }
            )
            _isSending.value = false
        }
    }

    fun sendNewConversation(
        toEmail: String,
        subject: String,
        bodyText: String,
        attachments: List<OutgoingAttachment>,
        onSuccess: (String) -> Unit
    ) {
        if (_isSending.value) return
        viewModelScope.launch {
            _isSending.value = true
            _statusBanner.value = null
            val recipients = toEmail.split(",").map { it.trim() }.filter { it.isNotBlank() }
            repository.sendNewConversation(recipients, subject.trim(), bodyText.trim(), attachments).fold(
                onSuccess = { msg -> onSuccess(msg.threadId) },
                onFailure = { err -> _statusBanner.value = err.message ?: "Failed to send message" }
            )
            _isSending.value = false
        }
    }

    fun openAttachmentFromGmail(attachment: Attachment) {
        viewModelScope.launch {
            repository.streamAttachmentToTempUri(attachment).fold(
                onSuccess = { uri ->
                    AttachmentHelper.openContentUri(app, uri, attachment.mimeType)
                },
                onFailure = { err ->
                    _statusBanner.value = err.message ?: "Attachment open failed"
                }
            )
        }
    }

    fun saveAttachmentToSaf(attachment: Attachment, destinationUri: Uri) {
        viewModelScope.launch {
            repository.saveAttachmentToSafUri(attachment, destinationUri).fold(
                onSuccess = { _statusBanner.value = "Saved ${attachment.fileName} to device." },
                onFailure = { err -> _statusBanner.value = err.message ?: "Failed to save attachment" }
            )
        }
    }

    fun saveAttachmentToUserDrive(attachment: Attachment) {
        viewModelScope.launch {
            repository.saveAttachmentToUserDrive(attachment).fold(
                onSuccess = { uploaded ->
                    _statusBanner.value = "Saved \"${uploaded.name}\" to your Google Drive."
                    loadDriveFiles()
                },
                onFailure = { err ->
                    _statusBanner.value = err.message ?: "Failed to upload to Google Drive"
                }
            )
        }
    }

    fun loadDriveFiles(query: String = "") {
        viewModelScope.launch {
            _isLoadingDrive.value = true
            repository.listUserDriveFiles(query).fold(
                onSuccess = { _driveFiles.value = it },
                onFailure = { err -> _statusBanner.value = err.message ?: "Failed to list Drive files" }
            )
            _isLoadingDrive.value = false
        }
    }

    fun disableDriveFeature() {
        viewModelScope.launch {
            repository.setDriveFeatureEnabled(false)
            _driveFiles.value = emptyList()
        }
    }

    fun updateTheme(mode: ThemeMode) {
        viewModelScope.launch { repository.updateThemeMode(mode) }
    }

    fun updateNotifications(enabled: Boolean) {
        viewModelScope.launch { repository.updateNotificationsEnabled(enabled) }
    }

    fun updateSyncInterval(minutes: Int) {
        viewModelScope.launch {
            repository.updateSyncInterval(minutes)
            SyncScheduler.schedulePeriodicSync(app, minutes)
        }
    }

    fun clearTemporaryCache() {
        viewModelScope.launch {
            repository.clearTemporaryCache()
            repository.syncInitialOrIncremental(forceFull = true)
        }
    }

    fun disconnectAndLogout() {
        viewModelScope.launch {
            SyncScheduler.cancelPeriodicSync(app)
            repository.disconnectAndLogout()
        }
    }

    fun clearStatusBanner() {
        _statusBanner.value = null
    }

    companion object {
        private const val MANUAL_REFRESH_DEBOUNCE_MS = 1_500L
    }
}

class VartalapViewModelFactory(private val app: VartalapApp) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return VartalapViewModel(app) as T
    }
}
