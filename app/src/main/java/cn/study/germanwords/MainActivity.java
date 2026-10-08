package cn.study.germanwords;

import android.app.Activity;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.InflaterInputStream;
import java.util.zip.Inflater;

/** Offline Android host. Only packaged assets and app-private imports are exposed. */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final int FOLDER = 101, FILES = 102, BACKUP = 103;
    WebView web;
    private MediaPlayer player;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean destroyed;
    private String backup;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(246,247,242));
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(246,247,242));
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // Android 15 edge-to-edge: keep every control inside system bar / cutout insets.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        root.requestApplyInsets();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new AndroidBridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return resource(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isLocal(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isLocal(Uri.parse(url));
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                recreate();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                android.util.Log.d("GermanWords", message.message() + " @" + message.lineNumber());
                return true;
            }
        });
        web.loadUrl("https://" + HOST + "/assets/web/index.html");
    }

    private boolean isLocal(Uri uri) { return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()); }
    private File privateFile(String path) throws IOException {
        File root = new File(getFilesDir(), "library").getCanonicalFile();
        File file = new File(root, path).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator)) throw new IOException("Invalid path");
        return file;
    }
    private WebResourceResponse resource(Uri uri) {
        try {
            if (!isLocal(uri)) throw new IOException("External request blocked");
            String path = uri.getPath();
            InputStream input;
            if (path.startsWith("/assets/web/")) {
                String name = path.substring("/assets/".length());
                if (name.contains("..")) throw new IOException("Invalid path");
                input = getAssets().open(name);
            } else if (path.startsWith("/library/")) {
                input = new FileInputStream(privateFile(path.substring(9)));
            } else throw new IOException("Missing resource");
            String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" :
                    path.endsWith(".js") ? "application/javascript" : path.endsWith(".json") ? "application/json" : "application/octet-stream";
            return new WebResourceResponse(mime, "UTF-8", input);
        } catch (IOException error) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
    }

    private void js(String code) { runOnUiThread(() -> { if (!destroyed) web.evaluateJavascript(code, null); }); }
    private void notice(String text, String kind) { js("notify(" + JSONObject.quote(text) + "," + JSONObject.quote(kind) + ")"); }
    public class AndroidBridge {
        @JavascriptInterface public String manifest() {
            try {
                JSONArray all;
                try (InputStream in = getAssets().open("web/manifest.json")) {
                    all = new JSONArray(new String(read(in, 4*1024*1024), StandardCharsets.UTF_8));
                }
                File file = new File(getFilesDir(), "import-manifest.json");
                if (file.exists()) {
                    try (InputStream in = new FileInputStream(file)) {
                        JSONArray imported = new JSONArray(new String(read(in, 4*1024*1024), StandardCharsets.UTF_8));
                        for (int i=0; i<imported.length(); i++) all.put(imported.get(i));
                    }
                }
                return all.toString();
            } catch (Exception e) { return "[]"; }
        }
        // Deflate is decoded by Java, so XLSX works with older Android System WebViews too.
        @JavascriptInterface public String inflate(String encoded) {
            Inflater inflater = new Inflater(true);
            try (InputStream in = new InflaterInputStream(new ByteArrayInputStream(Base64.decode(encoded, Base64.DEFAULT)), inflater)) {
                return Base64.encodeToString(read(in, 32*1024*1024), Base64.NO_WRAP);
            } catch (Exception e) { return ""; } finally { inflater.end(); }
        }
        @JavascriptInterface public void importFolder() { runOnUiThread(() -> choose(FOLDER)); }
        @JavascriptInterface public void importFiles() { runOnUiThread(() -> choose(FILES)); }
        @JavascriptInterface public void stopAudio() { runOnUiThread(() -> releaseAudio()); }
        @JavascriptInterface public void play(String url) { runOnUiThread(() -> playAudio(url)); }
        @JavascriptInterface public void exportBackup(String data) {
            if (data.length() > 4*1024*1024) return;
            runOnUiThread(() -> {
                backup = data;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json").putExtra(Intent.EXTRA_TITLE, "german-words-backup.json");
                try { startActivityForResult(intent, BACKUP); } catch (Exception e) { notice("没有可用的文件管理器", "error"); }
            });
        }
    }
    private static byte[] read(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int count;
        while ((count=input.read(buffer))!=-1) {
            if (out.size()+count > limit) throw new IOException("文件过大");
            out.write(buffer,0,count);
        }
        return out.toByteArray();
    }
    private void choose(int type) {
        Intent intent;
        if (type == FOLDER) intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        else intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(intent,type); } catch (Exception e) { notice("没有可用的文件选择器", "error"); }
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (result!=RESULT_OK || data==null) return;
        if (request==BACKUP) {
            try (OutputStream out=getContentResolver().openOutputStream(data.getData())) {
                out.write(backup.getBytes(StandardCharsets.UTF_8));
                notice("学习进度已备份", "info");
            } catch (Exception e) { notice("备份失败："+e.getMessage(),"error"); }
            backup=null;
            return;
        }
        if (request!=FOLDER && request!=FILES) return;
        js("setImportBusy(true)");
        worker.execute(() -> importDocuments(request,data));
    }
    private static boolean supported(String name) { return name.toLowerCase(Locale.ROOT).matches(".*\\.(xlsx|mp3|m4a|wav|ogg|oga|opus|aac|flac|json)$"); }
    private String displayName(Uri uri) {
        try (Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)) {
            if (c!=null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return "import.xlsx";
    }
    private void importDocuments(int request,Intent data) {
        android.util.Log.d("GermanWords", "Import start: " + request);
        File session = new File(new File(getFilesDir(),"library"), UUID.randomUUID().toString());
        JSONArray entries = new JSONArray();
        boolean committed = false;
        boolean restoredBackup = false;
        try {
            if (!session.mkdirs()) throw new IOException("无法创建导入目录");
            if (request==FOLDER) {
                Uri tree=data.getData();
                restoredBackup = scanTree(tree,DocumentsContract.getTreeDocumentId(tree),"",session,entries,0);
            } else {
                List<Uri> uris=new ArrayList<>();
                if (data.getClipData()!=null) for(int i=0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());
                else if(data.getData()!=null) uris.add(data.getData());
                for(Uri uri:uris) if(copyDocument(uri,displayName(uri),session,entries)) restoredBackup = true;
            }
            boolean hasBook=false;
            for(int i=0;i<entries.length();i++) if(entries.getJSONObject(i).getString("name").toLowerCase(Locale.ROOT).endsWith(".xlsx")) hasBook=true;
            if (!hasBook) {
                if (entries.length()>0) {
                    // Standalone audio imports can extend the current library too.
                    hasBook = true;
                }
                else if(!restoredBackup) notice("没有找到支持的文件", "warn");
                if (!hasBook) return;
            }
            JSONArray all=new JSONArray();
            File manifest=new File(getFilesDir(),"import-manifest.json");
            if(manifest.exists()) try(InputStream in=new FileInputStream(manifest)) { all=new JSONArray(new String(read(in,4*1024*1024),StandardCharsets.UTF_8)); }
            for(int i=0;i<entries.length();i++) all.put(entries.get(i));
            File tmp=new File(getFilesDir(),"import-manifest.tmp");
            try(OutputStream out=new FileOutputStream(tmp)) { out.write(all.toString().getBytes(StandardCharsets.UTF_8)); }
            if(!tmp.renameTo(manifest)) throw new IOException("无法保存导入记录");
            committed = true;
            android.util.Log.d("GermanWords", "Import committed: " + entries.length() + " files");
            js("reloadLibrary(true)");
            notice("已导入，词表和音频已保存到手机", "info");
        } catch(Exception e) { android.util.Log.e("GermanWords", "Import failed", e); notice("导入失败："+e.getMessage(),"error"); }
        finally { if (!committed) deleteSession(session); js("setImportBusy(false)"); }
    }
    private void deleteSession(File file) {
        File[] children=file.listFiles();
        if(children!=null) for(File child:children) deleteSession(child);
        if(file.exists() && !file.delete()) android.util.Log.w("GermanWords","Unable to remove failed import staging file");
    }
    private boolean scanTree(Uri tree,String id,String parent,File session,JSONArray entries,int depth) throws Exception {
        boolean restored = false;
        if(depth>32 || entries.length()>5000) throw new IOException("文件夹层级或文件数过多");
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,id);
        try(Cursor cursor=getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)) {
            if(cursor==null) throw new IOException("无法读取文件夹");
            while(cursor.moveToNext()) {
                String childId=cursor.getString(0),name=cursor.getString(1),mime=cursor.getString(2);
                String path=parent+name;
                if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) { if(scanTree(tree,childId,path+"/",session,entries,depth+1)) restored = true; }
                else if(supported(name)) { if(copyDocument(DocumentsContract.buildDocumentUriUsingTree(tree,childId),path,session,entries)) restored = true; }
            }
        }
        return restored;
    }
    private boolean copyDocument(Uri uri,String path,File session,JSONArray entries) throws Exception {
        String name=path.substring(path.lastIndexOf('/')+1);
        if(!supported(name)) return false;
        try(InputStream in=getContentResolver().openInputStream(uri)) {
            if(in==null) throw new IOException("无法读取 "+name);
            byte[] bytes=read(in,32*1024*1024);
            if(name.toLowerCase(Locale.ROOT).endsWith(".json")) {
                String content=new String(bytes,StandardCharsets.UTF_8);
                js("restoreBackup("+JSONObject.quote(content)+")");
                return true;
            }
            File file=privateFile(session.getName()+"/"+path);
            File parent=file.getParentFile();
            if(!parent.exists() && !parent.mkdirs()) throw new IOException("无法保存文件");
            try(OutputStream out=new FileOutputStream(file)) { out.write(bytes); }
            JSONObject entry=new JSONObject();
            entry.put("name",name).put("path",session.getName()+"/"+path).put("url","/library/"+session.getName()+"/"+path).put("imported",true);
            entries.put(entry);
        }
        return false;
    }
    private void playAudio(String url) {
        releaseAudio();
        try {
            Uri uri=Uri.parse(url);
            if(!isLocal(uri)) throw new IOException("找不到本地音频");
            player=new MediaPlayer();
            String path=uri.getPath();
            if(path.startsWith("/assets/web/")) {
                try(AssetFileDescriptor fd=getAssets().openFd(path.substring(8))) { player.setDataSource(fd.getFileDescriptor(),fd.getStartOffset(),fd.getLength()); }
            } else if(path.startsWith("/library/")) player.setDataSource(privateFile(path.substring(9)).getPath());
            else throw new IOException("找不到本地音频");
            player.setOnPreparedListener(MediaPlayer::start);
            player.setOnCompletionListener(p -> { if(p==player) releaseAudio(); });
            player.setOnErrorListener((p,what,extra) -> { releaseAudio(); notice("音频无法播放，请检查文件格式", "error"); return true; });
            player.prepareAsync();
        } catch(Exception e) { releaseAudio(); notice("音频加载失败："+e.getMessage(),"error"); }
    }
    private void releaseAudio() { if(player!=null) { player.release(); player=null; } }
    @Override public void onBackPressed() { web.evaluateJavascript("handleAndroidBack()", value -> { if(!"true".equals(value)) super.onBackPressed(); }); }
    @Override protected void onPause() { super.onPause(); web.evaluateJavascript("if(typeof pauseStudyAudio==='function')pauseStudyAudio()",null); releaseAudio(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); if(web!=null) web.onResume(); }
    @Override protected void onDestroy() { destroyed=true; releaseAudio(); worker.shutdown(); web.removeJavascriptInterface("Android"); web.destroy(); super.onDestroy(); }
}
