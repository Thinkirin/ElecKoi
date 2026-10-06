package com.eleckoi.unified.android;

import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

/** Installation files and persistent Host state have separate owners. */
final class RuntimePaths {
    final File root, installations, data, home, media, workspace, temp, resolver, config, state;
    final File nativeLibraries;
    RuntimePaths(Context context) throws IOException {
        root = new File(context.getNoBackupFilesDir(), "unified-runtime");
        installations = new File(root, "installations");
        data = new File(root, "data"); home = new File(root, "home");
        media = new File(root, "media"); workspace = new File(root, "workspace");
        temp = new File(root, "tmp"); resolver = new File(root, "resolv.conf");
        config = new File(root, "runtime-config.json");
        state = new File(root, "host-state.json");
        nativeLibraries = new File(context.getApplicationInfo().nativeLibraryDir);
        for (File dir : new File[]{root, installations, data, home, media, workspace, temp})
            Files.createDirectories(dir.toPath());
    }
    File nativeExecutable(String name) throws IOException {
        File path = new File(nativeLibraries, name);
        if (!path.isFile()) throw new IOException("Missing packaged native runtime: " + name);
        return path;
    }
}
