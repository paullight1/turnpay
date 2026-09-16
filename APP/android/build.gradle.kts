allprojects {
    repositories {
        maven {
            url = uri("local-m2")
        }
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Sentry 8.14 pins Kotlin 1.6, which Kotlin 2.3 no longer accepts.
// Keep this compatibility override scoped to that plugin.
subprojects {
    // file_picker assumes AGP 9 built-in Kotlin, but Flutter currently opts
    // this project out of it. Apply the external compiler for its .kt sources.
    if (name == "file_picker") {
        plugins.withId("com.android.library") {
            apply(plugin = "org.jetbrains.kotlin.android")
            tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
                compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
            }
        }
    }
    if (name == "sentry_flutter") {
        afterEvaluate {
            // package_info_plus requires API 36 in consuming libraries.
            extensions.configure<com.android.build.gradle.LibraryExtension> {
                compileSdkVersion(36)
            }
            tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
                compilerOptions.languageVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_0)
            }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
