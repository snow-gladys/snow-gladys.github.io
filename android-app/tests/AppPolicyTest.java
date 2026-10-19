import com.snowgladys.player.AppPolicy;

public final class AppPolicyTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        for (String url : new String[]{"https://www.snow-gladys.com/", "https://snow-gladys.com/fiona/?x=1", "https://WWW.SNOW-GLADYS.COM:443/"}) check(AppPolicy.trusted(url));
        for (String url : new String[]{null, "http://www.snow-gladys.com/", "https://www.snow-gladys.com.evil.test/", "https://user@www.snow-gladys.com/", "https://www.snow-gladys.com:444/", "file:///test", "javascript:alert(1)", "//www.snow-gladys.com/"}) check(!AppPolicy.trusted(url));
        check(AppPolicy.external("bilibili://video/BV1234567890"));
        check(!AppPolicy.external("intent://anything"));
        check(!AppPolicy.external("content://anything"));
        check("歌曲.lrc".equals(AppPolicy.filename("歌曲.lrc")));
        check(!AppPolicy.filename("../歌曲.lrc").contains("/"));
        check(AppPolicy.filename("file.apk") == null);
        check(AppPolicy.filename(".txt") == null);
        check(AppPolicy.filename(new String(new char[200]).replace('\0', 'a') + ".json").endsWith(".json"));
        check(AppPolicy.exportBytes("你好").length == 6);
        check(AppPolicy.exportBytes(new String(new char[800000]).replace('\0', '你')) == null);
        check(AppPolicy.exportBytes(null) == null);
        System.out.println("AppPolicy: URL boundaries, filenames and UTF-8 export size checks passed.");
    }
}
