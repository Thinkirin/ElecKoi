package com.eleckoi.unified.android;

import java.io.IOException;
import java.io.InputStream;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Map;

/** One actual token exchange with a request-local cookie jar, independent of WebView. */
final class HostPageHandshake {
    private HostPageHandshake() {}
    static void verify(URL target) throws IOException {
        CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ORIGINAL_SERVER);
        URL current = target;
        for (int redirects = 0; redirects <= 8; redirects++) {
            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            connection.setInstanceFollowRedirects(false);
            try {
                for (Map.Entry<String, List<String>> header : cookies.get(current.toURI(), java.util.Collections.emptyMap()).entrySet()) {
                    for (String value : header.getValue()) connection.addRequestProperty(header.getKey(), value);
                }
                int code = connection.getResponseCode();
                cookies.put(current.toURI(), connection.getHeaderFields());
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) throw new IOException("Host page readiness redirect has no Location");
                    URL next = new URL(current, location);
                    if (!sameOrigin(target, next)) throw new IOException("Host page readiness redirect changes origin");
                    if (redirects == 8) throw new IOException("Host page readiness has too many redirects");
                    current = next;
                    continue;
                }
                if (code < 200 || code >= 300) throw new IOException("Host page readiness HTTP " + code);
                // Reading the final body also detects a truncated or failed response.
                try (InputStream body = connection.getInputStream()) {
                    byte[] buffer = new byte[8192];
                    while (body.read(buffer) != -1) { /* HTTP response only; no UI or global CookieHandler. */ }
                }
                return;
            } catch (URISyntaxException error) {
                throw new IOException("Invalid Host page readiness URL", error);
            } finally {
                connection.disconnect();
            }
        }
        throw new IOException("Host page readiness did not reach its final response");
    }
    private static boolean sameOrigin(URL first, URL second) {
        return first.getProtocol().equalsIgnoreCase(second.getProtocol())
            && first.getHost().equalsIgnoreCase(second.getHost())
            && port(first) == port(second);
    }
    private static int port(URL url) { return url.getPort() < 0 ? url.getDefaultPort() : url.getPort(); }
}
