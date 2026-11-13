package com.nextgen.vartalap.drive

import com.nextgen.vartalap.authentication.GoogleOAuthManager
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

@Serializable
data class DriveFileListResponse(
    val files: List<DriveFileDto> = emptyList(),
    val nextPageToken: String? = null
)

@Serializable
data class DriveFileDto(
    val id: String,
    val name: String,
    val mimeType: String,
    val size: String? = null,
    val modifiedTime: String? = null,
    val webViewLink: String? = null
)

interface GoogleDriveApiService {

    @GET("drive/v3/files")
    suspend fun listFiles(
        @Query("q") query: String = "trashed = false",
        @Query("pageSize") pageSize: Int = 30,
        @Query("fields") fields: String = "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)",
        @Query("orderBy") orderBy: String = "modifiedTime desc"
    ): DriveFileListResponse

    @Streaming
    @GET("drive/v3/files/{fileId}?alt=media")
    suspend fun downloadFileContent(
        @Path("fileId") fileId: String
    ): ResponseBody

    @Multipart
    @POST("upload/drive/v3/files?uploadType=multipart")
    suspend fun uploadMultipartFile(
        @Part metadata: MultipartBody.Part,
        @Part media: MultipartBody.Part
    ): DriveFileDto
}

object GoogleDriveNetworkClient {
    private const val BASE_URL = "https://www.googleapis.com/"

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    fun createApiService(oauthManager: GoogleOAuthManager): GoogleDriveApiService {
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val token = runBlocking { oauthManager.getValidAccessToken() }
                val req = if (!token.isNullOrBlank()) {
                    chain.request().newBuilder()
                        .header("Authorization", "Bearer $token")
                        .build()
                } else {
                    chain.request()
                }
                chain.proceed(req)
            }
            .build()

        return Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(GoogleDriveApiService::class.java)
    }

    fun buildUploadParts(
        fileName: String,
        mimeType: String,
        bytes: ByteArray
    ): Pair<MultipartBody.Part, MultipartBody.Part> {
        val escapedName = fileName.replace("\"", "\\\"")
        val metadataJson = """{"name":"$escapedName"}"""
        val metadataPart = MultipartBody.Part.create(
            metadataJson.toRequestBody("application/json; charset=UTF-8".toMediaType())
        )
        val mediaPart = MultipartBody.Part.create(
            bytes.toRequestBody(mimeType.toMediaType())
        )
        return metadataPart to mediaPart
    }
}
