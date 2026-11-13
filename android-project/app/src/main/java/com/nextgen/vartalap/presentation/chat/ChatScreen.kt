package com.nextgen.vartalap.presentation.chat

import android.annotation.SuppressLint
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Done
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.nextgen.vartalap.domain.Attachment
import com.nextgen.vartalap.domain.ChatMessage
import com.nextgen.vartalap.domain.Conversation
import com.nextgen.vartalap.domain.ConversationCategory
import com.nextgen.vartalap.domain.MessageDirection
import com.nextgen.vartalap.domain.MessageSendStatus
import com.nextgen.vartalap.domain.OutgoingAttachment
import com.nextgen.vartalap.presentation.VartalapViewModel
import com.nextgen.vartalap.presentation.theme.VartalapBubblePalette
import com.nextgen.vartalap.presentation.theme.WarmGold
import com.nextgen.vartalap.presentation.theme.bubblePaletteFor
import com.nextgen.vartalap.utils.AttachmentHelper
import com.nextgen.vartalap.utils.DateFormatter

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ChatScreen(
    threadId: String,
    viewModel: VartalapViewModel,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val conversation by viewModel.observeConversation(threadId).collectAsStateWithLifecycle(initialValue = null)
    val messages by viewModel.observeMessages(threadId).collectAsStateWithLifecycle(initialValue = emptyList())
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val isSending by viewModel.isSending.collectAsStateWithLifecycle()
    val statusBanner by viewModel.statusBanner.collectAsStateWithLifecycle()

    val bubblePalette = bubblePaletteFor(settings.themeMode)

    var composerText by remember { mutableStateOf("") }
    var replyAll by remember { mutableStateOf(false) }
    var showDetailsDialog by remember { mutableStateOf(false) }
    var pendingSafSaveAttachment by remember { mutableStateOf<Attachment?>(null) }
    val pendingAttachments = remember { mutableStateListOf<OutgoingAttachment>() }
    val listState = rememberLazyListState()

    val safOpenPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        uris.forEach { uri ->
            AttachmentHelper.readFromUri(context, uri)?.let { pendingAttachments.add(it) }
        }
    }

    val safCreateDocumentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("*/*")
    ) { destinationUri ->
        val att = pendingSafSaveAttachment
        pendingSafSaveAttachment = null
        if (destinationUri != null && att != null) {
            viewModel.saveAttachmentToSaf(att, destinationUri)
        }
    }

    LaunchedEffect(threadId) {
        viewModel.openConversation(threadId)
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.lastIndex)
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                    }
                },
                title = {
                    Column {
                        Text(
                            text = conversation?.contactName ?: "Conversation",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = conversation?.subject ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                },
                actions = {
                    if (conversation != null) {
                        IconButton(onClick = { showDetailsDialog = true }) {
                            Icon(
                                imageVector = Icons.Outlined.Info,
                                contentDescription = "Conversation Details"
                            )
                        }
                        IconButton(onClick = {
                            viewModel.toggleStar(threadId, !conversation!!.isStarred)
                        }) {
                            Icon(
                                imageVector = if (conversation!!.isStarred) Icons.Outlined.Star else Icons.Outlined.StarOutline,
                                contentDescription = "Toggle Star",
                                tint = if (conversation!!.isStarred) WarmGold else MaterialTheme.colorScheme.onSurface
                            )
                        }
                        IconButton(onClick = {
                            viewModel.toggleArchive(threadId, !conversation!!.isArchived)
                        }) {
                            Icon(
                                imageVector = Icons.Outlined.Archive,
                                contentDescription = "Toggle Archive"
                            )
                        }
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            if (statusBanner != null) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = statusBanner!!,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f)
                        )
                        TextButton(onClick = viewModel::clearStatusBanner) {
                            Text("Dismiss")
                        }
                    }
                }
            }

            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item { Spacer(modifier = Modifier.height(6.dp)) }
                items(messages, key = { it.messageId }) { message ->
                    ChatMessageBubble(
                        message = message,
                        bubblePalette = bubblePalette,
                        driveEnabled = settings.driveFeatureEnabled && viewModel.oauthManager.hasDriveScope(),
                        onOpenAttachment = viewModel::openAttachmentFromGmail,
                        onSaveToDevice = { att ->
                            pendingSafSaveAttachment = att
                            safCreateDocumentLauncher.launch(att.fileName)
                        },
                        onSaveToDrive = viewModel::saveAttachmentToUserDrive
                    )
                }
                item { Spacer(modifier = Modifier.height(6.dp)) }
            }

            Surface(
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 2.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        FilterChip(
                            selected = !replyAll,
                            onClick = { replyAll = false },
                            label = { Text("Reply") }
                        )
                        FilterChip(
                            selected = replyAll,
                            onClick = { replyAll = true },
                            label = { Text("Reply All") }
                        )
                        Spacer(modifier = Modifier.weight(1f))
                        Text(
                            text = "Gmail thread",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    if (pendingAttachments.isNotEmpty()) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                        ) {
                            pendingAttachments.forEachIndexed { idx, att ->
                                Surface(
                                    color = MaterialTheme.colorScheme.surfaceVariant,
                                    shape = RoundedCornerShape(10.dp)
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                    ) {
                                        Text(
                                            text = att.fileName,
                                            style = MaterialTheme.typography.labelSmall,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.widthIn(max = 120.dp)
                                        )
                                        IconButton(
                                            onClick = { pendingAttachments.removeAt(idx) },
                                            modifier = Modifier.size(20.dp)
                                        ) {
                                            Icon(Icons.Outlined.Close, contentDescription = "Remove")
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Row(
                        verticalAlignment = Alignment.Bottom,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        IconButton(onClick = { safOpenPicker.launch(arrayOf("*/*")) }) {
                            Icon(Icons.Outlined.AttachFile, contentDescription = "Attach file")
                        }

                        OutlinedTextField(
                            value = composerText,
                            onValueChange = { composerText = it },
                            placeholder = { Text("Reply via Gmail...") },
                            maxLines = 4,
                            shape = RoundedCornerShape(20.dp),
                            modifier = Modifier.weight(1f)
                        )

                        Spacer(modifier = Modifier.width(6.dp))

                        IconButton(
                            enabled = composerText.isNotBlank() && !isSending,
                            onClick = {
                                viewModel.sendReply(
                                    threadId = threadId,
                                    replyAll = replyAll,
                                    bodyText = composerText,
                                    attachments = pendingAttachments.toList(),
                                    onSent = {
                                        composerText = ""
                                        pendingAttachments.clear()
                                    }
                                )
                            }
                        ) {
                            if (isSending) {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Outlined.Send,
                                    contentDescription = "Send",
                                    tint = MaterialTheme.colorScheme.secondary
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showDetailsDialog && conversation != null) {
        ConversationDetailsDialog(
            conversation = conversation!!,
            latestMessage = messages.lastOrNull(),
            onCategorySelected = { category ->
                viewModel.setConversationCategory(threadId, category)
            },
            onDismiss = { showDetailsDialog = false }
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ConversationDetailsDialog(
    conversation: Conversation,
    latestMessage: ChatMessage?,
    onCategorySelected: (ConversationCategory) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = "Conversation Details",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                DetailRow("Subject", conversation.subject)
                DetailRow("From", latestMessage?.let { "${it.senderName} <${it.senderEmail}>" } ?: conversation.contactEmail)
                DetailRow("To", latestMessage?.recipientEmails?.joinToString(", ")?.ifBlank { "-" } ?: "-")
                if (latestMessage != null && latestMessage.ccEmails.isNotEmpty()) {
                    DetailRow("Cc", latestMessage.ccEmails.joinToString(", "))
                }
                DetailRow("Received", DateFormatter.formatConversationTimestamp(conversation.lastMessageTimestamp))
                DetailRow("Gmail Thread ID", conversation.threadId)
                if (!latestMessage?.rfcMessageIdHeader.isNullOrBlank()) {
                    DetailRow("Message-ID", latestMessage!!.rfcMessageIdHeader!!)
                }
                if (!latestMessage?.inReplyToHeader.isNullOrBlank()) {
                    DetailRow("In-Reply-To", latestMessage!!.inReplyToHeader!!)
                }
                if (!latestMessage?.referencesHeader.isNullOrBlank()) {
                    DetailRow("References", latestMessage!!.referencesHeader!!)
                }

                HorizontalDivider()

                Text(
                    text = "Conversation Category",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    ConversationCategory.entries.forEach { category ->
                        FilterChip(
                            selected = conversation.category == category,
                            onClick = { onCategorySelected(category) },
                            label = { Text(category.label) }
                        )
                    }
                }

                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "Email Transparency: Messages in Vartalap are standard Gmail emails transmitted over HTTPS/TLS via your Google account. They are not end-to-end encrypted chat.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Close")
            }
        }
    )
}

@Composable
private fun DetailRow(label: String, value: String) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
private fun ChatMessageBubble(
    message: ChatMessage,
    bubblePalette: VartalapBubblePalette,
    driveEnabled: Boolean,
    onOpenAttachment: (Attachment) -> Unit,
    onSaveToDevice: (Attachment) -> Unit,
    onSaveToDrive: (Attachment) -> Unit
) {
    val isOutgoing = message.direction == MessageDirection.OUTGOING
    val bubbleColor = if (isOutgoing) bubblePalette.outgoingContainer else bubblePalette.incomingContainer
    val textColor = if (isOutgoing) bubblePalette.outgoingText else bubblePalette.incomingText

    var showQuoted by remember { mutableStateOf(false) }
    var showHtml by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = if (isOutgoing) Alignment.CenterEnd else Alignment.CenterStart
    ) {
        Surface(
            color = bubbleColor,
            shape = RoundedCornerShape(
                topStart = 18.dp,
                topEnd = 18.dp,
                bottomStart = if (isOutgoing) 18.dp else 4.dp,
                bottomEnd = if (isOutgoing) 4.dp else 18.dp
            ),
            tonalElevation = if (isOutgoing) 0.dp else 1.dp,
            modifier = Modifier.widthIn(max = 320.dp)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                if (!isOutgoing) {
                    Text(
                        text = message.senderName,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.secondary
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                }

                if (showHtml && !message.bodyHtmlSanitized.isNullOrBlank()) {
                    SanitizedHtmlEmailView(html = message.bodyHtmlSanitized)
                } else {
                    Text(
                        text = message.bodyPlain,
                        style = MaterialTheme.typography.bodyMedium,
                        color = textColor
                    )
                }

                if (!message.bodyHtmlSanitized.isNullOrBlank()) {
                    TextButton(
                        onClick = { showHtml = !showHtml },
                        modifier = Modifier.padding(top = 2.dp)
                    ) {
                        Text(
                            text = if (showHtml) "Plain text view" else "Rich email view",
                            color = if (isOutgoing) textColor.copy(alpha = 0.9f) else MaterialTheme.colorScheme.secondary
                        )
                    }
                }

                if (!message.quotedText.isNullOrBlank()) {
                    TextButton(onClick = { showQuoted = !showQuoted }) {
                        Text(
                            text = if (showQuoted) "Hide quoted history" else "Show quoted history",
                            color = if (isOutgoing) textColor.copy(alpha = 0.85f) else MaterialTheme.colorScheme.secondary
                        )
                    }
                    if (showQuoted) {
                        Text(
                            text = message.quotedText,
                            style = MaterialTheme.typography.bodySmall,
                            color = textColor.copy(alpha = 0.78f),
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color.Black.copy(alpha = 0.08f), RoundedCornerShape(8.dp))
                                .padding(8.dp)
                        )
                    }
                }

                if (message.attachments.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(6.dp))
                    message.attachments.forEach { attachment ->
                        Surface(
                            color = if (isOutgoing) Color.White.copy(alpha = 0.16f) else MaterialTheme.colorScheme.surfaceVariant,
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 2.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Description,
                                    contentDescription = null,
                                    tint = textColor,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = attachment.fileName,
                                        style = MaterialTheme.typography.labelMedium,
                                        color = textColor,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = DateFormatter.formatReadableBytes(attachment.sizeBytes),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = textColor.copy(alpha = 0.75f)
                                    )
                                }
                                IconButton(
                                    onClick = { onOpenAttachment(attachment) },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        Icons.Outlined.Description,
                                        contentDescription = "Open",
                                        tint = textColor,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                                IconButton(
                                    onClick = { onSaveToDevice(attachment) },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        Icons.Outlined.Download,
                                        contentDescription = "Save via SAF",
                                        tint = textColor,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                                if (driveEnabled) {
                                    IconButton(
                                        onClick = { onSaveToDrive(attachment) },
                                        modifier = Modifier.size(32.dp)
                                    ) {
                                        Icon(
                                            Icons.Outlined.CloudUpload,
                                            contentDescription = "Save to my Google Drive",
                                            tint = textColor,
                                            modifier = Modifier.size(16.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    modifier = Modifier.align(Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = DateFormatter.formatTimeOnly(message.timestampMillis),
                        style = MaterialTheme.typography.labelSmall,
                        color = textColor.copy(alpha = 0.75f)
                    )
                    if (isOutgoing) {
                        val (statusIcon, statusLabel) = when (message.sendStatus) {
                            MessageSendStatus.SENT -> Icons.Outlined.Done to "Sent via Gmail"
                            MessageSendStatus.SENDING -> Icons.Outlined.Schedule to "Sending..."
                            MessageSendStatus.FAILED -> Icons.Outlined.ErrorOutline to "Failed"
                        }
                        Text(
                            text = statusLabel,
                            style = MaterialTheme.typography.labelSmall,
                            color = textColor.copy(alpha = 0.75f)
                        )
                        Icon(
                            imageVector = statusIcon,
                            contentDescription = statusLabel,
                            tint = if (message.sendStatus == MessageSendStatus.FAILED) Color(0xFFFCA5A5) else textColor.copy(alpha = 0.85f),
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SanitizedHtmlEmailView(html: String) {
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.cacheMode = WebSettings.LOAD_NO_CACHE
                settings.blockNetworkLoads = true
                webViewClient = WebViewClient()
                loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
            }
        },
        update = { webView ->
            webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
        },
        modifier = Modifier
            .fillMaxWidth()
            .height(220.dp)
    )
}
