package com.demirel.sfdsketch;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String PREFS = "sfd_sketch";
    private static final String KEY_URL = "server_url";
    private static final String IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        enterImmersiveMode();
        setupWebView();

        String savedUrl = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, "");
        if (savedUrl == null || savedUrl.trim().isEmpty()) {
            showServerDialog(false);
        } else {
            loadServer(savedUrl);
        }
    }

    private void setupWebView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(2, 3, 7));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);
        s.setUserAgentString(IPHONE_UA);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }
        CookieManager.getInstance().setAcceptCookie(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                enterImmersiveMode();
                String js = "(function(){var r=document.documentElement,b=document.body;['sfd-android-v137','sfd-android-v138','sfd-android-v139','sfd-android-v140','sfd-android-v141'].forEach(function(c){r.classList.remove(c);});r.classList.add('sfd-mobile-v136');if(b){['sfd-v137-game-active','sfd-v138-game-active','sfd-v139-game-active','sfd-v140-game-active','sfd-v141-game-active','sfd-v137-drawing','sfd-v138-drawing','sfd-v139-drawing','sfd-v140-drawing','sfd-v141-drawing'].forEach(function(c){b.classList.remove(c);});}window.dispatchEvent(new Event('resize'));})();";
                view.evaluateJavascript(js, null);
            }
        });
    }

    private void loadServer(String rawUrl) {
        String url = normalizeUrl(rawUrl);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, url).apply();
        String separator = url.contains("?") ? "&" : "?";
        webView.loadUrl(url + separator + "mobile=1&apk=1");
    }

    private String normalizeUrl(String raw) {
        String url = raw == null ? "" : raw.trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://" + url;
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }

    private void showServerDialog(boolean allowCancel) {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("http://192.168.1.100:3000");
        input.setText(getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, ""));
        input.setSelectAllOnFocus(true);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        FrameLayout holder = new FrameLayout(this);
        holder.setPadding(pad, 0, pad, 0);
        holder.addView(input, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("SFD Sketch sunucu adresi")
                .setMessage("Bilgisayarda npm start çalıştırdıktan sonra telefonda açtığın adresi yaz.")
                .setView(holder)
                .setPositiveButton("BAĞLAN", null)
                .setNegativeButton(allowCancel ? "İPTAL" : "ÇIKIŞ", (d, w) -> {
                    if (!allowCancel) finish();
                })
                .create();

        dialog.setOnShowListener(d -> dialog.getButton(DialogInterface.BUTTON_POSITIVE).setOnClickListener(v -> {
            String value = input.getText().toString().trim();
            if (value.isEmpty()) {
                Toast.makeText(this, "Sunucu adresini yaz.", Toast.LENGTH_SHORT).show();
                return;
            }
            dialog.dismiss();
            loadServer(value);
        }));
        dialog.setCanceledOnTouchOutside(false);
        dialog.setCancelable(allowCancel);
        dialog.show();
    }

    private void enterImmersiveMode() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                    View.SYSTEM_UI_FLAG_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("SFD Sketch")
                .setItems(new String[]{"Sunucu adresini değiştir", "Uygulamadan çık"}, (dialog, which) -> {
                    if (which == 0) showServerDialog(true);
                    else finish();
                })
                .show();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }
}
