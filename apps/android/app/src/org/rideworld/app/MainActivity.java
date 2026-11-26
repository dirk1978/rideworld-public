package org.rideworld.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.OutputStream;
import java.util.ArrayList;

/**
 * RideWorld for Android: the live site (https://rideworld.example.org) full screen in a WebView, plus what a web page
 * can't do here: Bluetooth sensors (Ble.java stands in for Web Bluetooth, which Android's WebView lacks; the page side
 * is public/js/android-bridge.js), saving downloads (ride files) and keeping the screen on. Site updates need no new APK.
 */
public class MainActivity extends Activity {
    static final String TAG = "RideWorld";
    static final String HOME = "https://rideworld.example.org/";
    // pages that stay in the app (Strava's sign-in comes back to our own callback); anything else opens in the browser
    static final String[] INSIDE = { "rideworld.example.org", "www.strava.com", "strava.com", "accounts.google.com" };
    WebView web;
    Ble ble;
    private ValueCallback<Uri[]> filePick;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // (riding: hands off the screen for an hour)
        web = new WebView(this);
        web.setBackgroundColor(0xff0f1115);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // (ride sounds, music)
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " RideWorldAndroid/" + version());
        ble = new Ble(this);
        web.addJavascriptInterface(new Bridge(), "RideWorldAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl(); String h = u.getHost() == null ? "" : u.getHost();
                for (String ok : INSIDE) if (h.equals(ok)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException e) { Log.w(TAG, "no app for " + u); }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) { Log.i(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")"); return true; }
            // route import (GPX / FIT / TCX / KML), workouts (.zwo)
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (filePick != null) filePick.onReceiveValue(null);
                filePick = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try { startActivityForResult(i, 7); } catch (ActivityNotFoundException e) { filePick = null; return false; }
                return true;
            }
        });
        setContentView(web);
        fullScreen();
        askPermissions();
        if (saved != null) web.restoreState(saved); else web.loadUrl(HOME);
    }

    void fullScreen() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) { c.hide(WindowInsets.Type.systemBars()); c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) fullScreen(); }

    /** Bluetooth permissions, asked once at start (the picker would otherwise fail on first use). */
    void askPermissions() {
        ArrayList<String> want = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) { want.add(Manifest.permission.BLUETOOTH_SCAN); want.add(Manifest.permission.BLUETOOTH_CONNECT); }
        else want.add(Manifest.permission.ACCESS_FINE_LOCATION);
        ArrayList<String> missing = new ArrayList<>();
        for (String p : want) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), 3);
    }
    boolean hasBlePermissions() {
        if (Build.VERSION.SDK_INT >= 31) return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == 7 && filePick != null) {
            filePick.onReceiveValue(res == RESULT_OK && data != null && data.getData() != null ? new Uri[] { data.getData() } : null);
            filePick = null;
        }
    }

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); fullScreen(); }
    @Override protected void onDestroy() { ble.closeAll(); web.destroy(); super.onDestroy(); }

    String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    /** Runs JavaScript in the page (from any thread). */
    void js(String code) { runOnUiThread(() -> web.evaluateJavascript(code, null)); }

    class Bridge {
        @JavascriptInterface public String version() { return MainActivity.this.version(); }

        /** A download the page made (ride .fit / .tcx / .gpx, a screenshot), saved to Downloads/RideWorld. */
        @JavascriptInterface
        public boolean saveFile(String name, String mime, String base64) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/RideWorld");
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver r = getContentResolver();
                Uri uri = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return false;
                try (OutputStream o = r.openOutputStream(uri)) { o.write(data); }
                v.clear(); v.put(MediaStore.Downloads.IS_PENDING, 0); r.update(uri, v, null, null);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Saved to Downloads/RideWorld: " + name, Toast.LENGTH_SHORT).show());
                return true;
            } catch (Exception e) { Log.e(TAG, "save failed", e); return false; }
        }

        // ---- Bluetooth (see Ble.java); every call answers through window.__rwb.r(id, ok, value) ----
        @JavascriptInterface public void bleRequest(int id, String servicesJson) { ble.request(id, servicesJson); }
        @JavascriptInterface public void bleDevices(int id) { ble.devices(id); }
        @JavascriptInterface public void bleConnect(int id, String addr) { ble.connect(id, addr); }
        @JavascriptInterface public void bleDisconnect(String addr) { ble.disconnect(addr); }
        @JavascriptInterface public void bleRead(int id, String addr, String svc, String chr) { ble.read(id, addr, svc, chr); }
        @JavascriptInterface public void bleWrite(int id, String addr, String svc, String chr, String b64, boolean withResponse) { ble.write(id, addr, svc, chr, b64, withResponse); }
        @JavascriptInterface public void bleNotify(int id, String addr, String svc, String chr, boolean on) { ble.notify(id, addr, svc, chr, on); }
        @JavascriptInterface public void bleWatch(String addr, boolean on) { ble.watch(addr, on); }
        @JavascriptInterface public void bleForget(String addr) { ble.forget(addr); }
    }
}
