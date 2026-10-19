package com.snowgladys.player;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class AppPolicy {
    public static final String HOME = "https://www.snow-gladys.com/";
    public static final int MAX_EXPORT_BYTES = 2097152;
    private AppPolicy() {}

    public static boolean trusted(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getRawUserInfo() == null &&
                (uri.getPort() == -1 || uri.getPort() == 443) && host != null &&
                ("www.snow-gladys.com".equalsIgnoreCase(host) || "snow-gladys.com".equalsIgnoreCase(host));
        } catch (Exception error) { return false; }
    }

    public static boolean external(String value) {
        try {
            String scheme = new URI(value).getScheme();
            return "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme) ||
                "bilibili".equalsIgnoreCase(scheme) || "mailto".equalsIgnoreCase(scheme);
        } catch (Exception error) { return false; }
    }

    public static String filename(String value) {
        if (value == null) return null;
        String clean = value.replaceAll("[\\\\/\\p{Cntrl}]", "_").trim();
        String lower = clean.toLowerCase(Locale.ROOT);
        if (!(lower.endsWith(".txt") || lower.endsWith(".lrc") || lower.endsWith(".json"))) return null;
        int dot = clean.lastIndexOf('.');
        if (dot <= 0) return null;
        return clean.length() <= 100 ? clean : clean.substring(0, 90) + clean.substring(dot);
    }

    public static byte[] exportBytes(String text) {
        if (text == null || text.length() > MAX_EXPORT_BYTES) return null;
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        return bytes.length <= MAX_EXPORT_BYTES ? bytes : null;
    }
}
