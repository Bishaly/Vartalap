package com.nextgen.vartalap.security

import org.jsoup.Jsoup
import org.jsoup.safety.Safelist

object HtmlSanitizer {

    private val emailSafelist: Safelist = Safelist.relaxed()
        .removeTags("script", "iframe", "object", "embed", "form", "input", "button", "style")
        .addAttributes("a", "href", "title")
        .addProtocols("a", "href", "http", "https", "mailto")
        .addAttributes("img", "src", "alt", "width", "height")
        .addProtocols("img", "src", "https", "cid", "data")
        .preserveRelativeLinks(false)

    fun sanitizeEmailHtml(rawHtml: String): String {
        if (rawHtml.isBlank()) return ""
        val doc = Jsoup.parseBodyFragment(rawHtml)
        doc.select("script, style, iframe, object, embed, meta, link, base").remove()
        doc.select("*").forEach { element ->
            val attrs = element.attributes().asList().map { it.key }
            for (attr in attrs) {
                if (attr.startsWith("on", ignoreCase = true)) {
                    element.removeAttr(attr)
                }
            }
            if (element.tagName() == "a") {
                val href = element.attr("href")
                if (href.startsWith("javascript:", ignoreCase = true) ||
                    href.startsWith("vbscript:", ignoreCase = true)
                ) {
                    element.removeAttr("href")
                }
            }
        }
        return Jsoup.clean(doc.body().html(), emailSafelist)
    }

    fun htmlToPlainText(rawHtml: String): String {
        if (rawHtml.isBlank()) return ""
        val cleaned = sanitizeEmailHtml(rawHtml)
        return Jsoup.parse(cleaned).text().trim()
    }
}
