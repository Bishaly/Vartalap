package com.nextgen.vartalap.gmail

import android.util.Base64
import com.nextgen.vartalap.domain.OutgoingAttachment
import java.io.ByteArrayOutputStream
import java.util.UUID

object MimeMessageBuilder {

    fun buildRawBase64UrlMessage(
        fromEmail: String,
        toEmails: List<String>,
        ccEmails: List<String> = emptyList(),
        subject: String,
        bodyText: String,
        inReplyTo: String? = null,
        references: String? = null,
        attachments: List<OutgoingAttachment> = emptyList()
    ): String {
        val out = ByteArrayOutputStream()
        fun writeLine(line: String = "") {
            out.write((line + "\r\n").toByteArray(Charsets.UTF_8))
        }

        writeLine("From: $fromEmail")
        writeLine("To: ${toEmails.joinToString(", ")}")
        if (ccEmails.isNotEmpty()) {
            writeLine("Cc: ${ccEmails.joinToString(", ")}")
        }
        writeLine("Subject: $subject")
        writeLine("MIME-Version: 1.0")
        if (!inReplyTo.isNullOrBlank()) {
            writeLine("In-Reply-To: $inReplyTo")
        }
        if (!references.isNullOrBlank()) {
            writeLine("References: $references")
        }

        if (attachments.isEmpty()) {
            writeLine("Content-Type: text/plain; charset=\"UTF-8\"")
            writeLine("Content-Transfer-Encoding: 8bit")
            writeLine()
            writeLine(bodyText)
        } else {
            val boundary = "vartalap_${UUID.randomUUID().toString().replace("-", "")}"
            writeLine("Content-Type: multipart/mixed; boundary=\"$boundary\"")
            writeLine()

            writeLine("--$boundary")
            writeLine("Content-Type: text/plain; charset=\"UTF-8\"")
            writeLine("Content-Transfer-Encoding: 8bit")
            writeLine()
            writeLine(bodyText)

            for (attachment in attachments) {
                writeLine("--$boundary")
                val safeName = attachment.fileName.replace("\"", "_")
                writeLine("Content-Type: ${attachment.mimeType}; name=\"$safeName\"")
                writeLine("Content-Disposition: attachment; filename=\"$safeName\"")
                writeLine("Content-Transfer-Encoding: base64")
                writeLine()
                val encodedChunk = Base64.encodeToString(attachment.bytes, Base64.CRLF)
                out.write(encodedChunk.toByteArray(Charsets.US_ASCII))
                if (!encodedChunk.endsWith("\r\n")) {
                    writeLine()
                }
            }

            writeLine("--$boundary--")
        }

        return Base64.encodeToString(
            out.toByteArray(),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
    }
}
