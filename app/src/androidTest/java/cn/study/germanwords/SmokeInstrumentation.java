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
import java.nio.file.Files;
import java.lang.reflect.Field;
import org.json.JSONObject;
import org.json.JSONArray;
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
            results.putString("stream", "\n"+result+"\nPASS: native packaged/imported audio playback, recursive SAF folder import, single XLSX import, landscape layout.\n");
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
            if(activity!=null)runOnMainSync(() -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
        }
        finish(resultCode,results);
    }
    private byte[] readFile(File file) throws IOException {
        try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);return out.toByteArray();
        }
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
