package com.eleckoi.unified.android;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.function.Consumer;

/** Installs the actual offline distribution before running any Host entrypoint. */
final class RuntimeInstaller {
    static final class Installation {
        final File rootfs, app;
        final String version, nodeExecutable;
        Installation(File directory, JSONObject manifest) throws Exception {
            rootfs = new File(directory, "rootfs"); app = new File(directory, "app");
            version = manifest.getString("version"); nodeExecutable = manifest.getString("nodeExecutable");
            if (!nodeExecutable.startsWith("/") || nodeExecutable.contains(".."))
                throw new IOException("Invalid guest Node path: " + nodeExecutable);
            if (!new File(rootfs, nodeExecutable.substring(1)).isFile())
                throw new IOException("Packaged Node missing: " + nodeExecutable);
            if (!new File(app, "bin/eleckoi-host.mjs").isFile())
                throw new IOException("Real unified Host entrypoint missing: bin/eleckoi-host.mjs");
            prepareMountTargets(rootfs);
        }
    }
    static Installation install(Context context, RuntimePaths paths, Consumer<String> progress) throws Exception {
        String raw;
        try (InputStream input = context.getAssets().open("runtime/manifest.json")) {
            raw = readText(input);
        } catch (FileNotFoundException missing) {
            throw new IOException("统一 Host 离线资源未打包。请运行资源 staging 并检查 verifyRuntimeAssets。", missing);
        }
        JSONObject manifest = new JSONObject(raw);
        if (manifest.getInt("schemaVersion") != 1 || !manifest.getString("architecture").equals("arm64-v8a"))
            throw new IOException("Unsupported Android runtime manifest");
        String identity = hex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)));
        File directory = new File(paths.installations, identity.substring(0, 20));
        File marker = new File(directory, ".installed");
        if (marker.isFile()) try (InputStream saved = new FileInputStream(marker)) {
            if (readText(saved).equals(identity)) return new Installation(directory, manifest);
        }
        if (directory.exists()) deleteTree(directory);
        Files.createDirectories(directory.toPath());
        JSONArray archives = manifest.getJSONArray("archives");
        if (archives.length() == 0) throw new IOException("Runtime manifest has no archives");
        for (int index = 0; index < archives.length(); index++) {
            JSONObject archive = archives.getJSONObject(index);
            String target = archive.getString("target");
            if (!target.equals("rootfs") && !target.equals("app")) throw new IOException("Unknown archive target: " + target);
            String asset = archive.getString("asset");
            progress.accept("安装 " + asset + " (" + (index + 1) + "/" + archives.length() + ")");
            File compressed = new File(directory, "archive-" + index + ".tar.gz");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = context.getAssets().open(asset); OutputStream output = new FileOutputStream(compressed)) {
                byte[] buffer = new byte[64 * 1024]; int count;
                while ((count = input.read(buffer)) != -1) { output.write(buffer, 0, count); digest.update(buffer, 0, count); }
            }
            if (archive.has("sha256") && !hex(digest.digest()).equalsIgnoreCase(archive.getString("sha256")))
                throw new IOException("Archive checksum mismatch: " + asset);
            File destination = new File(directory, target); Files.createDirectories(destination.toPath());
            Process extraction = new ProcessBuilder("/system/bin/toybox", "tar", "-xzf", compressed.getAbsolutePath(), "-C", destination.getAbsolutePath())
                .redirectErrorStream(true).start();
            String log; try (InputStream stream = extraction.getInputStream()) { log = readText(stream); }
            int code = extraction.waitFor();
            if (code != 0) throw new IOException("Runtime extraction failed (" + code + "): " + log);
            Files.delete(compressed.toPath());
        }
        Installation installation = new Installation(directory, manifest);
        Files.write(marker.toPath(), identity.getBytes(StandardCharsets.UTF_8));
        return installation;
    }
    private static void prepareMountTargets(File rootfs) throws IOException {
        // Refresh these even for a cached installation. Resolver symlinks from a
        // distro must not redirect the Android active-network resolver mount.
        for (String relative : new String[]{"proc", "dev", "tmp", "etc", "eleckoi/app", "eleckoi/data", "eleckoi/home", "eleckoi/media", "eleckoi/workspace", "run/eleckoi"})
            Files.createDirectories(new File(rootfs, relative).toPath());
        File resolver = new File(rootfs, "etc/resolv.conf");
        if (Files.isSymbolicLink(resolver.toPath())) Files.delete(resolver.toPath());
        for (String relative : new String[]{"etc/resolv.conf", "eleckoi/runtime-config.json", "run/eleckoi/proot-loader"}) {
            File file = new File(rootfs, relative); if (!file.exists()) Files.createFile(file.toPath());
        }
    }
    private static void deleteTree(File root) throws IOException {
        Files.walkFileTree(root.toPath(), new SimpleFileVisitor<Path>() {
            @Override public FileVisitResult visitFile(Path path, java.nio.file.attribute.BasicFileAttributes attrs) throws IOException {
                Files.delete(path); return FileVisitResult.CONTINUE;
            }
            @Override public FileVisitResult postVisitDirectory(Path path, IOException error) throws IOException {
                if (error != null) throw error; Files.delete(path); return FileVisitResult.CONTINUE;
            }
        });
    }
    static String readText(InputStream input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] bytes = new byte[8192]; int count;
        while ((count = input.read(bytes)) != -1) out.write(bytes, 0, count);
        return out.toString(StandardCharsets.UTF_8.name());
    }
    static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(); for (byte item : bytes) value.append(String.format("%02x", item & 255)); return value.toString();
    }
}
