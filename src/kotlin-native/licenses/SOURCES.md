# Kotlin native distribution provenance

`../dependencies.json` maps each of the 22 unmodified upstream runtime JARs to its SHA-256, source and license bundle. `lib/expec-kotlin.jar` is this repository's bridge, built from `src/kotlin-native/src`; it is not an upstream Kotlin artifact. No JDK or Gradle distribution is bundled. The separate Gradle wrapper JAR retains its embedded META-INF/LICENSE; its scripts retain their copyright headers and `gradle-9.1.0/LICENSE.txt` is copied from Gradle v9.1.0.

## Compiler and reflection

`kotlin-2.4.10/` is the complete, unmodified license directory of [Kotlin compiler 2.4.10](https://github.com/JetBrains/kotlin/releases/tag/v2.4.10), plus that release's `upstream-spdx.json`. The downloaded compiler ZIP has SHA-256 `473dd66c7a3ef4b182065b3da670466c1bf2773a9dbb0ed8b33a39fe9d4f876d`, verified against its published checksum. Its `kotlin-compiler.jar` is byte-identical to the shipped Maven artifact (`db12b1af0db0e10eeedfc15d5dac0316604e5c556321f60e3bcd73075a66f0a3`).

The faithful upstream directory includes notices for the broader compiler distribution, examples and test data. Its README distinguishes those uses; presence of a notice does not claim that every upstream test/example component ships in this package. The upstream SPDX describes the full compiler distribution, not this package's complete runtime dependency set; use `dependencies.json` for that set.

The upstream SPDX identifies the compiler's incorporated IntelliJ components as 251.27812.49, fastutil as 8.5.14-jb1, ASM as 9.6.1, and Guava as 33.3.1-jre. Original attribution is retained in the compiler bundle. Additional IntelliJ LICENSE/NOTICE and JDOM's copyright/license header were copied from [IntelliJ idea/251.27812.49](https://github.com/JetBrains/intellij-community/tree/idea/251.27812.49); JDOM's header comes from `platform/util/jdom/src/org/jdom/Element.java`. This product includes software developed by the JDOM Project (https://www.jdom.org/).

`kotlin-1.6.10/` is the complete license directory, plus the protobuf2.6.1 license, from the [official compiler 1.6.10 ZIP](https://github.com/JetBrains/kotlin/releases/download/v1.6.10/kotlin-compiler-1.6.10.zip), with observed SHA-256 `432267996d0d6b4b17ca8de0f878e44d4a099b7e9f1587a98edc4d27e76c215a`. This release did not provide the requested ZIP SHA-256 asset. The exact shipped reflection Maven JAR is separately hashed in the runtime manifest; it is not claimed byte-identical to the ZIP's repackaged JAR. The pinned `dependencies/protobuf/build.gradle.kts` defines protobuf2.6.1. Its additional license is copied from https://raw.githubusercontent.com/protocolbuffers/protobuf/v2.6.1/LICENSE; the Kotlin relocation/build sources are at https://github.com/JetBrains/kotlin/tree/v1.6.10/dependencies/protobuf. The version-specific Kotlin sources and protobuf attribution are retained in this bundle.

The compiler's JavaScript parser includes Rhino-derived source under the Netscape Public License. Its terms are retained in `kotlin-2.4.10/third_party/rhino_LICENSE.txt`; corresponding upstream source is available at https://github.com/JetBrains/kotlin/tree/v2.4.10/js/js.parser. Kotlin-derived compiler/stdlib code and incorporated components retain their own notices; the bundle is not labeled wholly Apache-2.0.

## Other runtime dependencies

- Kotlin coroutines 1.8.0: license from https://raw.githubusercontent.com/Kotlin/kotlinx.coroutines/1.8.0/LICENSE.txt.
- IntelliJ coroutines 1.10.2-intellij-2 is a distinct published artifact. Its POM declares Apache-2.0, whose text is copied from upstream 1.10.2. Its exact published source artifact is linked in `dependencies.json`; this does not assert that the fork is identical to the ordinary 1.10.2 source tag or identify an unverified Git revision.
- Kotlin serialization core/JSON 1.11.0: https://raw.githubusercontent.com/Kotlin/kotlinx.serialization/v1.11.0/LICENSE.txt.
- JetBrains annotations 23.0.0: https://raw.githubusercontent.com/JetBrains/java-annotations/23.0.0/LICENSE.txt.
- Error Prone annotations 2.10.0: https://raw.githubusercontent.com/google/error-prone/v2.10.0/COPYING.
- Caffeine 2.9.3 and Checker Qual 3.19.0: original META-INF license entries copied directly from the shipped JARs, which retain those entries as well.

None of these upstream JARs is modified by the bridge build. Their exact versions are locked; changing them requires updating and verifying the shipped runtime inventory and notices.
