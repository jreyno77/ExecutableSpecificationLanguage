@file:OptIn(org.jetbrains.kotlin.analysis.api.KaExperimentalApi::class)
package expec.kotlin

import com.intellij.openapi.util.Disposer
import com.intellij.psi.PsiElement
import kotlinx.serialization.json.*
import org.jetbrains.kotlin.analysis.api.analyze
import org.jetbrains.kotlin.analysis.api.components.KaDiagnosticCheckerFilter
import org.jetbrains.kotlin.analysis.api.projectStructure.KaSourceModule
import org.jetbrains.kotlin.analysis.api.renderer.types.impl.KaTypeRendererForSource
import org.jetbrains.kotlin.analysis.api.standalone.buildStandaloneAnalysisAPISession
import org.jetbrains.kotlin.analysis.api.symbols.KaCallableSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaClassLikeSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaConstructorSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaNamedClassSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaSymbol
import org.jetbrains.kotlin.analysis.project.structure.builder.buildKtLibraryModule
import org.jetbrains.kotlin.analysis.project.structure.builder.buildKtSdkModule
import org.jetbrains.kotlin.analysis.project.structure.builder.buildKtSourceModule
import org.jetbrains.kotlin.lexer.KtTokens
import org.jetbrains.kotlin.idea.references.mainReference
import org.jetbrains.kotlin.platform.jvm.JvmPlatforms
import org.jetbrains.kotlin.psi.*
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType
import org.jetbrains.kotlin.types.Variance
import java.nio.file.Files
import java.nio.file.Path
import kotlin.system.exitProcess

