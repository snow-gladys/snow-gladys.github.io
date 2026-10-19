package com.snowgladys.player;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int PICK_FILE = 100, SAVE_FILE = 101;
    private static WeakReference<MainActivity> current = new WeakReference<>(null);
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private WebView browser;
    private FrameLayout root;
    private LinearLayout errorView;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingExport;
    private String page = AppPolicy.HOME, bridgeScript = "";
    private boolean hasPlaybackService = false;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        current = new WeakReference<>(this);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(248, 249, 252));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return insets;
            });
        }
        setContentView(root);
        try (InputStream input = getAssets().open("bridge.js")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            bridgeScript = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception error) { toast("播放器组件读取失败，请重新安装。"); }
        createBrowser();
        if (saved == null || browser.restoreState(saved) == null || !AppPolicy.trusted(browser.getUrl())) browser.loadUrl(page);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::handleBack);
    }

    private void createBrowser() {
        browser = new WebView(this);
        browser.setBackgroundColor(Color.rgb(248, 249, 252));
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " GladysPlayer/0.2.1");
        WebView.setWebContentsDebuggingEnabled(false);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false);
        browser.addJavascriptInterface(new NativeBridge(), "GladysNative");
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (AppPolicy.trusted(request.getUrl().toString())) return false;
                if (request.isForMainFrame()) openExternal(request.getUrl().toString());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!AppPolicy.trusted(url)) { view.stopLoading(); return; }
                page = url;
                if (errorView != null) errorView.setVisibility(View.GONE);
                view.setVisibility(View.VISIBLE);
            }
            @Override public void onPageCommitVisible(WebView view, String url) { injectBridge(url); }
            @Override public void onPageFinished(WebView view, String url) { injectBridge(url); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) showError();
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                root.removeView(view); view.destroy(); browser = null;
                stopService(new Intent(MainActivity.this, PlaybackService.class));
                showError(); return true;
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!AppPolicy.trusted(view.getUrl())) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(picker, PICK_FILE); }
                catch (ActivityNotFoundException error) { fileCallback.onReceiveValue(null); fileCallback = null; toast("未找到文件选择器。"); }
                return true;
            }
        });
        browser.setDownloadListener((url, agent, disposition, type, length) -> {
            if (AppPolicy.external(url)) openExternal(url);
            else toast("该文件暂时无法导出，请在浏览器中重试。");
        });
        root.addView(browser, new FrameLayout.LayoutParams(-1, -1));
    }

    private void injectBridge(String url) {
        if (browser != null && AppPolicy.trusted(url) && AppPolicy.trusted(browser.getUrl()) && !bridgeScript.isEmpty()) browser.evaluateJavascript(bridgeScript, null);
    }

    private void showError() {
        if (browser != null) browser.setVisibility(View.INVISIBLE);
        if (errorView == null) {
            errorView = new LinearLayout(this); errorView.setOrientation(LinearLayout.VERTICAL);
            errorView.setGravity(Gravity.CENTER); errorView.setPadding(40, 40, 40, 40);
            errorView.setBackgroundColor(Color.rgb(248, 249, 252));
            TextView heading = new TextView(this); heading.setText("暂时无法打开播放器"); heading.setTextSize(21);
            TextView detail = new TextView(this); detail.setText("请检查网络连接后重试。"); detail.setPadding(0, 24, 0, 32);
            Button retry = new Button(this); retry.setText("重新加载");
            retry.setOnClickListener(view -> { if (browser == null) createBrowser(); browser.loadUrl(AppPolicy.trusted(page) ? page : AppPolicy.HOME); });
            Button external = new Button(this); external.setText("在浏览器中打开"); external.setOnClickListener(view -> openExternal(AppPolicy.HOME));
            errorView.addView(heading); errorView.addView(detail); errorView.addView(retry); errorView.addView(external);
            root.addView(errorView, new FrameLayout.LayoutParams(-1, -1));
        }
        errorView.setVisibility(View.VISIBLE); errorView.bringToFront();
    }

    private void openExternal(String url) {
        if (!AppPolicy.external(url)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) { toast("未找到可以打开此链接的应用。"); }
    }

    private void handleBack() {
        if (browser == null || !AppPolicy.trusted(browser.getUrl())) { moveTaskToBack(true); return; }
        browser.evaluateJavascript("window.__SG_ANDROID_BACK ? window.__SG_ANDROID_BACK() : false", result -> {
            if ("true".equals(result)) return;
            if (browser != null && browser.canGoBack()) browser.goBack(); else moveTaskToBack(true);
        });
    }
    @Override public void onBackPressed() { handleBack(); }
    @Override public void onSaveInstanceState(Bundle saved) { super.onSaveInstanceState(saved); if (browser != null) browser.saveState(saved); }
    @Override public void onResume() { super.onResume(); if (browser != null) browser.evaluateJavascript("window.__SG_ANDROID_PING && window.__SG_ANDROID_PING()", null); }
    @Override public void onDestroy() {
        if (current.get() == this) current.clear();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        pendingExport = null;
        stopService(new Intent(this, PlaybackService.class));
        if (browser != null) { browser.removeJavascriptInterface("GladysNative"); browser.stopLoading(); browser.destroy(); }
        files.shutdown(); super.onDestroy();
    }

    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show(); }

    public static boolean dispatchPlayback(String action, long position) {
        MainActivity activity = current.get();
        if (activity == null || activity.isDestroyed() || activity.browser == null) return false;
        activity.runOnUiThread(() -> {
            if (activity.browser == null || !AppPolicy.trusted(activity.browser.getUrl())) return;
            String command;
            switch (action) {
                case "play": command = "if (typeof bgmAudio !== 'undefined' && bgmAudio.paused) togglePlayback();"; break;
                case "pause": command = "if (typeof bgmAudio !== 'undefined' && !bgmAudio.paused) togglePlayback();"; break;
                case "next": command = "if (typeof goNext === 'function') goNext();"; break;
                case "previous": command = "if (typeof goPrev === 'function') goPrev();"; break;
                case "seek": command = "if(typeof bgmAudio !== 'undefined' && Number.isFinite(bgmAudio.duration)) bgmAudio.currentTime = Math.min(bgmAudio.duration," + Math.max(0, position) + "/1000);"; break;
                default: return;
            }
            activity.browser.evaluateJavascript("(function(){if(window.SG_MEDIA_ACTION && window.SG_MEDIA_ACTION(" + JSONObject.quote(action) + "))return;" + command + "})()", null);
        });
        return true;
    }
    public static void playbackServiceStopped() { MainActivity activity = current.get(); if (activity != null) activity.hasPlaybackService = false; }

    private final class NativeBridge {
        @JavascriptInterface public void saveText(String name, String text) {
            final String filename = AppPolicy.filename(name);
            final byte[] bytes = AppPolicy.exportBytes(text);
            runOnUiThread(() -> {
                if (browser == null || !AppPolicy.trusted(browser.getUrl()) || isDestroyed()) return;
                if (filename == null || bytes == null) { toast("文件格式不支持或过大，请在浏览器中导出。"); return; }
                if (pendingExport != null) { toast("请先完成当前文件的保存。"); return; }
                pendingExport = bytes;
                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(filename.toLowerCase(java.util.Locale.ROOT).endsWith(".json") ? "application/json" : "text/plain")
                    .putExtra(Intent.EXTRA_TITLE, filename);
                try { startActivityForResult(save, SAVE_FILE); }
                catch (ActivityNotFoundException error) { pendingExport = null; toast("未找到文件保存窗口。"); }
            });
        }
        @JavascriptInterface public void mediaState(String value) {
            if (value == null || value.length() > 4096) return;
            runOnUiThread(() -> {
                if (browser == null || !AppPolicy.trusted(browser.getUrl()) || isDestroyed()) return;
                try {
                    JSONObject data = new JSONObject(value);
                    boolean playing = data.optBoolean("playing", false);
                    if (!playing && !hasPlaybackService) return;
                    Intent state = new Intent(MainActivity.this, PlaybackService.class).setAction(PlaybackService.STATE)
                        .putExtra("playing", playing).putExtra("title", data.optString("title", getString(R.string.app_name)))
                        .putExtra("artist", data.optString("artist", getString(R.string.app_name)))
                        .putExtra("position", Math.max(0, data.optLong("position", 0))).putExtra("duration", Math.max(0, data.optLong("duration", 0)));
                    if (playing && !hasPlaybackService) startForegroundService(state); else startService(state);
                    hasPlaybackService = true;
                } catch (Exception error) { /* 网页播放继续；系统不允许启动后台服务时不崩溃。 */ }
            });
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && fileCallback != null) {
            ArrayList<Uri> files = new ArrayList<>();
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    Uri uri = data.getClipData().getItemAt(i).getUri(); if ("content".equals(uri.getScheme())) files.add(uri);
                }
                else if (data.getData() != null && "content".equals(data.getData().getScheme())) files.add(data.getData());
            }
            fileCallback.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0])); fileCallback = null;
        } else if (request == SAVE_FILE) {
            byte[] bytes = pendingExport; pendingExport = null;
            Uri destination = data == null ? null : data.getData();
            if (result != RESULT_OK || bytes == null || destination == null || !"content".equals(destination.getScheme())) return;
            files.execute(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                    if (output == null) throw new java.io.IOException("No output");
                    output.write(bytes);
                    runOnUiThread(() -> { if (!isDestroyed()) toast("文件已保存。"); });
                } catch (Exception error) { runOnUiThread(() -> { if (!isDestroyed()) toast("保存失败，请重试。"); }); }
            });
        }
    }
}
