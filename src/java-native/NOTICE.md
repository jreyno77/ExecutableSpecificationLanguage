# Java native analysis resources

The unmodified runtime JARs beside this file are dependencies of the private Expec Java bridge. `artifacts.json` records their exact filenames, SHA-256 digests, Maven coordinates, matching source-archive URLs and reproduced notice paths. `notices/` retains their embedded notices and license texts, which also remain inside each JAR. The Gradle wrapper JAR retains its embedded `META-INF/LICENSE`.

Eclipse JDT, Eclipse Platform, Equinox, JNA and OSGi sources are available through the exact Maven Central source links in the shipped manifest. Repository builds select those versions through `src/java-native/gradle.lockfile`.

- Eclipse JDT: https://github.com/eclipse-jdt/eclipse.jdt.core
- Eclipse Platform: https://github.com/eclipse-platform
- Eclipse Equinox: https://github.com/eclipse-equinox
- JNA: https://github.com/java-native-access/jna
- OSGi: https://github.com/osgi/osgi

These libraries provide native parsing and binding; no application classes are added to the bridge's launch classpath.
