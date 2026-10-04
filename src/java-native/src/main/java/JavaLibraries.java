import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.jar.JarFile;
import org.eclipse.jdt.core.dom.*;

/** Attribute an already resolved binary binding to the actual authorized native provider. */
final class JavaLibraries implements AutoCloseable {
    private final Map<Path, JarFile> jars = new LinkedHashMap<>();
    private final List<Path> directories = new ArrayList<>();
    JavaLibraries(String[] paths) throws IOException {
        try {
            for (String value : paths) {
                Path path = Path.of(value).toRealPath();
                if (Files.isDirectory(path)) directories.add(path);
                else if (!jars.containsKey(path)) jars.put(path, new JarFile(path.toFile(), false, JarFile.OPEN_READ, Runtime.Version.parse("21")));
            }
        } catch (IOException error) { close(); throw error; }
    }
    List<String> providers(IBinding binding) throws IOException {
        ITypeBinding type = binding instanceof ITypeBinding item ? item : binding instanceof IMethodBinding item ? item.getDeclaringClass()
            : binding instanceof IVariableBinding item ? item.getDeclaringClass() : null;
        if (type == null || type.isFromSource()) return null;
        String name = type.getTypeDeclaration().getBinaryName();
        if (name == null) return List.of();
        String entry = name.replace('.', '/') + ".class";
        var found = new LinkedHashSet<String>();
        for (var jar : jars.entrySet()) if (jar.getValue().getJarEntry(entry) != null) found.add(jar.getKey().toUri().toASCIIString());
        for (Path directory : directories) if (Files.isRegularFile(directory.resolve(entry))) found.add(directory.resolve(entry).toRealPath().toUri().toASCIIString());
        var module = type.getModule();
        if (module != null && !module.getName().isEmpty()) {
            var runtime = FileSystems.getFileSystem(java.net.URI.create("jrt:/"));
            if (Files.isRegularFile(runtime.getPath("/modules", module.getName(), entry)))
                found.add(Path.of(System.getProperty("java.home"), "lib", "modules").toRealPath().toUri().toASCIIString());
        }
        return List.copyOf(found);
    }
    public void close() throws IOException {
        IOException failure = null;
        for (var jar : jars.values()) try { jar.close(); } catch (IOException error) { if (failure == null) failure = error; else failure.addSuppressed(error); }
        if (failure != null) throw failure;
    }
}
