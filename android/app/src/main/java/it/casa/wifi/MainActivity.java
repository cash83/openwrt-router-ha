package it.casa.wifi;

import android.app.Activity;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * One screen: a WebView showing the same page Home Assistant has in its sidebar.
 * The page is bundled in the app and talks to Home Assistant over its WebSocket
 * API, so nothing is loaded from the network but the data itself.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "connection";
    private static final String KEY_ALIAS = "wifi_di_casa_token";

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.window));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setTextZoom(100);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Light and dark are handled by the page itself (prefers-color-scheme).
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.evaluateJavascript("window.appResume && window.appResume()", null);
    }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.appPause && window.appPause()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        // The page closes whatever it has open; when nothing is, leave the app.
        web.evaluateJavascript("(window.appBack && window.appBack()) ? 1 : 0", value -> {
            if (!"1".equals(value)) {
                finish();
            }
        });
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** What the page can ask the app: remember, read back and forget the connection. */
    private final class Bridge {

        @JavascriptInterface
        public String getConfig() {
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            try {
                JSONObject out = new JSONObject();
                out.put("home", prefs.getString("home", ""));
                out.put("remote", prefs.getString("remote", ""));
                out.put("token", decrypt(prefs.getString("token", "")));
                return out.toString();
            } catch (Exception error) {
                return "{}";
            }
        }

        @JavascriptInterface
        public boolean saveConfig(String home, String remote, String token) {
            try {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putString("home", home == null ? "" : home.trim())
                        .putString("remote", remote == null ? "" : remote.trim())
                        .putString("token", encrypt(token == null ? "" : token.trim()))
                        .apply();
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface
        public void clearConfig() {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply();
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception error) {
                return "";
            }
        }
    }

    // The access token is kept encrypted with a key that never leaves the
    // phone's keystore, so a copy of the app's files is not enough to use it.

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator =
                    KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(
                    KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build());
            return generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    private static String encrypt(String text) throws Exception {
        if (text.isEmpty()) {
            return "";
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] sealed = cipher.doFinal(text.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                + Base64.encodeToString(sealed, Base64.NO_WRAP);
    }

    private static String decrypt(String stored) throws Exception {
        if (stored == null || !stored.contains(":")) {
            return "";
        }
        String[] parts = stored.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(),
                new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)),
                StandardCharsets.UTF_8);
    }
}
