package it.casa.wifi;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * One screen: a WebView showing the same page Home Assistant has in its sidebar.
 * The page is bundled in the app and talks to Home Assistant over its WebSocket
 * API, so nothing is loaded from the network but the data itself.
 *
 * Signing in to Home Assistant goes through the same steps its login page uses.
 * The password is sent to Home Assistant and not kept; what is kept is the refresh
 * token it hands out, encrypted with a key that stays in the phone's keystore.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "connection";
    private static final String KEY_ALIAS = "wifi_di_casa_token";
    private static final String APP_PAGE = "file:///android_asset/index.html";
    private static final String CALLBACK_MARK = "wifi_di_casa_login";
    private static final int TIMEOUT_MS = 7000;

    private WebView web;
    /** True only while our own bundled page is showing; the bridge answers nobody else. */
    private volatile boolean ownPage;
    private String accessToken;
    private long accessTokenExpires;

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
        web.setWebViewClient(new Client());
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        // "Remember this phone" switched off: what was saved lasts until the app
        // is closed, so a fresh start begins from the sign-in screen.
        if (savedInstanceState == null && !prefs().getBoolean("remember", true)) {
            prefs().edit().clear().apply();
        }
        // Set before loading: the page reads its saved connection as its first
        // act, and that can happen before onPageStarted is delivered.
        ownPage = true;
        web.loadUrl(APP_PAGE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (ownPage) {
            web.evaluateJavascript("window.appResume && window.appResume()", null);
        }
    }

    @Override
    protected void onPause() {
        if (ownPage) {
            web.evaluateJavascript("window.appPause && window.appPause()", null);
        }
        web.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (!ownPage) {
            ownPage = true;
            web.loadUrl(APP_PAGE);
            return;
        }
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

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private static String trimUrl(String url) {
        String out = url == null ? "" : url.trim();
        while (out.endsWith("/")) {
            out = out.substring(0, out.length() - 1);
        }
        return out;
    }

    private final class Client extends WebViewClient {

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            ownPage = url != null && url.startsWith("file:///android_asset/");
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // The app only ever shows its own bundled page.
            return !request.getUrl().toString().startsWith("file:///android_asset/");
        }
    }

    /** Trade the one-time code for tokens. Returns an error text, or null when it worked. */
    private String exchange(String base, String code) {
        try {
            JSONObject reply = post(base, "grant_type=authorization_code&code=" + enc(code)
                    + "&client_id=" + enc(base + "/"));
            String refresh = reply.optString("refresh_token", "");
            if (refresh.isEmpty()) {
                return "Home Assistant non ha concesso l'accesso.";
            }
            prefs().edit()
                    .putString("refresh", encrypt(refresh))
                    .putString("client", base + "/")
                    .apply();
            accessToken = reply.optString("access_token", null);
            accessTokenExpires = System.currentTimeMillis() + reply.optLong("expires_in", 0) * 1000;
            return null;
        } catch (Exception error) {
            return "Home Assistant non ha risposto durante l'accesso.";
        }
    }

    private static String enc(String text) throws Exception {
        return URLEncoder.encode(text, "UTF-8");
    }

    /** Home Assistant's token endpoint: form in, JSON out, with the HTTP status added. */
    private static JSONObject post(String base, String body) throws Exception {
        String[] reply = send(trimUrl(base) + "/auth/token", "application/x-www-form-urlencoded", body);
        JSONObject json;
        try {
            json = reply[1].isEmpty() ? new JSONObject() : new JSONObject(reply[1]);
        } catch (Exception notJson) {
            json = new JSONObject();
        }
        json.put("_status", Integer.parseInt(reply[0]));
        return json;
    }

    private static JSONObject json(String[] reply) {
        try {
            return new JSONObject(reply[1]);
        } catch (Exception notJson) {
            return new JSONObject();
        }
    }

    /** One POST. Returns {status, body}; throws when nobody answers. */
    private static String[] send(String url, String contentType, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS * 2);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", contentType);
            try (OutputStream out = connection.getOutputStream()) {
                out.write((body == null ? "" : body).getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            if (stream != null) {
                byte[] chunk = new byte[4096];
                int read;
                while ((read = stream.read(chunk)) > 0) {
                    buffer.write(chunk, 0, read);
                }
            }
            return new String[] {String.valueOf(status), buffer.toString("UTF-8")};
        } finally {
            connection.disconnect();
        }
    }

    /** What the bundled page can ask the app. Home Assistant's own pages get no answer. */
    private final class Bridge {

        @JavascriptInterface
        public String getConfig() {
            JSONObject out = new JSONObject();
            if (!ownPage) {
                return out.toString();
            }
            try {
                SharedPreferences prefs = prefs();
                out.put("mode", prefs.getString("mode", ""));
                out.put("remember", prefs.getBoolean("remember", true));
                out.put("home", prefs.getString("home", ""));
                out.put("remote", prefs.getString("remote", ""));
                out.put("signedIn", !prefs.getString("refresh", "").isEmpty());
                out.put("routerHost", prefs.getString("routerHost", ""));
                out.put("routerUser", prefs.getString("routerUser", ""));
                out.put("routerSaved", !prefs.getString("routerPassword", "").isEmpty());
            } catch (Exception ignored) {
                // An empty answer makes the page show the sign-in screen.
            }
            return out.toString();
        }

        @JavascriptInterface
        public boolean saveAddresses(String home, String remote) {
            if (!ownPage) {
                return false;
            }
            prefs().edit().putString("home", trimUrl(home)).putString("remote", trimUrl(remote)).apply();
            return true;
        }

        /**
         * Sign in to Home Assistant with the name and password typed in the app,
         * through the same steps its own login page goes through. The answer comes
         * back through window.appSignIn(id, answer): {"ok": true},
         * {"mfa": true, "flow": "..."} when a second-factor code is wanted, or
         * {"error": "auth" | "unreachable" | "unsupported"}.
         */
        @JavascriptInterface
        public void haSignIn(int id, String address, String username, String password,
                String flow, String code) {
            if (!ownPage) {
                return;
            }
            new Thread(() -> {
                String answer = signIn(trimUrl(address), username, password, flow, code);
                runOnUiThread(() -> {
                    if (ownPage) {
                        web.evaluateJavascript("window.appSignIn(" + id + "," + answer + ")", null);
                    }
                });
            }).start();
        }

        private String signIn(String base, String username, String password, String flow, String code) {
            try {
                String client = base + "/";
                JSONObject step;
                if (flow == null || flow.isEmpty()) {
                    JSONObject start = new JSONObject();
                    start.put("client_id", client);
                    start.put("handler", new org.json.JSONArray().put("homeassistant").put(JSONObject.NULL));
                    start.put("redirect_uri", base + "/?" + CALLBACK_MARK + "=1");
                    JSONObject opened = json(send(base + "/auth/login_flow", "application/json", start.toString()));
                    flow = opened.optString("flow_id", "");
                    if (flow.isEmpty()) {
                        return "{\"error\":\"unsupported\"}";
                    }
                    JSONObject login = new JSONObject();
                    login.put("client_id", client);
                    login.put("username", username == null ? "" : username.trim());
                    login.put("password", password == null ? "" : password);
                    step = json(send(base + "/auth/login_flow/" + flow, "application/json", login.toString()));
                } else {
                    JSONObject second = new JSONObject();
                    second.put("client_id", client);
                    second.put("code", code == null ? "" : code.trim());
                    step = json(send(base + "/auth/login_flow/" + flow, "application/json", second.toString()));
                }
                String type = step.optString("type", "");
                if ("create_entry".equals(type)) {
                    String error = exchange(base, step.optString("result", ""));
                    return error == null ? "{\"ok\":true}" : "{\"error\":\"unreachable\"}";
                }
                if ("form".equals(type) && "mfa".equals(step.optString("step_id"))) {
                    JSONObject errors = step.optJSONObject("errors");
                    JSONObject out = new JSONObject().put("mfa", true).put("flow", flow);
                    if (errors != null && errors.length() > 0) {
                        out.put("wrong", true);
                    }
                    return out.toString();
                }
                return "{\"error\":\"auth\"}";
            } catch (Exception error) {
                return "{\"error\":\"unreachable\"}";
            }
        }

        /**
         * A short-lived access token, asked from Home Assistant at `address`.
         * The answer, {"token": "..."} or {"error": "unreachable" | "auth"},
         * comes back through window.appToken(id, answer).
         */
        @JavascriptInterface
        public void requestToken(String address, int id) {
            new Thread(() -> {
                String answer = accessToken(address);
                runOnUiThread(() -> {
                    if (ownPage) {
                        web.evaluateJavascript("window.appToken(" + id + "," + answer + ")", null);
                    }
                });
            }).start();
        }

        /**
         * POST a JSON body to a router's /ubus for the bundled page, which cannot
         * do it itself across origins. Answers through window.appHttp(id, status, text).
         */
        @JavascriptInterface
        public void http(int id, String url, String body) {
            if (!ownPage || url == null || !url.endsWith("/ubus")) {
                return;
            }
            new Thread(() -> {
                int status = 0;
                String text = "";
                try {
                    String[] reply = send(url, "application/json", body);
                    status = Integer.parseInt(reply[0]);
                    text = reply[1];
                } catch (Exception unreachable) {
                    // status 0 tells the page nobody answered.
                }
                final String script = "window.appHttp(" + id + "," + status + ","
                        + JSONObject.quote(text) + ")";
                runOnUiThread(() -> {
                    if (ownPage) {
                        web.evaluateJavascript(script, null);
                    }
                });
            }).start();
        }

        /** Login of a router used without Home Assistant; the password is stored encrypted. */
        @JavascriptInterface
        public boolean saveRouter(String host, String user, String password) {
            if (!ownPage) {
                return false;
            }
            try {
                prefs().edit()
                        .putString("mode", "router")
                        .putString("routerHost", trimUrl(host))
                        .putString("routerUser", user == null ? "" : user.trim())
                        .putString("routerPassword", encrypt(password == null ? "" : password))
                        .apply();
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface
        public String routerPassword() {
            if (!ownPage) {
                return "";
            }
            try {
                return decrypt(prefs().getString("routerPassword", ""));
            } catch (Exception error) {
                return "";
            }
        }

        @JavascriptInterface
        public void setRemember(boolean remember) {
            if (ownPage) {
                prefs().edit().putBoolean("remember", remember).apply();
            }
        }

        @JavascriptInterface
        public void setMode(String mode) {
            if (ownPage) {
                prefs().edit().putString("mode", "router".equals(mode) ? "router" : "ha").apply();
            }
        }

        private String accessToken(String address) {
            JSONObject out = new JSONObject();
            try {
                if (!ownPage) {
                    return out.put("error", "auth").toString();
                }
                synchronized (MainActivity.this) {
                    if (accessToken != null && System.currentTimeMillis() < accessTokenExpires - 120_000) {
                        return out.put("token", accessToken).toString();
                    }
                    SharedPreferences prefs = prefs();
                    String refresh = decrypt(prefs.getString("refresh", ""));
                    if (refresh.isEmpty()) {
                        return out.put("error", "auth").toString();
                    }
                    JSONObject reply;
                    try {
                        reply = post(address, "grant_type=refresh_token&refresh_token=" + enc(refresh)
                                + "&client_id=" + enc(prefs.getString("client", "")));
                    } catch (Exception network) {
                        return out.put("error", "unreachable").toString();
                    }
                    String token = reply.optString("access_token", "");
                    if (token.isEmpty()) {
                        int status = reply.optInt("_status");
                        return out.put("error", status == 400 || status == 401 || status == 403
                                ? "auth" : "unreachable").toString();
                    }
                    accessToken = token;
                    accessTokenExpires = System.currentTimeMillis() + reply.optLong("expires_in", 0) * 1000;
                    return out.put("token", token).toString();
                }
            } catch (Exception error) {
                return "{\"error\":\"unreachable\"}";
            }
        }

        /** Forget this phone: tell Home Assistant to drop the token, then erase it here. */
        @JavascriptInterface
        public void signOut() {
            if (!ownPage) {
                return;
            }
            SharedPreferences prefs = prefs();
            String home = prefs.getString("home", "");
            String remote = prefs.getString("remote", "");
            try {
                String refresh = decrypt(prefs.getString("refresh", ""));
                if (!refresh.isEmpty()) {
                    for (String address : new String[] {home, remote}) {
                        if (address.isEmpty()) {
                            continue;
                        }
                        try {
                            post(address, "action=revoke&token=" + enc(refresh));
                            break;
                        } catch (Exception unreachable) {
                            // Try the other address.
                        }
                    }
                }
            } catch (Exception ignored) {
                // The local copy is erased either way.
            }
            synchronized (MainActivity.this) {
                accessToken = null;
            }
            prefs.edit().clear().apply();
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
