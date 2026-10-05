import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.eclipse.jdt.core.JavaCore;
import org.eclipse.jdt.core.ToolFactory;
import org.eclipse.jdt.core.compiler.ITerminalSymbols;
import org.eclipse.jdt.core.dom.*;

/** JDT owns parsing and identity. The bridge returns only the facts its consumer queries. */
public final class ExpecJava {
    private static final Map<String, String> sources = new HashMap<>();
    private static final Map<String, Map<String, Object>> parameters = new HashMap<>();
    private static final List<Map<String, Object>> declarations = new ArrayList<>(), uses = new ArrayList<>(), problems = new ArrayList<>(), unresolved = new ArrayList<>(), comments = new ArrayList<>();
    public static void main(String[] args) throws Exception {
        Path request = Path.of(args[0]);
        var external = new HashMap<Path, String>();
        String[] entries = lines(request.resolve("external-sources"));
        for (int index = 0; index < entries.length; index += 2) external.put(Path.of(entries[index]), entries[index + 1]);
        for (String phase : List.of("main", "test")) {
            var files = lines(request.resolve(phase + "-files"));
            if (files.length == 0) continue;
            var roots = lines(request.resolve(phase + "-roots"));
            var paths = lines(request.resolve(phase + "-classpath"));
            var options = JavaCore.getOptions(); JavaCore.setComplianceOptions(JavaCore.VERSION_21, options);
            var parser = ASTParser.newParser(AST.JLS21); parser.setCompilerOptions(options);
            parser.setEnvironment(paths, roots, Collections.nCopies(roots.length, "UTF-8").toArray(String[]::new), true);
            parser.setResolveBindings(true); parser.setBindingsRecovery(false); parser.setStatementsRecovery(false);
            try (var libraries = new JavaLibraries(paths)) {
            parser.createASTs(files, Collections.nCopies(files.length, "UTF-8").toArray(String[]::new), new String[0], new FileASTRequestor() {
                public void acceptAST(String source, CompilationUnit unit) {
                    String file = external.getOrDefault(Path.of(source), request.resolve("source").relativize(Path.of(source)).toString().replace('\\', '/'));
                    try { sources.put(file, Files.readString(Path.of(source))); }
                    catch (java.io.IOException error) { throw new java.io.UncheckedIOException(error); }
                    for (var problem : unit.getProblems()) if (problem.isError()) problems.add(Map.of("file", file, "start", Math.max(0, problem.getSourceStart()),
                        "length", Math.max(0, problem.getSourceEnd() - problem.getSourceStart() + 1), "code", ((problem.getID() & org.eclipse.jdt.core.compiler.IProblem.Syntax) != 0 ? "java-syntax-" : "java-") + problem.getID(), "message", problem.getMessage()));
                    for (Object item : unit.getCommentList()) {
                        var comment = (Comment) item;
                        comments.add(Map.of("file", file, "start", comment.getStartPosition(), "length", comment.getLength(), "documentation", comment instanceof Javadoc));
                    }
                    unit.accept(new ASTVisitor() {
                        public boolean visit(MethodDeclaration method) {
                            IMethodBinding binding = method.resolveBinding();
                            if (binding == null || binding.isRecovered()) return true;
                            declaration(original(binding), method.getName(), method, file);
                            for (int index = 0; index < method.parameters().size(); index++) {
                                var parameter = (SingleVariableDeclaration) method.parameters().get(index);
                                var variable = parameter.resolveBinding();
                                if (variable == null || variable.isRecovered()) continue;
                                var item = new LinkedHashMap<String, Object>(symbol(original(binding)));
                                item.put("parameter", index); parameters.put(original(variable).getKey(), item);
                            }
                            return true;
                        }
                        public boolean visit(RecordDeclaration record) {
                            ITypeBinding binding = record.resolveBinding();
                            if (binding == null || binding.isRecovered()) return true;
                            declaration(original(binding), record.getName(), record, file);
                            for (int index = 0; index < record.recordComponents().size(); index++) {
                                var component = (SingleVariableDeclaration) record.recordComponents().get(index);
                                for (var field : binding.getDeclaredFields()) if (field.getName().equals(component.getName().getIdentifier()))
                                    declaration(original(field), component.getName(), component, file);
                                for (var method : binding.getDeclaredMethods()) if (method.isSyntheticRecordMethod() && !method.isConstructor()
                                    && method.getParameterTypes().length == 0 && method.getName().equals(component.getName().getIdentifier()))
                                    declaration(original(method), component.getName(), component, file);
                                if (Arrays.stream(record.getMethods()).noneMatch(method -> method.isConstructor() && !method.isCompactConstructor()
                                    && method.resolveBinding() != null && method.resolveBinding().isCanonicalConstructor())) {
                                    for (var method : binding.getDeclaredMethods()) if (method.isCanonicalConstructor()) {
                                        var fact = new LinkedHashMap<String, Object>(symbol(original(method)));
                                        fact.put("parameter", index); fact.put("key", original(method).getKey() + "#parameter:" + index);
                                        fact.put("file", file); fact.put("start", component.getName().getStartPosition()); fact.put("length", component.getName().getLength());
                                        fact.put("nodeStart", component.getStartPosition()); fact.put("nodeLength", component.getLength());
                                        fact.put("contract", Map.of("kind", "parameter", "type", method.getParameterTypes()[index].getQualifiedName())); declarations.add(fact);
                                    }
                                }
                            }
                            return true;
                        }
                        public boolean visit(EnhancedForStatement loop) {
                            var type = loop.getExpression().resolveTypeBinding();
                            if (type == null || !type.isArray()) implicit(loop.getExpression(), file, "Enhanced-for invokes an implicit iterator protocol; its method references are not editable source tokens.");
                            return true;
                        }
                        public boolean visit(TryStatement statement) {
                            for (Object resource : statement.resources()) implicit((ASTNode) resource, file, "Try-with-resources invokes implicit close; its method reference is not an editable source token.");
                            return true;
                        }
                        public boolean visit(ClassInstanceCreation call) { constructor(call.resolveConstructorBinding(), call.getType(), call, file, libraries); return true; }
                        public boolean visit(CreationReference call) { constructor(call.resolveMethodBinding(), call.getType(), call, file, libraries); return true; }
                        public boolean visit(SimpleName name) {
                            if (name.getParent() instanceof MethodDeclaration method && method.getName() == name) return true;
                            if (name.getParent() instanceof RecordDeclaration record && record.getName() == name) return true;
                            if (name.getParent() instanceof SingleVariableDeclaration variable && variable.getParent() instanceof RecordDeclaration) return true;
                            IBinding binding = original(name.resolveBinding());
                            if (binding == null && name.getParent() instanceof QualifiedName qualified
                                && qualified.getQualifier() == name && qualified.resolveBinding() instanceof IPackageBinding namespace
                                && !namespace.isRecovered()) binding = namespace;
                            if (binding == null || binding.isRecovered()) {
                                if (!name.isDeclaration()) {
                                    ASTNode context = name.getParent();
                                    while (context instanceof Name) context = context.getParent();
                                    unresolved.add(Map.of("file", file, "start", name.getStartPosition(), "length", name.getLength(),
                                        "role", context instanceof Type || context instanceof Annotation ? "type" : "value", "owners", owners(name), "reason", "Native binding is unavailable."));
                                }
                                return true;
                            }
                            if (binding instanceof IPackageBinding) return true;
                            var symbol = symbol(binding);
                            if (symbol == null) return true;
                            var fact = new LinkedHashMap<String, Object>(symbol);
                            fact.put("key", key(binding)); fact.put("file", file); fact.put("start", name.getStartPosition()); fact.put("length", name.getLength());
                            if (name.isDeclaration()) {
                                ASTNode node = name.getParent();
                                fact.put("nodeStart", node.getStartPosition()); fact.put("nodeLength", node.getLength()); fact.put("contract", contract(binding, node));
                                declarations.add(fact);
                            } else {
                                if (!provider(fact, binding, name, file, libraries)) return true;
                                fact.put("role", binding instanceof ITypeBinding ? "type" : "value");
                                fact.put("owners", owners(name)); uses.add(fact);
                                if (binding instanceof IMethodBinding method && method.getDeclaringClass() != null
                                    && method.getDeclaringClass().getQualifiedName().equals("java.lang.Class")
                                    && Set.of("forName", "getMethod", "getDeclaredMethod", "getField", "getDeclaredField", "newInstance").contains(method.getName()))
                                    problems.add(Map.of("file", file, "start", name.getStartPosition(), "length", name.getLength(),
                                        "code", "dynamic-native-reference", "message", "Reflection limits native reference coverage."));
                            }
                            return true;
                        }
                    });
                }
            }, null);
            }
        }
        var origins = new HashMap<String, String>();
        for (var declaration : declarations) if (((String) declaration.get("file")).startsWith("file:"))
            origins.put((String) declaration.get("key"), (String) declaration.get("file"));
        for (var use : uses) if (origins.containsKey(use.get("key"))) use.put("external", origins.get(use.get("key")));
        System.out.println(json(Map.of("format", 1, "declarations", declarations, "uses", uses, "problems", problems, "unresolved", unresolved, "comments", comments)));
    }
    private static void implicit(ASTNode node, String file, String message) {
        problems.add(Map.of("file", file, "start", node.getStartPosition(), "length", node.getLength(),
            "code", "implicit-native-reference", "message", message));
    }
    private static String[] lines(Path path) throws Exception {
        return Files.readAllLines(path, StandardCharsets.UTF_8).stream().filter(line -> !line.isEmpty())
            .map(line -> new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8)).toArray(String[]::new);
    }
    private static void declaration(IBinding binding, SimpleName name, ASTNode node, String file) {
        var value = symbol(binding);
        if (value == null) return;
        var fact = new LinkedHashMap<String, Object>(value);
        fact.put("key", key(binding)); fact.put("file", file); fact.put("start", name.getStartPosition()); fact.put("length", name.getLength());
        fact.put("nodeStart", node.getStartPosition()); fact.put("nodeLength", node.getLength()); fact.put("contract", contract(binding, node)); if (node instanceof MethodDeclaration method) fact.put("syntax", syntax(method, sources.get(file))); declarations.add(fact);
    }
    private static Map<String, Integer> span(ASTNode node) { return Map.of("start", node.getStartPosition(), "length", node.getLength()); }
    private static Map<String, Object> syntax(MethodDeclaration method, String source) {
        var value = new LinkedHashMap<String, Object>();
        if (method.getBody() != null) value.put("body", span(method.getBody()));
        if (method.getReturnType2() != null) value.put("result", span(method.getReturnType2()));
        var parameters = new ArrayList<Object>();
        for (Object item : method.parameters()) {
            var parameter = (SingleVariableDeclaration) item;
            parameters.add(Map.of("start", parameter.getStartPosition(), "length", parameter.getLength(), "type", span(parameter.getType()), "name", span(parameter.getName())));
        }
        value.put("parameters", parameters);
        var scanner = ToolFactory.createScanner(false, false, false, JavaCore.VERSION_21);
        scanner.setSource(source.toCharArray()); scanner.resetTo(method.getName().getStartPosition() + method.getName().getLength(), method.getStartPosition() + method.getLength() - 1);
        int depth = 0, close = method.isCompactConstructor() ? method.getBody().getStartPosition() : -1;
        try {
            int token;
            while (close < 0 && (token = scanner.getNextToken()) != ITerminalSymbols.TokenNameEOF) {
                if (token == ITerminalSymbols.TokenNameLPAREN) depth++;
                if (token == ITerminalSymbols.TokenNameRPAREN && --depth == 0) { close = scanner.getCurrentTokenStartPosition(); break; }
            }
        } catch (org.eclipse.jdt.core.compiler.InvalidInputException error) { throw new IllegalArgumentException(error); }
        if (close < 0) throw new IllegalArgumentException("Native method parameter boundary unavailable.");
        value.put("close", close);
        var docs = new ArrayList<Object>(); var comments = new ArrayList<Object>();
        var unit = (CompilationUnit) method.getRoot(); int boundary = method.getStartPosition();
        if (method.getJavadoc() != null) docs.add(span(method.getJavadoc()));
        var all = unit.getCommentList();
        for (int index = all.size() - 1; index >= 0; index--) {
            var comment = (Comment) all.get(index);
            int end = comment.getStartPosition() + comment.getLength();
            if (end > boundary) continue;
            if (!source.substring(end, boundary).isBlank()) break;
            if (comment instanceof Javadoc) docs.add(span(comment));
            boundary = comment.getStartPosition();
        }
        for (Object item : all) {
            var comment = (Comment) item;
            if (!(comment instanceof Javadoc) && comment.getStartPosition() >= method.getStartPosition() && comment.getStartPosition() < close)
                comments.add(span(comment));
        }
        value.put("docs", docs); value.put("comments", comments); return value;
    }
    private static Map<String, Object> contract(IBinding binding, ASTNode node) {
        if (binding instanceof ITypeBinding item) {
            if (node instanceof RecordDeclaration record) {
                boolean initialization = !record.superInterfaceTypes().isEmpty();
                for (Object member : record.bodyDeclarations()) {
                    if (member instanceof Initializer) initialization = true;
                    if (member instanceof FieldDeclaration field) for (Object fragment : field.fragments())
                        if (((VariableDeclarationFragment) fragment).getInitializer() != null) initialization = true;
                }
                return Map.of("kind", "record", "initialization", initialization);
            }
            return Map.of("kind", item.isRecord() ? "record" : item.isInterface() ? "interface" : "class");
        }
        if (binding instanceof IMethodBinding item) {
            var shape = new LinkedHashMap<String, Object>();
            shape.put("kind", item.isConstructor() ? "constructor" : "method");
            if (item.isConstructor()) shape.put("canonical", item.isCanonicalConstructor());
            shape.put("public", Modifier.isPublic(item.getModifiers())); shape.put("static", Modifier.isStatic(item.getModifiers()));
            shape.put("parameters", Arrays.stream(item.getParameterTypes()).map(ITypeBinding::getQualifiedName).toList());
            shape.put("result", item.isConstructor() ? "void" : item.getReturnType().getQualifiedName());
            shape.put("throws", Arrays.stream(item.getExceptionTypes()).map(ITypeBinding::getQualifiedName).sorted().toList());
            return shape;
        }
        if (binding instanceof IVariableBinding item) return Map.of("kind", item.isField() ? "field" : "parameter", "type", item.getType().getQualifiedName());
        return Map.of();
    }
    private static void constructor(IMethodBinding binding, Type type, ASTNode call, String file, JavaLibraries libraries) {
        if (binding == null || binding.isRecovered()) return;
        while (type instanceof ParameterizedType parameterized) type = parameterized.getType();
        SimpleName name = type instanceof SimpleType simple ? (simple.getName() instanceof QualifiedName qualified ? qualified.getName() : (SimpleName) simple.getName())
            : type instanceof QualifiedType qualified ? qualified.getName() : type instanceof NameQualifiedType qualified ? qualified.getName() : null;
        if (name == null) return;
        binding = binding.getMethodDeclaration(); var fact = new LinkedHashMap<String, Object>(symbol(binding));
        if (!provider(fact, binding, name, file, libraries)) return;
        fact.put("key", key(binding)); fact.put("file", file); fact.put("start", name.getStartPosition()); fact.put("length", name.getLength());
        fact.put("role", "value"); fact.put("owners", owners(call)); uses.add(fact);
    }
    private static boolean provider(Map<String, Object> fact, IBinding binding, SimpleName name, String file, JavaLibraries libraries) {
        try {
            var providers = libraries.providers(binding);
            if (providers == null) return true;
            if (providers.size() == 1) { fact.put("external", providers.get(0)); return true; }
            unresolved.add(Map.of("file", file, "start", name.getStartPosition(), "length", name.getLength(),
                "role", binding instanceof ITypeBinding ? "type" : "value", "owners", owners(name), "reason", "Native binary provider is missing or ambiguous."));
        } catch (Exception error) {
            problems.add(Map.of("file", file, "start", name.getStartPosition(), "length", name.getLength(),
                "code", "native-input-unavailable", "message", error.toString()));
        }
        return false;
    }
    private static IBinding original(IBinding binding) {
        if (binding instanceof ITypeBinding type) return type.getTypeDeclaration();
        if (binding instanceof IMethodBinding method) return method.getMethodDeclaration();
        if (binding instanceof IVariableBinding variable) return variable.getVariableDeclaration();
        return binding;
    }
    private static String type(ITypeBinding binding) {
        if (binding.isPrimitive()) return binding.getName();
        if (binding.isArray()) return type(binding.getElementType()) + "[]".repeat(binding.getDimensions());
        var erased = binding.getErasure();
        return erased.getBinaryName() == null ? erased.getQualifiedName() : erased.getBinaryName();
    }
    private static String key(IBinding binding) {
        if (binding instanceof IVariableBinding variable && variable.isParameter() && variable.getDeclaringMethod() != null
            && variable.getDeclaringMethod().isCanonicalConstructor()) {
            var method = variable.getDeclaringMethod().getMethodDeclaration();
            int index = Arrays.asList(method.getParameterNames()).indexOf(variable.getName());
            if (index >= 0) return method.getKey() + "#parameter:" + index;
        }
        return binding.getKey();
    }
    private static Map<String, Object> symbol(IBinding binding) {
        if (parameters.containsKey(binding.getKey())) return parameters.get(binding.getKey());
        if (binding instanceof IVariableBinding variable && variable.isParameter() && variable.getDeclaringMethod() != null
            && variable.getDeclaringMethod().isCanonicalConstructor()) {
            var method = variable.getDeclaringMethod().getMethodDeclaration();
            int index = Arrays.asList(method.getParameterNames()).indexOf(variable.getName());
            if (index >= 0) { var value = new LinkedHashMap<String, Object>(symbol(method)); value.put("parameter", index); return value; }
        }
        if (binding instanceof ITypeBinding item && !item.isTypeVariable() && !item.isPrimitive() && !item.isArray()) return Map.of("type", type(item));
        if (binding instanceof IMethodBinding item && item.getDeclaringClass() != null) {
            var member = new LinkedHashMap<String, Object>();
            member.put("kind", item.isConstructor() ? "constructor" : "method");
            if (!item.isConstructor()) { member.put("name", item.getName()); member.put("static", Modifier.isStatic(item.getModifiers())); }
            member.put("parameters", Arrays.stream(item.getParameterTypes()).map(ExpecJava::type).toList());
            return Map.of("type", type(item.getDeclaringClass()), "member", member);
        }
        if (binding instanceof IVariableBinding item && item.isField() && item.getDeclaringClass() != null)
            return Map.of("type", type(item.getDeclaringClass()), "member", Map.of("kind", "field", "name", item.getName()));
        return null;
    }
    private static List<String> owners(ASTNode node) {
        var result = new ArrayList<String>();
        for (ASTNode parent = node.getParent(); parent != null; parent = parent.getParent()) {
            IBinding binding = parent instanceof MethodDeclaration method ? method.resolveBinding()
                : parent instanceof AbstractTypeDeclaration type ? type.resolveBinding() : null;
            if (binding != null && !binding.isRecovered()) result.add(original(binding).getKey());
        }
        return result;
    }
    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof String text) {
            var quoted = new StringBuilder("\"");
            for (char c : text.toCharArray()) switch (c) {
                case '"' -> quoted.append("\\\""); case '\\' -> quoted.append("\\\\");
                case '\n' -> quoted.append("\\n"); case '\r' -> quoted.append("\\r"); case '\t' -> quoted.append("\\t");
                default -> { if (c < 32) quoted.append(String.format("\\u%04x", (int)c)); else quoted.append(c); }
            }
            return quoted.append('"').toString();
        }
        if (value instanceof Map<?, ?> map) return "{" + String.join(",", map.entrySet().stream().map(entry -> json(entry.getKey()) + ":" + json(entry.getValue())).toList()) + "}";
        if (value instanceof Collection<?> list) return "[" + String.join(",", list.stream().map(ExpecJava::json).toList()) + "]";
        return value.toString();
    }
}
