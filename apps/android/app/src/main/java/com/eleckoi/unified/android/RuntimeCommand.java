package com.eleckoi.unified.android;

import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

final class RuntimeCommand {
    static ProcessBuilder create(RuntimePaths paths, RuntimeInstaller.Installation installation) throws Exception {
        JSONObject config = new JSONObject()
            .put("runtimeDataRoot", "/eleckoi/data")
            .put("homeRoot", "/eleckoi/home")
            .put("workspaceRoot", "/eleckoi/workspace")
            .put("productDatabasePath", "/eleckoi/data/eleckoi.db")
            .put("productMediaRoot", "/eleckoi/media")
            .put("resourceRoot", "/eleckoi/app/resources/dsh");
        Files.write(paths.config.toPath(), config.toString().getBytes(StandardCharsets.UTF_8));
        File proot = paths.nativeExecutable("libeleckoi_proot.so"), loader = paths.nativeExecutable("libeleckoi_proot_loader.so");
        paths.nativeExecutable("libtalloc.so"); paths.nativeExecutable("libandroid-shmem.so");
        List<String> args = new ArrayList<>(Arrays.asList(proot.getAbsolutePath(), "--kill-on-exit", "--link2symlink", "-0", "-r", installation.rootfs.getAbsolutePath()));
        bind(args, new File("/proc"), "/proc"); bind(args, new File("/dev"), "/dev");
        bind(args, installation.app, "/eleckoi/app"); bind(args, paths.data, "/eleckoi/data");
        bind(args, paths.home, "/eleckoi/home"); bind(args, paths.media, "/eleckoi/media");
        bind(args, paths.workspace, "/eleckoi/workspace"); bind(args, paths.temp, "/tmp");
        bind(args, paths.config, "/eleckoi/runtime-config.json"); bind(args, paths.resolver, "/etc/resolv.conf");
        bind(args, loader, "/run/eleckoi/proot-loader");
        args.addAll(Arrays.asList("-w", "/eleckoi/workspace", "/usr/bin/env", "-i",
            "HOME=/eleckoi/home", "USER=root", "LOGNAME=root", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TMPDIR=/tmp",
            "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "DSH_HOME=/eleckoi/home", "DSH_TELEMETRY_DISABLED=1",
            installation.nodeExecutable, "/eleckoi/app/bin/eleckoi-host.mjs", "--config", "/eleckoi/runtime-config.json"));
        ProcessBuilder builder = new ProcessBuilder(args).directory(installation.rootfs);
        Map<String,String> env = builder.environment(); env.clear();
        env.put("LD_LIBRARY_PATH", paths.nativeLibraries.getAbsolutePath()); env.put("PROOT_LOADER", loader.getAbsolutePath());
        env.put("PROOT_TMP_DIR", paths.temp.getAbsolutePath()); env.put("ELECKOI_SHMEM_DIR", paths.temp.getAbsolutePath());
        env.put("TMPDIR", paths.temp.getAbsolutePath());
        return builder;
    }
    private static void bind(List<String> arguments, File path, String guest) {
        arguments.add("-b"); arguments.add(path.getAbsolutePath() + ":" + guest);
    }
}