/** One supplied capture, one native session, one JSON result. Project code is never executed. */
fun main(args: Array<String>) {
    var code = 0
    val lifetime = Disposer.newDisposable("expec Kotlin query")
    try {
        require(args.size == 1)
        val request = Json.parseToJsonElement(Files.readString(Path.of(args[0]))).jsonObject
        val directory = Path.of(request.getValue("directory").jsonPrimitive.content)
        val classPath = request.getValue("classPath").jsonObject
        val roots = request.getValue("sourceRoots").jsonObject
        val sources = mutableListOf<KaSourceModule>()
        val session = buildStandaloneAnalysisAPISession(lifetime) {
            buildKtModuleProvider {
                platform = JvmPlatforms.defaultJvmPlatform
                val sdk = addModule(buildKtSdkModule {
                    addBinaryRootsFromJdkHome(Path.of(System.getProperty("java.home")), isJre = false)
                    platform = JvmPlatforms.defaultJvmPlatform
                    libraryName = "captured JDK"
                })
                val libraries = classPath.values.flatMap { it.jsonArray.map { Path.of(it.jsonPrimitive.content) } }.distinct()
                val dependencies = libraries.mapIndexed { index, path -> path to addModule(buildKtLibraryModule {
                    addBinaryRoot(path)
                    platform = JvmPlatforms.defaultJvmPlatform
                    libraryName = "captured library $index"
                }) }.toMap()
                for (scope in listOf("main", "test")) {
                    sources.add(addModule(buildKtSourceModule {
                        roots.getValue(scope).jsonArray.forEach { addSourceRoot(directory.resolve(it.jsonPrimitive.content)) }
                        addRegularDependency(sdk)
                        classPath.getValue(scope).jsonArray.forEach { addRegularDependency(dependencies.getValue(Path.of(it.jsonPrimitive.content))) }
                        if (scope == "test") { addRegularDependency(sources.first()); addFriendDependency(sources.first()) }
                        platform = JvmPlatforms.defaultJvmPlatform
                        moduleName = "captured Kotlin $scope"
                    }))
                }
            }
        }
        val files = sources.flatMap { session.modulesWithFiles.getValue(it).filterIsInstance<KtFile>() }
        val originals = files.associateWith { NativeText(directory, it) }
        val declarations = mutableListOf<JsonElement>()
        val references = mutableListOf<JsonElement>()
        val imports = mutableListOf<JsonElement>()
        val problems = mutableListOf<JsonElement>()
        for (file in files) {
            val text = originals.getValue(file)
            for (directive in file.importDirectives) imports.add(buildJsonObject { put("file", text.file); put("range", text.range(directive)) })
            for (node in file.collectDescendantsOfType<KtNamedDeclaration>()) {
                if (node.name == null) continue
                val selector = selector(node)
                if (selector.isEmpty()) continue
                declarations.add(buildJsonObject {
                    put("file", text.file); put("selector", JsonArray(selector)); put("kind", kind(node)); put("name", if (node is KtConstructor<*>) "<init>" else node.name)
                    put("range", text.range(node)); put("nameRange", text.range(if (node is KtConstructor<*>) node.getConstructorKeyword() ?: node.valueParameterList ?: node else node.nameIdentifier ?: node))
                    put("packageName", file.packageFqName.asString())
                    put("visibility", when {
                        node.hasModifier(KtTokens.PRIVATE_KEYWORD) -> "private"
                        node.hasModifier(KtTokens.PROTECTED_KEYWORD) -> "protected"
                        node.hasModifier(KtTokens.INTERNAL_KEYWORD) -> "internal"
                        else -> "public"
                    })
                    if (node is KtCallableDeclaration) analyze(node) {
                        put("returnType", node.returnType.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT))
                    }
                    if (node is KtTypeParameterListOwner) put("typeParameters", JsonArray(node.typeParameters.map { JsonPrimitive(it.name) }))
                    if (node is KtFunction) put("parameterNames", JsonArray(node.valueParameters.map { JsonPrimitive(it.name) }))
                    if (node is KtParameter) put("hasDefault", node.hasDefaultValue())
                    if (node is KtProperty) put("mutable", node.isVar)
                    if (node is KtParameter && node.hasValOrVar()) put("mutable", node.isMutable)
                    if (node is KtClass && !node.isInterface()) put("zeroArgumentConstruction",
                        (node.primaryConstructor?.let { accessible(it) } ?: node.secondaryConstructors.isEmpty()) && node.primaryConstructorParameters.all { it.hasDefaultValue() || it.isVarArg }
                            || node.secondaryConstructors.any { constructor -> accessible(constructor) && constructor.valueParameters.all { it.hasDefaultValue() || it.isVarArg } })
                    if (node is KtDeclarationWithBody) node.bodyExpression?.let { put("bodyRange", text.range(it)) }
                    if (node is KtClassOrObject) node.body?.let { put("bodyRange", text.range(it)) }
                    if (node is KtCallableDeclaration) node.typeReference?.let { put("typeRange", text.range(it)) }
                })
                if (node is KtClass && node.primaryConstructor == null && node.secondaryConstructors.isEmpty() && !node.isInterface()) analyze(node) {
                    for (constructor in (node.symbol as KaNamedClassSymbol).declaredMemberScope.constructors.filter { it.psi == node }) declarations.add(buildJsonObject {
                        put("file", text.file); put("kind", "constructor"); put("name", "<init>")
                        put("selector", JsonArray(selector + buildJsonObject {
                            put("kind", "constructor"); put("name", "<init>")
                            put("parameters", JsonArray(constructor.valueParameters.map { JsonPrimitive(it.returnType.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT)) }))
                        }))
                        put("range", text.range(node.nameIdentifier ?: node)); put("nameRange", text.range(node.nameIdentifier ?: node))
                        put("packageName", file.packageFqName.asString()); put("visibility", "public")
                    })
                }
            }
            analyze(file) {
                for (diagnostic in file.collectDiagnostics(KaDiagnosticCheckerFilter.ONLY_COMMON_CHECKERS)) {
                    if (diagnostic.severity.name == "ERROR") problems.add(buildJsonObject {
                        put("file", text.file); put("range", text.range(diagnostic.psi)); put("message", diagnostic.defaultMessage)
                        put("code", diagnostic.factoryName)
                    })
                }
                for (reference in file.collectDescendantsOfType<KtNameReferenceExpression>()) {
                    if (parents(reference).any { it is KtPackageDirective }) continue
                    val call = reference.parent as? KtCallExpression
                    val symbol = call?.takeIf { it.calleeExpression == reference }?.resolveSymbol()
                        ?: reference.mainReference.resolveToSymbol()
                        ?: reference.resolveSymbol() ?: continue
                    val target = sourceDeclaration(symbol.psi)
                    val targetFile = target?.containingFile as? KtFile
                    val owner = parents(reference).filterIsInstance<KtNamedDeclaration>().firstOrNull()
                    references.add(buildJsonObject {
                        put("file", text.file); put("range", text.range(reference.getReferencedNameElement())); put("name", reference.getReferencedName())
                        put("owner", owner?.let { JsonArray(selector(it)) } ?: JsonNull)
                        if (target != null && targetFile in originals) {
                            val selected = selector(target) + if (symbol is KaConstructorSymbol && target is KtClass) listOf(buildJsonObject {
                                put("kind", "constructor"); put("name", "<init>")
                                put("parameters", JsonArray(symbol.valueParameters.map { JsonPrimitive(it.returnType.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT)) }))
                            }) else emptyList()
                            put("targetFile", originals.getValue(targetFile!!).file); put("target", JsonArray(selected))
                        } else put("external", external(symbol))
                        put("role", if (symbol is KaConstructorSymbol) "construction" else if (reference.parent is KtCallExpression) "call" else if (parents(reference).any { it is KtTypeReference }) "type" else "reference")
                    })
                }
            }
        }
        println(buildJsonObject {
            put("files", JsonArray(files.map { JsonPrimitive(originals.getValue(it).file) }))
            put("declarations", JsonArray(declarations)); put("references", JsonArray(references)); put("problems", JsonArray(problems))
            put("imports", JsonArray(imports))
        })
    } catch (error: Throwable) {
        code = 1; error.printStackTrace(System.err)
    } finally {
        try { Disposer.dispose(lifetime) } catch (error: Throwable) { code = 1; error.printStackTrace(System.err) }
    }
    exitProcess(code)
}

