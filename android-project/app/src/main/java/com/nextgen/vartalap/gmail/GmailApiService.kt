package com.nextgen.vartalap.gmail

import com.nextgen.vartalap.gmail.dto.GmailAttachmentResponse
import com.nextgen.vartalap.gmail.dto.GmailHistoryListResponse
import com.nextgen.vartalap.gmail.dto.GmailMessageDto
import com.nextgen.vartalap.gmail.dto.GmailModifyRequest
import com.nextgen.vartalap.gmail.dto.GmailProfileDto
import com.nextgen.vartalap.gmail.dto.GmailSendRequest
import com.nextgen.vartalap.gmail.dto.GmailThreadDto
import com.nextgen.vartalap.gmail.dto.GmailThreadListResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface GmailApiService {

    @GET("gmail/v1/users/me/profile")
    suspend fun getProfile(): GmailProfileDto

    @GET("gmail/v1/users/me/threads")
    suspend fun listThreads(
        @Query("maxResults") maxResults: Int = 15,
        @Query("pageToken") pageToken: String? = null,
        @Query("q") query: String? = null,
        @Query("labelIds") labelIds: List<String>? = null,
        @Query("includeSpamTrash") includeSpamTrash: Boolean = false
    ): GmailThreadListResponse

    @GET("gmail/v1/users/me/threads/{id}")
    suspend fun getThread(
        @Path("id") threadId: String,
        @Query("format") format: String = "full",
        @Query("metadataHeaders") metadataHeaders: List<String>? = null
    ): GmailThreadDto

    @GET("gmail/v1/users/me/messages/{id}")
    suspend fun getMessage(
        @Path("id") messageId: String,
        @Query("format") format: String = "full"
    ): GmailMessageDto

    @GET("gmail/v1/users/me/messages/{messageId}/attachments/{id}")
    suspend fun getAttachment(
        @Path("messageId") messageId: String,
        @Path("id") attachmentId: String
    ): GmailAttachmentResponse

    @POST("gmail/v1/users/me/messages/send")
    suspend fun sendMessage(
        @Body request: GmailSendRequest
    ): GmailMessageDto

    @POST("gmail/v1/users/me/threads/{id}/modify")
    suspend fun modifyThread(
        @Path("id") threadId: String,
        @Body request: GmailModifyRequest
    ): GmailThreadDto

    @GET("gmail/v1/users/me/history")
    suspend fun listHistory(
        @Query("startHistoryId") startHistoryId: String,
        @Query("pageToken") pageToken: String? = null,
        @Query("maxResults") maxResults: Int = 100,
        @Query("historyTypes") historyTypes: List<String>? = null
    ): GmailHistoryListResponse
}
