package com.nextgen.vartalap.gmail

import android.util.Base64
import com.nextgen.vartalap.domain.Attachment
import com.nextgen.vartalap.domain.ChatMessage
import com.nextgen.vartalap.domain.MessageDirection
import com.nextgen.vartalap.domain.MessageSendStatus
import com.nextgen.vartalap.gmail.dto.GmailMessageDto
import com.nextgen.vartalap.gmail.dto.GmailMessagePartDto
import com.nextgen.vartalap.security.HtmlSanitizer

data class ParsedEmailAddress(
    val displayName: String,
    val email: String
)

object MimeParser {

    fun decodeBase64Url(data: String?): ByteArray {
        if (data.isNullOrBlank()) return ByteArray(0)
        return Base64.decode(data, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    fun decodeBase64UrlText(data: String?): String {
        val bytes = decodeBase64Url(data)
        return if (bytes.isEmpty()) "" else String(bytes, Charsets.UTF_8)
    }

    fun parseAddressList(raw: String?): List<ParsedEmailAddress> {
        if (raw.isNullOrBlank()) return emptyList()
        return raw.split(",").mapNotNull { entry ->
            val trimmed = entry.trim()
            if (trimmed.isEmpty()) return@mapNotNull null
            val angleStart = trimmed.lastIndexOf('<')
            val angleEnd = trimmed.lastIndexOf('>')
            if (angleStart in 0 until angleEnd) {
                val email = trimmed.substring(angleStart + 1, angleEnd).trim()
                val name = trimmed.substring(0, angleStart).trim().trim('"').ifBlank {
                    email.substringBefore("@")
                }
                ParsedEmailAddress(displayName = name, email = email)
            } else {
                val email = trimmed.trim('"')
                ParsedEmailAddress(displayName = email.substringBefore("@"), email = email)
            }
        }
    }

    fun parseMessage(
        dto: GmailMessageDto,
        accountEmail: String
    ): ChatMessage {
        val headers = dto.payload?.headers.orEmpty()
        fun header(name: String): String? =
            headers.firstOrNull { it.name.equals(name, ignoreCase = true) }?.value

        val fromParsed = parseAddressList(header("From")).firstOrNull()
            ?: ParsedEmailAddress(displayName = "Unknown", email = "")
        val toList = parseAddressList(header("To")).map { it.email }
        val ccList = parseAddressList(header("Cc")).map { it.email }

        val subject = header("Subject").orEmpty().ifBlank { "(No subject)" }
        val rfcMessageId = header("Message-ID") ?: header("Message-Id")
        val inReplyTo = header("In-Reply-To")
        val references = header("References")
        val timestampMillis = dto.internalDate?.toLongOrNull() ?: System.currentTimeMillis()

        val listUnsubscribe = header("List-Unsubscribe")
        val precedence = header("Precedence").orEmpty().lowercase()
        val autoSubmitted = header("Auto-Submitted").orEmpty().lowercase()
        val senderLocal = fromParsed.email.lowercase()

        val labelIds = dto.labelIds.orEmpty()
        val isAutomatedByLabels = labelIds.any {
            it == "CATEGORY_PROMOTIONS" || it == "CATEGORY_UPDATES" || it == "CATEGORY_SOCIAL" || it == "CATEGORY_FORUMS"
        }
        val isAutomatedByHeaders = !listUnsubscribe.isNullOrBlank() ||
            precedence in setOf("bulk", "list", "junk") ||
            (autoSubmitted.isNotBlank() && autoSubmitted != "no") ||
            senderLocal.startsWith("noreply@") ||
            senderLocal.startsWith("no-reply@") ||
            senderLocal.startsWith("notifications@")

        val isOutgoing = labelIds.contains("SENT") ||
            fromParsed.email.equals(accountEmail, ignoreCase = true)
        val isUnread = labelIds.contains("UNREAD")

        val plainCollector = StringBuilder()
        val htmlCollector = StringBuilder()
        val attachments = mutableListOf<Attachment>()

        fun walkParts(part: GmailMessagePartDto?) {
            if (part == null) return
            val mime = part.mimeType.orEmpty().lowercase()
            val filename = part.filename.orEmpty()
            val attachmentId = part.body?.attachmentId

            if (filename.isNotBlank() && attachmentId != null) {
                attachments.add(
                    Attachment(
                        id = "${dto.id}_$attachmentId",
                        messageId = dto.id,
                        gmailAttachmentId = attachmentId,
                        fileName = filename,
                        mimeType = mime.ifBlank { "application/octet-stream" },
                        sizeBytes = part.body.size ?: 0L,
                        tempLocalUri = null
                    )
                )
            } else if (mime == "text/plain" && part.body?.data != null) {
                if (plainCollector.isNotEmpty()) plainCollector.append("\n")
                plainCollector.append(decodeBase64UrlText(part.body.data))
            } else if (mime == "text/html" && part.body?.data != null) {
                htmlCollector.append(decodeBase64UrlText(part.body.data))
            }

            part.parts.orEmpty().forEach { child -> walkParts(child) }
        }

        walkParts(dto.payload)

        val rawPlain = plainCollector.toString().ifBlank {
            if (htmlCollector.isNotEmpty()) {
                HtmlSanitizer.htmlToPlainText(htmlCollector.toString())
            } else {
                dto.snippet.orEmpty()
            }
        }

        val (mainBody, quotedBody) = splitQuotedReply(rawPlain)
        val sanitizedHtml = if (htmlCollector.isNotEmpty()) {
            HtmlSanitizer.sanitizeEmailHtml(htmlCollector.toString())
        } else {
            null
        }

        return ChatMessage(
            messageId = dto.id,
            threadId = dto.threadId,
            senderName = fromParsed.displayName,
            senderEmail = fromParsed.email,
            recipientEmails = toList,
            ccEmails = ccList,
            subject = subject,
            bodyPlain = mainBody.ifBlank { rawPlain },
            bodyHtmlSanitized = sanitizedHtml,
            quotedText = quotedBody,
            timestampMillis = timestampMillis,
            direction = if (isOutgoing) MessageDirection.OUTGOING else MessageDirection.INCOMING,
            sendStatus = MessageSendStatus.SENT,
            isRead = !isUnread,
            labelIds = labelIds,
            rfcMessageIdHeader = rfcMessageId,
            inReplyToHeader = inReplyTo,
            referencesHeader = references,
            isAutomatedHeader = isAutomatedByLabels || isAutomatedByHeaders,
            attachments = attachments
        )
    }

    private fun splitQuotedReply(plainText: String): Pair<String, String?> {
        val lines = plainText.lines()
        val splitIndex = lines.indexOfFirst { line ->
            val trimmed = line.trim()
            (trimmed.startsWith("On ") && trimmed.endsWith("wrote:")) ||
                trimmed == "-----Original Message-----" ||
                trimmed.startsWith("> ")
        }
        if (splitIndex <= 0) return plainText.trim() to null
        val main = lines.subList(0, splitIndex).joinToString("\n").trim()
        val quoted = lines.subList(splitIndex, lines.size).joinToString("\n").trim()
        return main to quoted.ifBlank { null }
    }
}