private fun accessible(node: KtModifierListOwner): Boolean =
    !node.hasModifier(KtTokens.PRIVATE_KEYWORD) && !node.hasModifier(KtTokens.PROTECTED_KEYWORD) && !node.hasModifier(KtTokens.INTERNAL_KEYWORD)
private fun parents(element: PsiElement): Sequence<PsiElement> = generateSequence(element.parent) { it.parent }
private fun sourceDeclaration(psi: PsiElement?): KtNamedDeclaration? = psi as? KtNamedDeclaration
private fun kind(node: KtNamedDeclaration): String = when (node) {
    is KtConstructor<*> -> "constructor"
    is KtClass -> if (node.isInterface()) "interface" else "class"
    is KtObjectDeclaration -> "object"
    is KtNamedFunction -> "function"
    is KtTypeAlias -> "typealias"
    is KtParameter -> if (node.hasValOrVar()) "property" else "parameter"
    is KtTypeParameter -> "type-parameter"
    else -> "property"
}
private fun selector(node: KtNamedDeclaration): List<JsonElement> =
    (parents(node).filterIsInstance<KtNamedDeclaration>().filterNot { node is KtParameter && node.hasValOrVar() && it is KtPrimaryConstructor }.toList().asReversed() + node).map { declaration -> buildJsonObject {
        put("kind", kind(declaration)); put("name", if (declaration is KtConstructor<*>) "<init>" else declaration.name ?: "")
        if (declaration is KtNamedFunction || declaration is KtConstructor<*>) analyze(declaration) {
            declaration as KtFunction
            put("parameters", JsonArray(declaration.valueParameters.map { JsonPrimitive(it.returnType.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT)) }))
            declaration.receiverTypeReference?.let { put("receiver", it.type.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT)) }
        }
    } }
private fun external(symbol: KaSymbol): String = when (symbol) {
    is KaClassLikeSymbol -> symbol.classId?.asSingleFqName()?.asString()
    is KaCallableSymbol -> symbol.callableId?.asSingleFqName()?.asString()
    else -> null
} ?: symbol.javaClass.simpleName

/** PSI normalizes CRLF; observations use the caller's original UTF-16 offsets. */
private class NativeText(root: Path, source: KtFile) {
    private val path = Path.of(source.virtualFilePath)
    val file: String = root.relativize(path).toString().replace('\\', '/')
    private val original = Files.readString(path)
    private val offsets = buildList {
        var index = 0
        while (index < original.length) { add(index); if (original[index] == '\r' && original.getOrNull(index + 1) == '\n') index++; index++ }
        add(original.length)
    }
    fun range(node: PsiElement): JsonObject = buildJsonObject {
        put("start", offsets[node.textRange.startOffset]); put("end", offsets[node.textRange.endOffset])
    }
}
