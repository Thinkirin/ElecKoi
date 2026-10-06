package com.eleckoi.unified.android;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.*;
import android.webkit.CookieManager;
import android.widget.*;
import android.view.*;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Platform UI only. The real Host owns pages, accounts, products and conversations. */
public final class MainActivity extends Activity implements HostRuntimeService.Listener {
    private static final int PICK_FILES = 20, SAVE_FILE = 21, NOTIFICATIONS = 22;
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private HostRuntimeService runtime;
    private boolean bound;
    private WebView web;
    private FrameLayout page;
    private TextView status;
    private LinearLayout runtimePanel;
    private String loadedUrl = "";
    private boolean appearanceDark;
    private int appearanceBackground = Color.rgb(245, 245, 245);
    private int appearanceSurface = Color.WHITE;
    private int appearanceForeground = Color.rgb(22, 22, 22);
    private int appearanceBorder = Color.rgb(184, 184, 184);
    private AlertDialog diagnosticsDialog;
    private ValueCallback<Uri[]> fileChoice;
    private PendingSave pendingSave;
    private String platformSource;
    private ScriptHandler platformDocumentScript;
    private SystemSpeech systemSpeech;
    private final ConcurrentMap<String, StagedSave> stagedSaves = new ConcurrentHashMap<>();
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            runtime = ((HostRuntimeService.LocalBinder) binder).service(); runtime.observe(MainActivity.this);
        }
        @Override public void onServiceDisconnected(ComponentName name) { runtime = null; showFailure("Host 服务连接断开"); }
    };
    private static final class PendingSave {
        final String requestId, name, mimeType, text, downloadUrl;
        final File source;
        PendingSave(String id, String name, String mime, String text, String download, File source) {
            requestId=id; this.name=name; mimeType=mime; this.text=text; downloadUrl=download; this.source=source;
        }
    }
    private static final class StagedSave {
        final PendingSave request;
        final OutputStream output;
        StagedSave(PendingSave request, OutputStream output) { this.request=request; this.output=output; }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        systemSpeech = new SystemSpeech(this, this::platformResult);
        page = new FrameLayout(this);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        page.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        runtimePanel = new LinearLayout(this); runtimePanel.setOrientation(LinearLayout.VERTICAL); runtimePanel.setElevation(0f);
        runtimePanel.setPadding(dp(20), dp(16), dp(20), dp(16));
        TextView brand = new TextView(this); brand.setText("ElecKoi"); brand.setTextSize(20); brand.setTypeface(null, android.graphics.Typeface.BOLD); brand.setLetterSpacing(.01f); runtimePanel.addView(brand);
        status = new TextView(this); status.setTextSize(14); status.setLineSpacing(dp(3), 1f); status.setPadding(0, dp(8), 0, dp(10)); status.setText("正在准备运行环境…");
        runtimePanel.addView(status);
        LinearLayout actions = new LinearLayout(this);
        actions.addView(button("重试 / 重启", () -> startRuntime(HostRuntimeService.RESTART)));
        actions.addView(button("运行详情", this::showDiagnostics));
        actions.addView(button("通知设置", this::notificationSettings));
        actions.setGravity(Gravity.CENTER_VERTICAL); actions.setPadding(0, dp(2), 0, 0);
        runtimePanel.addView(actions, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        applyAppearance((getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES, null);
        web = new WebView(this); web.setBackgroundColor(appearanceBackground);
        try (InputStream source = getAssets().open("platform-facade.js")) {
            platformSource = RuntimeInstaller.readText(source);
        } catch (IOException error) { throw new IllegalStateException("Packaged platform facade missing", error); }
        // Both dimensions must be MATCH_PARENT; wrap_content forces Blink's ICB height to zero.
        web.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true); settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new PlatformBridge(), "ElecKoiAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                if (sameHost(request.getUrl().toString())) return false;
                openExternal(request.getUrl().toString()); return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                installPlatform(view, url);
            }
            @Override public void onPageCommitVisible(WebView view, String url) {
                installPlatform(view, url);
            }
            private void installPlatform(WebView view, String url) {
                if (sameHost(url)) {
                    view.evaluateJavascript(platformSource, null);
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showFailure("页面加载失败：" + error.getDescription());
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showFailure("页面 HTTP " + response.getStatusCode());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams options) {
                if (fileChoice != null) fileChoice.onReceiveValue(null);
                fileChoice = callback;
                Intent choose = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                String[] types = options.getAcceptTypes();
                if (types.length > 0 && !types[0].trim().isEmpty()) choose.putExtra(Intent.EXTRA_MIME_TYPES, types);
                choose.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, options.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                if (options.getMode() == FileChooserParams.MODE_SAVE)
                    choose = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(types.length > 0 && !types[0].trim().isEmpty() ? types[0] : "application/octet-stream").putExtra(Intent.EXTRA_TITLE, options.getFilenameHint());
                try { startActivityForResult(choose, PICK_FILES); }
                catch (Exception error) { fileChoice.onReceiveValue(null); fileChoice = null; showFailure("文件选择失败：" + error.getMessage()); }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            String name = URLUtil.guessFileName(url, disposition, mime);
            String type = mime == null ? "application/octet-stream" : mime;
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                web.evaluateJavascript("window.ElecKoiPlatform.saveUrl(" + JSONObject.quote(name) + "," + JSONObject.quote(url) + "," + JSONObject.quote(type) + ").catch(e=>ElecKoiAndroid.reportError(String(e)));", null);
                return;
            }
            beginSave(new PendingSave("download-" + System.nanoTime(), name, type, null, url, null));
        });
        page.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        page.addView(runtimePanel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        setContentView(page);
        page.requestApplyInsets();
        // UI development uses the same Android WebView and platform bridge,
        // connected to a local shared Host via adb reverse. It does not claim
        // that the emulator ran the ARM64 PRoot distribution.
        String previewUrl = getIntent().getStringExtra("eleckoi.previewUrl");
        if (previewUrl != null && (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            Uri preview = Uri.parse(previewUrl);
            if (!"http".equals(preview.getScheme()) || !"127.0.0.1".equals(preview.getHost()))
                throw new IllegalArgumentException("WebClient preview requires a local adb-reversed Host URL");
            runtimePanel.setVisibility(View.GONE);
            loadHostPage(previewUrl);
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            && !getPreferences(MODE_PRIVATE).getBoolean("notificationRequested", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("notificationRequested", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS);
        }
        startRuntime(HostRuntimeService.START);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private GradientDrawable panelButtonBackground(boolean primary) {
        GradientDrawable drawable = new GradientDrawable(); drawable.setCornerRadius(dp(10));
        int accent = appearanceDark ? Color.rgb(142, 179, 255) : Color.rgb(40, 93, 216);
        drawable.setColor(primary ? accent : Color.TRANSPARENT);
        drawable.setStroke(dp(1), primary ? accent : appearanceBorder);
        return drawable;
    }
    private void themeNativeChildren(View view) {
        if (view instanceof Button) {
            Button button = (Button) view;
            boolean primary = "primary".equals(button.getTag());
            button.setTextColor(primary ? (appearanceDark ? Color.rgb(16, 35, 66) : Color.WHITE) : appearanceForeground);
            button.setBackground(panelButtonBackground(primary));
            button.setAllCaps(false); button.setMinHeight(dp(44)); button.setMinimumHeight(dp(44));
        } else if (view instanceof TextView) {
            ((TextView) view).setTextColor(view == status ? (appearanceDark ? Color.rgb(195, 200, 208) : Color.rgb(65, 65, 65)) : appearanceForeground);
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) themeNativeChildren(group.getChildAt(index));
        }
    }
    private void themeDiagnosticsDialog() {
        if (diagnosticsDialog == null || diagnosticsDialog.getWindow() == null) return;
        GradientDrawable background = new GradientDrawable(); background.setColor(appearanceSurface);
        background.setCornerRadius(dp(12)); background.setStroke(dp(1), appearanceBorder);
        diagnosticsDialog.getWindow().setBackgroundDrawable(background);
        themeNativeChildren(diagnosticsDialog.getWindow().getDecorView());
    }
    private Button button(String text, Runnable action) {
        Button button = new Button(this); button.setText(text); button.setTextSize(13); button.setAllCaps(false);
        button.setMinHeight(dp(44)); button.setMinimumHeight(dp(44)); button.setMinWidth(dp(44));
        button.setPadding(dp(12), 0, dp(12), 0); button.setGravity(Gravity.CENTER); button.setStateListAnimator(null);
        boolean primary = text.startsWith("重试"); button.setTag(primary ? "primary" : "secondary");
        button.setBackground(panelButtonBackground(primary));
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(0, dp(44), 1f); layout.setMargins(0, 0, dp(6), 0); button.setLayoutParams(layout);
        button.setOnClickListener(v -> action.run()); return button;
    }
    private void startRuntime(String action) {
        Intent intent = new Intent(this, HostRuntimeService.class).setAction(action); startForegroundService(intent);
        if (!bound) { bound = bindService(intent, connection, BIND_AUTO_CREATE); }
    }
    @Override public void changed(HostRuntimeService.Snapshot value) {
        status.setText(value.message);
        runtimePanel.setVisibility(value.phase.equals("ready") ? View.GONE : View.VISIBLE);
        if (value.phase.equals("ready") && !value.url.equals(loadedUrl)) {
            loadHostPage(value.url);
        }
    }
    private void loadHostPage(String value) {
        loadedUrl = value;
        if (platformDocumentScript != null) { platformDocumentScript.remove(); platformDocumentScript = null; }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Uri url = Uri.parse(value);
            String origin = url.getScheme() + "://" + url.getEncodedAuthority();
            platformDocumentScript = WebViewCompat.addDocumentStartJavaScript(web, platformSource, java.util.Collections.singleton(origin));
        }
        web.loadUrl(value);
    }
    private void showFailure(String error) { runOnUiThread(() -> { status.setText(error); runtimePanel.setVisibility(View.VISIBLE); }); }
    private void showDiagnostics() {
        HostRuntimeService.Snapshot value = runtime == null ? null : runtime.snapshot();
        ScrollView scrolling = new ScrollView(this); TextView text = new TextView(this); text.setTextIsSelectable(true);
        text.setTextSize(13); text.setLineSpacing(dp(3), 1f); text.setPadding(dp(16), dp(12), dp(16), dp(12));
        text.setText(value == null ? status.getText() : value.phase + "\n" + value.message + "\n\n" + value.diagnostic); scrolling.addView(text);
        TextView title = new TextView(this); title.setText("本地 Host 运行详情"); title.setTextSize(17);
        title.setTypeface(null, android.graphics.Typeface.BOLD); title.setPadding(dp(16), dp(16), dp(16), dp(8));
        diagnosticsDialog = new AlertDialog.Builder(this).setCustomTitle(title).setView(scrolling)
            .setPositiveButton("关闭", null).setNeutralButton("停止 Host", (dialog, which) -> startRuntime(HostRuntimeService.STOP)).create();
        diagnosticsDialog.setOnShowListener(dialog -> themeDiagnosticsDialog());
        diagnosticsDialog.setOnDismissListener(dialog -> diagnosticsDialog = null);
        diagnosticsDialog.show();
    }
    private void notificationSettings() { startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())); }
    private boolean sameHost(String url) {
        if (loadedUrl.isEmpty()) return false;
        try { URI expected = URI.create(loadedUrl), actual = URI.create(url);
            return actual.getScheme().equals(expected.getScheme()) && actual.getHost().equals(expected.getHost()) && actual.getPort() == expected.getPort();
        } catch (Exception error) { return false; }
    }
    private void openExternal(String url) {
        Uri uri = Uri.parse(url); String scheme = uri.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme) && !"mailto".equals(scheme)) { showFailure("无法打开链接协议：" + scheme); return; }
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception error) { showFailure("外部链接打开失败：" + error.getMessage()); }
    }
    private void beginSave(PendingSave request) {
        if (pendingSave != null) { discardSource(request); platformResult(request.requestId, false, "已有文件等待保存"); return; }
        pendingSave = request;
        try { startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(request.mimeType).putExtra(Intent.EXTRA_TITLE, request.name), SAVE_FILE); }
        catch (Exception error) { pendingSave = null; discardSource(request); platformResult(request.requestId, false, error.toString()); }
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent intent) {
        super.onActivityResult(requestCode, resultCode, intent);
        if (requestCode == PICK_FILES && fileChoice != null) {
            Uri[] selected = WebChromeClient.FileChooserParams.parseResult(resultCode, intent);
            if (intent != null && intent.getClipData() != null && resultCode == RESULT_OK) {
                ClipData clip = intent.getClipData(); selected = new Uri[clip.getItemCount()];
                for (int i = 0; i < selected.length; i++) selected[i] = clip.getItemAt(i).getUri();
            }
            fileChoice.onReceiveValue(selected); fileChoice = null;
        }
        if (requestCode == SAVE_FILE && pendingSave != null) {
            PendingSave request = pendingSave; pendingSave = null;
            if (resultCode != RESULT_OK || intent == null || intent.getData() == null) { discardSource(request); platformResult(request.requestId, true, "cancelled"); return; }
            Uri target = intent.getData();
            files.execute(() -> {
                try {
                    try (OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                        if (output == null) throw new IOException("保存目标无法打开");
                        if (request.source != null) {
                            try (InputStream input = new FileInputStream(request.source)) { copy(input, output); }
                        } else if (request.text != null) output.write(request.text.getBytes(StandardCharsets.UTF_8));
                        else download(request.downloadUrl, output);
                    }
                    platformResult(request.requestId, true, target.toString());
                } catch (Exception error) { platformResult(request.requestId, false, error.toString()); }
                finally { discardSource(request); }
            });
        }
    }
    private void download(String url, OutputStream output) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(30_000); connection.setReadTimeout(60_000);
        String cookies = CookieManager.getInstance().getCookie(url); if (cookies != null) connection.setRequestProperty("Cookie", cookies);
        try {
            if (connection.getResponseCode() != 200) throw new IOException("下载 HTTP " + connection.getResponseCode());
            try (InputStream input = connection.getInputStream()) { copy(input, output); }
        } finally { connection.disconnect(); }
    }
    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[64 * 1024]; int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
    }
    private void discardSource(PendingSave request) {
        if (request.source != null && request.source.exists() && !request.source.delete())
            showFailure("临时导出文件清理失败：" + request.source.getName());
    }
    private static String bridgeResult(boolean success, String result) {
        try { return new JSONObject().put("success", success).put("result", result).toString(); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
    private void platformResult(String id, boolean success, Object result) {
        runOnUiThread(() -> {
            if (web == null) return;
            try { JSONObject event = new JSONObject().put("id", id).put("success", success).put("result", result);
                web.evaluateJavascript("window.dispatchEvent(new CustomEvent('eleckoi:platform-result',{detail:" + event + "}));", null);
            } catch (Exception error) { showFailure("平台结果发送失败：" + error); }
        });
    }
    private final class PlatformBridge {
        @JavascriptInterface public void tts(String id, String method, String json) { runOnUiThread(() -> systemSpeech.invoke(id,method,json)); }
        @JavascriptInterface public String readTtsAudio(String token, long offset, int count) { return systemSpeech.read(token,offset,count); }
        @JavascriptInterface public String releaseTtsAudio(String token) { return systemSpeech.release(token); }
        @JavascriptInterface public void saveText(String id, String name, String mime, String text) {
            runOnUiThread(() -> { if (sameHost(web.getUrl())) beginSave(new PendingSave(id, name, mime, text, null, null)); else platformResult(id, false, "Host page not active"); });
        }
        @JavascriptInterface public String beginFile(String id, String name, String mime) {
            try {
                File source = File.createTempFile("eleckoi-export-", ".bin", getCacheDir());
                String token = java.util.UUID.randomUUID().toString();
                stagedSaves.put(token, new StagedSave(new PendingSave(id, name, mime, null, null, source), new FileOutputStream(source)));
                return bridgeResult(true, token);
            } catch (Exception error) { return bridgeResult(false, error.toString()); }
        }
        @JavascriptInterface public String writeFile(String token, String base64) {
            StagedSave save = stagedSaves.get(token);
            if (save == null) return bridgeResult(false, "Unknown file transfer: " + token);
            try { save.output.write(Base64.decode(base64, Base64.DEFAULT)); return bridgeResult(true, ""); }
            catch (Exception error) { abortFile(token); return bridgeResult(false, error.toString()); }
        }
        @JavascriptInterface public String finishFile(String token) {
            StagedSave save = stagedSaves.remove(token);
            if (save == null) return bridgeResult(false, "Unknown file transfer: " + token);
            try {
                save.output.close();
                runOnUiThread(() -> beginSave(save.request));
                return bridgeResult(true, "");
            } catch (Exception error) { discardSource(save.request); return bridgeResult(false, error.toString()); }
        }
        @JavascriptInterface public String abortFile(String token) {
            StagedSave save = stagedSaves.remove(token);
            if (save == null) return bridgeResult(true, "");
            try { save.output.close(); discardSource(save.request); return bridgeResult(true, ""); }
            catch (Exception error) { discardSource(save.request); return bridgeResult(false, error.toString()); }
        }
        @JavascriptInterface public void reportError(String message) { runOnUiThread(() -> showFailure("文件导出失败：" + message)); }
        @JavascriptInterface public void openExternal(String url) { runOnUiThread(() -> MainActivity.this.openExternal(url)); }
        @JavascriptInterface public void notificationSettings() { runOnUiThread(MainActivity.this::notificationSettings); }
        @JavascriptInterface public void appearance(String mode, String surface) { runOnUiThread(() -> applyAppearance("dark".equals(mode), surface)); }
        @JavascriptInterface public String version() { return "1"; }
    }
    @Override public boolean onCreateOptionsMenu(Menu menu) { menu.add("Host 运行详情").setOnMenuItemClickListener(item -> { showDiagnostics(); return true; }); return true; }
    @Override public void onBackPressed() {
        web.evaluateJavascript("!window.dispatchEvent(new CustomEvent('eleckoi:platform-back',{cancelable:true}))", consumed -> {
            if ("true".equals(consumed)) return;
            if (web.canGoBack()) web.goBack();
            else MainActivity.super.onBackPressed();
        });
    }
    private void applyAppearance(boolean dark, String surface) {
        int background = dark ? Color.rgb(13, 15, 18) : Color.rgb(245, 245, 245);
        if (surface != null && surface.matches("#[0-9a-fA-F]{6}")) background = Color.parseColor(surface);
        int foreground = dark ? Color.rgb(245, 245, 245) : Color.rgb(22, 22, 22);
        appearanceDark = dark; appearanceForeground = foreground; appearanceBackground = background;
        appearanceSurface = dark ? Color.rgb(36, 40, 46) : Color.WHITE;
        appearanceBorder = dark ? Color.rgb(74, 82, 93) : Color.rgb(184, 184, 184);
        // Android 15+ draws transparent system bars over these real view surfaces.
        // The inset padding belongs to page, not to WebView or runtimePanel.
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(background));
        getWindow().getDecorView().setBackgroundColor(background);
        if (page != null) page.setBackgroundColor(background);
        if (web != null) web.setBackgroundColor(background);
        getWindow().setStatusBarColor(background); getWindow().setNavigationBarColor(background);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 28) getWindow().setNavigationBarDividerColor(background);
        int flags = getWindow().getDecorView().getSystemUiVisibility();
        int lightBars = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(dark ? flags & ~lightBars : flags | lightBars);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            int lightAppearance = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            if (controller != null) controller.setSystemBarsAppearance(dark ? 0 : lightAppearance, lightAppearance);
        }
        runtimePanel.setBackgroundColor(background);
        themeNativeChildren(runtimePanel);
        themeDiagnosticsDialog();
    }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onDestroy() {
        if (runtime != null) runtime.removeObserver(this); if (bound) unbindService(connection);
        if (fileChoice != null) fileChoice.onReceiveValue(null);
        if (pendingSave != null) { discardSource(pendingSave); platformResult(pendingSave.requestId, false, "Activity closed while saving"); }
        for (String token : stagedSaves.keySet()) new PlatformBridge().abortFile(token);
        systemSpeech.close();
        if (platformDocumentScript != null) platformDocumentScript.remove();
        web.removeJavascriptInterface("ElecKoiAndroid"); web.destroy(); web=null; files.shutdown(); super.onDestroy();
    }
}
