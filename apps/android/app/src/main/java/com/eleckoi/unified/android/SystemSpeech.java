package com.eleckoi.unified.android;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Only the Android platform TTS engine lives here; settings and jobs belong to the shared Host. */
final class SystemSpeech {
    interface Reply { void send(String requestId, boolean success, Object result); }
    private final Context context;
    private final Reply reply;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<Runnable> initialization = new ArrayDeque<>();
    private final ArrayDeque<Job> queue = new ArrayDeque<>();
    private final Map<String, File> outputs = new HashMap<>();
    private final Map<String, JSONObject> states = new HashMap<>();
    private final Map<String, String> initializingJobs = new HashMap<>();
    private final Set<String> cancelledInitializing = new HashSet<>();
    private TextToSpeech engine;
    private boolean ready, closed;
    private String initializationError;
    private Job active;
    private static final class Job {
        final String requestId, id, text, voice;
        final float speed, pitch;
        final ArrayList<File> parts = new ArrayList<>();
        int offset, sequence;
        Job(String requestId, JSONObject options) {
            this.requestId = requestId; id = options.optString("id", UUID.randomUUID().toString()); text = options.optString("text");
            voice = options.optString("voiceId", options.optString("voice"));
            speed = (float)options.optDouble("speed", 1); pitch = (float)options.optDouble("pitch", 1);
        }
    }
    SystemSpeech(Context context, Reply reply) { this.context = context; this.reply = reply; }
    private JSONObject object(Object... pairs) {
        try { JSONObject result = new JSONObject(); for (int i=0; i<pairs.length; i+=2) result.put((String)pairs[i], pairs[i+1]); return result; }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
    void invoke(String requestId, String method, String json) {
        try {
            JSONObject options = new JSONObject(json);
            if (closed) throw new IllegalStateException("Android TTS platform is closed");
            if ("cancel".equals(method)) { reply.send(requestId, true, cancel(options.optString("id"))); return; }
            if ("state".equals(method)) { JSONObject state = states.get(options.optString("id")); if (state == null) throw new IllegalArgumentException("Unknown system TTS task"); reply.send(requestId, true, state); return; }
            if (!"voices".equals(method) && !"synthesize".equals(method)) throw new IllegalArgumentException("Unknown system TTS operation: " + method);
            if ("synthesize".equals(method)) { if (!options.has("id")) options.put("id",UUID.randomUUID().toString()); initializingJobs.put(requestId,options.getString("id")); }
            Runnable operation = () -> {
                try {
                    initializingJobs.remove(requestId);
                    if (cancelledInitializing.remove(requestId)) throw new IllegalStateException("TTS cancelled before engine initialization");
                    if (initializationError != null) throw new IllegalStateException(initializationError);
                    if ("voices".equals(method)) {
                        ArrayList<Voice> voices = new ArrayList<>(engine.getVoices() == null ? Collections.emptySet() : engine.getVoices());
                        voices.sort(Comparator.comparing(Voice::getName)); JSONArray result = new JSONArray();
                        for (Voice voice : voices) result.put(object("id",voice.getName(),"name",voice.getName(),"locale",voice.getLocale().toLanguageTag(),
                            "networkRequired",voice.isNetworkConnectionRequired(),"quality",voice.getQuality(),"latency",voice.getLatency(),"provider","system"));
                        reply.send(requestId, true, result);
                    } else {
                        Job job = new Job(requestId, options);
                        if (job.text.trim().isEmpty()) throw new IllegalArgumentException("TTS text is empty");
                        if (!Float.isFinite(job.speed) || job.speed <= 0 || !Float.isFinite(job.pitch) || job.pitch <= 0) throw new IllegalArgumentException("TTS speed and pitch must be positive finite values");
                        if (active != null && active.id.equals(job.id) || queue.stream().anyMatch(item -> item.id.equals(job.id))) throw new IllegalArgumentException("TTS id already running: " + job.id);
                        queue.add(job); states.put(job.id, object("id",job.id,"status","queued")); startNext();
                    }
                } catch (Exception error) { reply.send(requestId, false, error.toString()); }
            };
            if (ready || initializationError != null) operation.run();
            else { initialization.add(operation); initialize(); }
        } catch (Exception error) { reply.send(requestId, false, error.toString()); }
    }
    private void initialize() {
        if (engine != null) return;
        engine = new TextToSpeech(context.getApplicationContext(), status -> main.post(() -> {
            ready = status == TextToSpeech.SUCCESS;
            if (!ready) initializationError = "Android system TTS initialization failed: " + status;
            while (!initialization.isEmpty()) initialization.remove().run();
        }));
        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { main.post(() -> completePart(id)); }
            @Override @Deprecated public void onError(String id) { onError(id, TextToSpeech.ERROR); }
            @Override public void onError(String id, int code) { main.post(() -> { if (active != null && partId(active).equals(id)) finish(false,"Android system TTS failed: " + code); }); }
            @Override public void onStop(String id, boolean interrupted) { main.post(() -> { if (active != null && partId(active).equals(id)) finish(false,"Android system TTS stopped"); }); }
        });
    }
    private void startNext() {
        if (active != null || queue.isEmpty()) return;
        active = queue.remove(); states.put(active.id, object("id",active.id,"status","running"));
        try {
            if (!active.voice.isEmpty()) {
                Voice selected = (engine.getVoices() == null ? Collections.<Voice>emptySet() : engine.getVoices()).stream().filter(voice -> voice.getName().equals(active.voice)).findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown Android voice: " + active.voice));
                if (engine.setVoice(selected) != TextToSpeech.SUCCESS) throw new IllegalStateException("Cannot select Android voice");
            }
            if (engine.setSpeechRate(active.speed) != TextToSpeech.SUCCESS || engine.setPitch(active.pitch) != TextToSpeech.SUCCESS) throw new IllegalStateException("Cannot configure Android speech rate/pitch");
            synthesizePart();
        } catch (Exception error) { finish(false, error.toString()); }
    }
    private String partId(Job job) { return job.requestId + ":" + job.sequence; }
    private void synthesizePart() throws IOException {
        int end = Math.min(active.text.length(), active.offset + TextToSpeech.getMaxSpeechInputLength());
        if (end < active.text.length() && Character.isHighSurrogate(active.text.charAt(end-1))) end--;
        String chunk = active.text.substring(active.offset, end); active.offset = end; active.sequence++;
        File file = File.createTempFile("eleckoi-tts-part-", ".wav", context.getCacheDir()); active.parts.add(file);
        if (engine.synthesizeToFile(chunk, new Bundle(), file, partId(active)) != TextToSpeech.SUCCESS) throw new IOException("Android TTS rejected the synthesis request");
    }
    private void completePart(String id) {
        if (active == null || !partId(active).equals(id)) return;
        try {
            if (active.parts.get(active.parts.size()-1).length() == 0) throw new IOException("Android TTS produced no audio");
            if (active.offset < active.text.length()) { synthesizePart(); return; }
            File output;
            if (active.parts.size() == 1) output = active.parts.remove(0);
            else { output = File.createTempFile("eleckoi-tts-", ".wav", context.getCacheDir()); try { WaveAudio.merge(active.parts, output); } catch (Exception error) { output.delete(); throw error; } }
            String token = UUID.randomUUID().toString(); synchronized (outputs) { outputs.put(token, output); }
            String voice = engine.getVoice() == null ? active.voice : engine.getVoice().getName();
            finish(true, object("id",active.id,"token",token,"bytes",output.length(),"mimeType","audio/wav","voiceId",voice,"status","completed"));
        } catch (Exception error) { finish(false,error.toString()); }
    }
    private void finish(boolean success, Object result) {
        Job job = active; active = null;
        for (File part : job.parts) if (part.exists() && !part.delete()) result = "Could not clean Android TTS temporary file";
        states.put(job.id, success && result instanceof JSONObject ? (JSONObject)result : object("id",job.id,"status","failed","error",String.valueOf(result)));
        reply.send(job.requestId, success && result instanceof JSONObject, result); startNext();
    }
    private boolean cancel(String id) {
        for (Map.Entry<String,String> job : initializingJobs.entrySet()) if (id.isEmpty() || job.getValue().equals(id)) { cancelledInitializing.add(job.getKey()); return true; }
        if (active != null && (id.isEmpty() || active.id.equals(id))) {
            Job job = active; engine.stop(); finish(false,"TTS cancelled"); states.put(job.id, object("id",job.id,"status","cancelled")); return true;
        }
        for (Iterator<Job> iterator = queue.iterator(); iterator.hasNext();) {
            Job job = iterator.next(); if (id.isEmpty() || job.id.equals(id)) { iterator.remove(); states.put(job.id,object("id",job.id,"status","cancelled")); reply.send(job.requestId,false,"TTS cancelled"); return true; }
        }
        return false;
    }
    String read(String token, long offset, int count) {
        try {
            File file; synchronized (outputs) { file = outputs.get(token); }
            if (file == null) throw new IOException("Unknown Android TTS audio token");
            if (offset < 0 || offset > file.length() || count < 1 || count > 65536) throw new IOException("Invalid Android TTS audio read range");
            byte[] bytes = new byte[(int)Math.min(count,file.length()-offset)];
            try (RandomAccessFile input = new RandomAccessFile(file,"r")) { input.seek(offset); input.readFully(bytes); }
            return object("success",true,"result",object("base64",Base64.encodeToString(bytes,Base64.NO_WRAP),"bytes",bytes.length,"eof",offset+bytes.length==file.length())).toString();
        } catch (Exception error) { return object("success",false,"result",error.toString()).toString(); }
    }
    String release(String token) {
        try {
            File file; synchronized (outputs) { file = outputs.remove(token); }
            if (file != null && file.exists() && !file.delete()) throw new IOException("Cannot delete Android TTS audio file");
            return object("success",true,"result",file != null).toString();
        } catch (Exception error) { return object("success",false,"result",error.toString()).toString(); }
    }
    void close() {
        closed = true; initializationError = "Android TTS platform closed";
        while (!initialization.isEmpty()) initialization.remove().run();
        while (!queue.isEmpty()) { Job job = queue.remove(); reply.send(job.requestId,false,initializationError); }
        if (active != null) { engine.stop(); finish(false,initializationError); }
        if (engine != null) engine.shutdown();
        ArrayList<String> tokens; synchronized (outputs) { tokens = new ArrayList<>(outputs.keySet()); }
        for (String token : tokens) release(token);
    }
}
