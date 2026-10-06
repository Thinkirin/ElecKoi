import groovy.json.JsonSlurper

plugins { id("com.android.application") }
val runtimeAssets = providers.gradleProperty("unifiedRuntimeAssetsDir")
    .map { rootProject.file(it) }.getOrElse(rootProject.file("runtime-assets"))
android {
    namespace = "com.eleckoi.unified.android"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.eleckoi.unified.android"
        minSdk = 27
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-migration"
        ndk { abiFilters += "arm64-v8a" }
    }
    sourceSets.getByName("main").assets.directories += runtimeAssets.absolutePath
    androidResources { noCompress += "archive" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { jniLibs { useLegacyPackaging = true } }
    buildTypes { getByName("release") { isMinifyEnabled = false } }
}
dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
}

val verifyRuntimeAssets = tasks.register("verifyRuntimeAssets") {
    group = "verification"
    inputs.dir(runtimeAssets)
    doLast {
        val manifestFile = runtimeAssets.resolve("runtime/manifest.json")
        check(manifestFile.isFile) { "Missing unified Host assets: $manifestFile. Stage ARM64 rootfs, Node and real Host before acceptance." }
        val manifest = JsonSlurper().parse(manifestFile) as Map<*, *>
        check(manifest["schemaVersion"] == 1 && manifest["architecture"] == "arm64-v8a") { "Unsupported runtime manifest" }
        val archives = manifest["archives"] as? List<*> ?: error("Runtime archives missing")
        check(archives.isNotEmpty()) { "Runtime archives empty" }
        archives.forEach { value ->
            val archive = value as Map<*, *>
            val asset = archive["asset"] as? String ?: error("Archive asset missing")
            val file = runtimeAssets.resolve(asset).canonicalFile
            check(file.toPath().startsWith(runtimeAssets.canonicalFile.toPath()) && file.isFile) { "Missing archive $asset" }
        }
    }
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(verifyRuntimeAssets)
}
