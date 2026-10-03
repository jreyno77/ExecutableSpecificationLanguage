plugins {
    kotlin("jvm") version "2.4.10"
    application
}
repositories {
    mavenCentral()
    maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies")
}
dependencies {
    implementation("org.jetbrains.kotlin:kotlin-compiler:2.4.10")
    for (name in listOf("analysis-api", "analysis-api-k2", "analysis-api-impl-base", "analysis-api-platform-interface", "low-level-api-fir", "symbol-light-classes", "analysis-api-standalone")) {
        implementation("org.jetbrains.kotlin:$name-for-ide:2.4.10") { isTransitive = false }
    }
    implementation("com.github.ben-manes.caffeine:caffeine:2.9.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json-jvm:1.11.0")
    implementation("org.jetbrains.intellij.deps.kotlinx:kotlinx-coroutines-core:1.10.2-intellij-2")
}
application { mainClass.set("expec.kotlin.MainKt") }
kotlin { jvmToolchain(21) }
dependencyLocking { lockAllConfigurations() }
tasks.withType<Jar>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
tasks.wrapper {
    gradleVersion = "9.1.0"
    distributionSha256Sum = "a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806"
}
fun bridgeStage(name: String, destination: String) = tasks.register<Sync>(name) {
    dependsOn(tasks.jar)
    from(configurations.runtimeClasspath) { into("lib") }
    from(tasks.jar) { into("lib") }
    from("NOTICE.txt")
    from("acquire.gradle")
    from("gradle/wrapper/gradle-wrapper.jar") { into("wrapper") }
    from(listOf("gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.properties")) { into("wrapper") }
    into(destination)
}
val stageSource = bridgeStage("stageSource", "../kotlin")
val stageDistribution = bridgeStage("stageDistribution", "../../dist/kotlin")
tasks.register("stageBridge") { dependsOn(stageSource, stageDistribution) }
