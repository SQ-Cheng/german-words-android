package cn.study.germanwords;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.content.pm.ActivityInfo;
import android.media.MediaPlayer;
import java.lang.reflect.Field;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;

/** Runs the real learning engine inside the target device's real WebView. */
public class SmokeInstrumentation extends Instrumentation {
    private MainActivity activity;
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    private String evaluate(String code) throws Exception {
        CountDownLatch ready=new CountDownLatch(1);
        AtomicReference<String> value=new AtomicReference<>();
        runOnMainSync(() -> activity.web.evaluateJavascript(code, result -> { value.set(result); ready.countDown(); }));
        if (!ready.await(10,TimeUnit.SECONDS)) throw new IOException("WebView callback timeout");
        return value.get();
    }
    @Override public void onStart() {
        Bundle results=new Bundle();
        File manifest=null;
        byte[] oldManifest=null;
        Set<String> initialSessions=new HashSet<>();
        int resultCode=Activity.RESULT_CANCELED;
        String oldPreferences=null;
        try {
            Intent intent=new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity=(MainActivity)startActivitySync(intent);
            runOnMainSync(() -> activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
            boolean loaded=false;
            for(int i=0;i<80;i++) {
                if("true".equals(evaluate("typeof currentFileWords !== 'undefined' && currentFileWords.length > 0"))) { loaded=true;break; }
                SystemClock.sleep(250);
            }
            if(!loaded) throw new IOException("Initial library did not load");
            String script;
            try(InputStream in=getContext().getAssets().open("smoke.js")) {
                ByteArrayOutputStream out=new ByteArrayOutputStream();
                byte[] buffer=new byte[4096];int n;
                while((n=in.read(buffer))!=-1)out.write(buffer,0,n);
                script=out.toString(StandardCharsets.UTF_8.name());
            }
            evaluate(script);
            String result="null";
            for(int i=0;i<240;i++) {
                result=evaluate("window.smokeResult || null");
                if(!"null".equals(result))break;
                SystemClock.sleep(250);
            }
            if(!result.contains("PASS"))throw new IOException("Engine device tests: "+result);
            oldPreferences=evaluate("localStorage.getItem(PREF_KEY)");
            evaluate("autoPlayEnabled=false;isFilterActive=false;switchView('card');document.getElementById('modeSelect').value='normal';changeMode()");
            for(float scale:new float[]{1f,1.3f,1.5f,2f}) {
                runOnMainSync(() -> activity.applyTextScale(scale));
                SystemClock.sleep(300);
                if(!"true".equals(evaluate("document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('.main-content').scrollWidth<=innerWidth+1")))throw new IOException("Horizontal overflow at text zoom "+scale);
                evaluate("document.getElementById('btnNextCard').scrollIntoView({block:'nearest'})");
                SystemClock.sleep(100);
                if(!"true".equals(evaluate("(()=>{const b=document.getElementById('btnNextCard').getBoundingClientRect();return b.width>=44 && b.height>=44 && b.left>=0 && b.right<=innerWidth+1 && b.top>=0 && b.bottom<=innerHeight+1})()")))throw new IOException("Navigation inaccessible at text zoom "+scale);
                evaluate("document.getElementById('libraryButton').scrollIntoView({block:'nearest'});openLibrary()");
                if(!"true".equals(evaluate("libraryOpen && document.getElementById('library').scrollWidth<=innerWidth+1")))throw new IOException("Drawer at text zoom "+scale);
                evaluate("closeLibrary();document.getElementById('lessonTitle').scrollIntoView({block:'start'})");
                SystemClock.sleep(100);
                screenshot("qa-font-"+Math.round(scale*100)+".png");
                evaluate("switchView('list');document.getElementById('modeSelect').value='test-zh';changeMode()");
                SystemClock.sleep(200);
                if(!"true".equals(evaluate("document.getElementById('wordTable').getBoundingClientRect().right<=innerWidth+1 && document.querySelector('#wordTable tbody tr').cells[0].textContent===''")))throw new IOException("Self-test list at text zoom "+scale);
                if(scale==2f)screenshot("qa-list-200.png");
                evaluate("switchView('card');document.getElementById('modeSelect').value='normal';changeMode()");
            }
            runOnMainSync(() -> activity.web.setLayoutParams(new android.widget.FrameLayout.LayoutParams(
                    Math.round(320*activity.getResources().getDisplayMetrics().density),android.widget.FrameLayout.LayoutParams.MATCH_PARENT)));
            for(float scale:new float[]{1f,2f}) {
                runOnMainSync(() -> activity.applyTextScale(scale));SystemClock.sleep(300);
                evaluate("document.getElementById('btnNextCard').scrollIntoView({block:'nearest'})");
                SystemClock.sleep(100);
                if(!"true".equals(evaluate("innerWidth<=321 && document.querySelector('.main-content').scrollWidth<=innerWidth+1 && document.getElementById('btnNextCard').getBoundingClientRect().right<=innerWidth+1")))throw new IOException("320dp card layout at text zoom "+scale);
                evaluate("switchView('list');document.getElementById('modeSelect').value='test-de';changeMode()");
                if(!"true".equals(evaluate("document.getElementById('wordTable').getBoundingClientRect().right<=innerWidth+1")))throw new IOException("320dp list layout at text zoom "+scale);
                evaluate("switchView('card');document.getElementById('modeSelect').value='normal';changeMode()");
            }
            runOnMainSync(() -> activity.web.setLayoutParams(new android.widget.FrameLayout.LayoutParams(android.widget.FrameLayout.LayoutParams.MATCH_PARENT,android.widget.FrameLayout.LayoutParams.MATCH_PARENT)));
            runOnMainSync(() -> activity.applyTextScale(activity.getResources().getConfiguration().fontScale));
            // Real native MediaPlayer must prepare and play a packaged recording.
            evaluate("pauseStudyAudio(); Android.play(audioSource(displayWords[0]).url); true");
            Field field=MainActivity.class.getDeclaredField("player");field.setAccessible(true);
            AtomicReference<Boolean> playing=new AtomicReference<>(false);
            for(int i=0;i<40;i++) {
                runOnMainSync(() -> {try {MediaPlayer p=(MediaPlayer)field.get(activity);playing.set(p!=null && p.isPlaying());}catch(Exception ignored){}});
                if(playing.get())break;
                SystemClock.sleep(50);
            }
            if(!playing.get())throw new IOException("Native MediaPlayer did not play packaged audio");
            evaluate("pauseStudyAudio()");
            manifest=new File(activity.getFilesDir(),"import-manifest.json");
            if(manifest.exists())oldManifest=readFile(manifest);
            File library=new File(activity.getFilesDir(),"library");
            File[] oldSessions=library.listFiles();
            if(oldSessions!=null)for(File file:oldSessions)initialSessions.add(file.getName());
            Uri tree=DocumentsContract.buildTreeDocumentUri(FixtureDocumentsProvider.AUTHORITY,"root");
            runOnMainSync(() -> activity.onActivityResult(MainActivity.FOLDER,Activity.RESULT_OK,new Intent().setData(tree)));
            waitImported("SAF-Test.xlsx");
            android.util.Log.d("GermanWordsTest","Folder imported");
            if(!"true".equals(evaluate("currentFileWords.length===65 && fileMap[currentFileName].url.includes('/library/')")))throw new IOException("Folder import failed");
            if(!"true".equals(evaluate("findAudioFile(currentFileWords.find(w=>w.german==='lernen')).url.includes('/library/')")))throw new IOException("Nested imported recording not matched");
            evaluate("Android.play(findAudioFile(currentFileWords.find(w=>w.german==='lernen')).url)");
            playing.set(false);
            for(int i=0;i<40;i++) {
                runOnMainSync(() -> {try {MediaPlayer p=(MediaPlayer)field.get(activity);playing.set(p!=null && p.isPlaying());}catch(Exception ignored){}});
                if(playing.get())break;SystemClock.sleep(50);
            }
            if(!playing.get())throw new IOException("Imported recording did not play");
            evaluate("pauseStudyAudio()");
            Uri single=DocumentsContract.buildDocumentUri(FixtureDocumentsProvider.AUTHORITY,"file");
            runOnMainSync(() -> activity.onActivityResult(MainActivity.FILES,Activity.RESULT_OK,new Intent().setData(single)));
            waitImported("Individual-Test.xlsx");
            android.util.Log.d("GermanWordsTest","Individual file imported");
            if(!"true".equals(evaluate("currentFileWords.length===65")))throw new IOException("Individual file import failed");
            runOnMainSync(() -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
            android.util.Log.d("GermanWordsTest","Landscape requested");
            for(int i=0;i<40;i++){if("true".equals(evaluate("innerWidth>innerHeight")))break;SystemClock.sleep(100);}
            if(!"true".equals(evaluate("innerWidth>innerHeight && document.documentElement.scrollWidth<=innerWidth+1 && document.getElementById('btnNextCard').getBoundingClientRect().right<=innerWidth")))throw new IOException("Landscape layout");
            runOnMainSync(() -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
            android.util.Log.d("GermanWordsTest","Landscape verified");
            results.putString("stream", "\n"+result+"\nPASS: 100/130/150/200% text zoom, 320dp narrow layout, accessible navigation/menu and self-test lists, native packaged/imported audio playback, recursive SAF folder import, single XLSX import, landscape layout.\n");
            resultCode=Activity.RESULT_OK;
        } catch(Exception e) {
            results.putString("stream", "\nFAIL: "+e+"\n");
        } finally {
            if(activity!=null && manifest!=null) {
                try {
                    if(oldManifest==null)manifest.delete();else try(FileOutputStream out=new FileOutputStream(manifest)){out.write(oldManifest);}
                    File[] sessions=new File(activity.getFilesDir(),"library").listFiles();
                    if(sessions!=null)for(File file:sessions)if(!initialSessions.contains(file.getName()))remove(file);
                }catch(Exception ignored){}
            }
            if(activity!=null && oldPreferences!=null)try {
                evaluate("pauseStudyAudio();localStorage.setItem(PREF_KEY,"+oldPreferences+");preferences=JSON.parse(localStorage.getItem(PREF_KEY)||'{}');applyPreferences();reloadLibrary()");
            }catch(Exception ignored){}
            if(activity!=null)runOnMainSync(() -> {activity.applyTextScale(activity.getResources().getConfiguration().fontScale);activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);});
        }
        finish(resultCode,results);
    }
    private byte[] readFile(File file) throws IOException {
        try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);return out.toByteArray();
        }
    }
    private void screenshot(String name) throws IOException {
        android.graphics.Bitmap bitmap=getUiAutomation().takeScreenshot();
        if(bitmap==null)throw new IOException("Screenshot unavailable");
        try(OutputStream out=new FileOutputStream(new File(activity.getFilesDir(),name))){bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}
        finally {bitmap.recycle();}
    }
    private void waitImported(String name) throws Exception {
        for(int i=0;i<100;i++) {
            if("true".equals(evaluate("!importBusy && currentFileName==="+JSONObject.quote(name))))return;
            SystemClock.sleep(100);
        }
        throw new IOException("Import timeout: "+name+"; "+evaluate("document.getElementById('notice').innerText"));
    }
    private void remove(File file) { File[] children=file.listFiles();if(children!=null)for(File child:children)remove(child);file.delete(); }
}
