package com.nextgen.vartalap.gmail.dto

import kotlinx.serialization.Serializable

@Serializable
data class GmailProfileDto(
    val emailAddress: String,
    val messagesTotal: Long = 0,
    val threadsTotal: Long = 0,
    val historyId: String? = null
)

@Serializable
data class GmailThreadListResponse(
    val threads: List<GmailThreadSummaryDto>? = null,
    val nextPageToken: String? = null,
    val resultSizeEstimate: Int = 0
)

@Serializable
data class GmailThreadSummaryDto(
    val id: String,
    val snippet: String? = null,
    val historyId: String? = null
)

@Serializable
data class GmailThreadDto(
    val id: String,
    val historyId: String? = null,
    val messages: List<GmailMessageDto>? = null
)

@Serializable
data class GmailMessageDto(
    val id: String,
    val threadId: String,
    val labelIds: List<String>? = null,
    val snippet: String? = null,
    val historyId: String? = null,
    val internalDate: String? = null,
    val payload: GmailMessagePartDto? = null,
    val sizeEstimate: Long? = null
)

@Serializable
data class GmailMessagePartDto(
    val partId: String? = null,
    val mimeType: String? = null,
    val filename: String? = null,
    val headers: List<GmailHeaderDto>? = null,
    val body: GmailBodyDto? = null,
    val parts: List<GmailMessagePartDto>? = null
)

@Serializable
data class GmailHeaderDto(
    val name: String,
    val value: String
)

@Serializable
data class GmailBodyDto(
    val attachmentId: String? = null,
    val size: Long? = null,
    val data: String? = null
)

@Serializable
data class GmailAttachmentResponse(
    val size: Long? = null,
    val data: String? = null
)

@Serializable
data class GmailSendRequest(
    val raw: String,
    val threadId: String? = null
)

@Serializable
data class GmailModifyRequest(
    val addLabelIds: List<String> = emptyList(),
    val removeLabelIds: List<String> = emptyList()
)

@Serializable
data class GmailHistoryListResponse(
    val history: List<GmailHistoryRecordDto>? = null,
    val nextPageToken: String? = null,
    val historyId: String? = null
)

@Serializable
data class GmailHistoryRecordDto(
    val id: String,
    val messagesAdded: List<GmailHistoryMessageAddedDto>? = null,
    val labelsAdded: List<GmailHistoryLabelChangeDto>? = null,
    val labelsRemoved: List<GmailHistoryLabelChangeDto>? = null
)

@Serializable
data class GmailHistoryMessageAddedDto(
    val message: GmailMessageDto
)

@Serializable
data class GmailHistoryLabelChangeDto(
    val message: GmailMessageDto,
    val labelIds: List<String>? = null
)
