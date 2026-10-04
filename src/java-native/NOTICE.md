# Java native analysis resources

The unmodified runtime JARs beside this file are dependencies of the private Expec Java bridge. `artifacts.json` records their exact filenames and SHA-256 digests; `notices/` reproduces their embedded notices and license texts, which also remain inside each JAR.

Eclipse JDT, Eclipse Platform and Equinox sources are available from the Eclipse projects and the matching Maven Central `-sources.jar` artifacts. JNA and OSGi sources are likewise available from their matching Maven Central source artifacts. The exact resolved versions are recorded in the repository's `src/java-native/gradle.lockfile`.

- Eclipse JDT: https://github.com/eclipse-jdt/eclipse.jdt.core
- Eclipse Platform: https://github.com/eclipse-platform
- Eclipse Equinox: https://github.com/eclipse-equinox
- JNA: https://github.com/java-native-access/jna
- OSGi: https://github.com/osgi/osgi

These libraries provide native parsing and binding; no application classes are added to the bridge's launch classpath.
