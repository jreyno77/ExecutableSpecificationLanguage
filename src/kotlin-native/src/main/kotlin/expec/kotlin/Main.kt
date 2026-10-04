@file:OptIn(org.jetbrains.kotlin.analysis.api.KaExperimentalApi::class)
package expec.kotlin

import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiElement
import com.intellij.mock.MockComponentManager
import kotlinx.serialization.json.*
import org.jetbrains.kotlin.analysis.api.analyze
import org.jetbrains.kotlin.analysis.api.KaSession
import org.jetbrains.kotlin.analysis.api.components.KaDiagnosticCheckerFilter
import org.jetbrains.kotlin.analysis.api.projectStructure.KaSourceModule
import org.jetbrains.kotlin.analysis.api.renderer.types.impl.KaTypeRendererForSource
import org.jetbrains.kotlin.analysis.api.standalone.buildStandaloneAnalysisAPISession
import org.jetbrains.kotlin.analysis.api.symbols.KaCallableSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaClassLikeSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaConstructorSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaFunctionSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaNamedClassSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaPropertySymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaSymbol
import org.jetbrains.kotlin.analysis.api.symbols.KaValueParameterSymbol
import org.jetbrains.kotlin.analysis.project.structure.builder.buildKtLibraryModule
import org.jetbrains.kotlin.analysis.project.structure.builder.buildKtSdkModule
import org.jetbrains.kotlin.analysis.project.structure.builder.buildKtSourceModule
import org.jetbrains.kotlin.lexer.KtTokens
import org.jetbrains.kotlin.idea.references.KtReference
import org.jetbrains.kotlin.kdoc.psi.impl.KDocName
import org.jetbrains.kotlin.references.utils.KotlinKDocResolutionStrategyProviderService
import org.jetbrains.kotlin.platform.jvm.JvmPlatforms
import org.jetbrains.kotlin.psi.*
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType
import org.jetbrains.kotlin.analysis.api.types.KaErrorType
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
        // This immutable capture uses K2's default strategy without an IDE registry-change listener.
        val project = session.project as MockComponentManager
        project.picoContainer.unregisterComponent(KotlinKDocResolutionStrategyProviderService::class.java.name)
        project.registerService(KotlinKDocResolutionStrategyProviderService::class.java, object : KotlinKDocResolutionStrategyProviderService {
            override fun shouldUseExperimentalStrategy() = true
            override fun dispose() {}
        })
        val files = sources.flatMap { session.modulesWithFiles.getValue(it).filterIsInstance<KtFile>() }
        val originals = files.associateWith { NativeText(directory, it) }
        val declarations = mutableListOf<JsonElement>()
        val references = mutableListOf<JsonElement>()
        val imports = mutableListOf<JsonElement>()
        val problems = mutableListOf<JsonElement>()
        val typeChecks = mutableListOf<JsonElement>()
        val requestedChecks = request["typeChecks"]?.jsonArray ?: JsonArray(emptyList())
        for (file in files) {
            val text = originals.getValue(file)
            for (directive in file.importDirectives) imports.add(buildJsonObject { put("file", text.file); put("range", text.range(directive)) })
            for (node in file.collectDescendantsOfType<KtNamedDeclaration>()) {
                if (node.name == null && node !is KtObjectDeclaration && node !is KtNamedFunction) continue
                val selector = selector(node, text)
                if (selector.isEmpty()) continue
                if (node is KtNamedFunction && requestedChecks.any { it.jsonObject["file"]?.jsonPrimitive?.content == text.file && it.jsonObject["name"]?.jsonPrimitive?.content == node.name }) analyze(node) {
                    val actual = node.bodyExpression?.expressionType
                    val expected = node.returnType
                    typeChecks.add(buildJsonObject {
                        put("file", text.file); put("name", node.name)
                        put("matches", node.typeReference != null && !node.hasBlockBody() && actual != null && actual !is KaErrorType && expected !is KaErrorType && expected.semanticallyEquals(actual))
                    })
                }
                declarations.add(buildJsonObject {
                    put("file", text.file); put("selector", JsonArray(selector)); put("kind", kind(node)); put("name", nativeName(node, text)); if (node.name == null) put("synthetic", true)
                    put("range", text.range(node)); put("nameRange", text.range(if (node is KtConstructor<*>) node.getConstructorKeyword() ?: (node.parent as? KtClassOrObject)?.nameIdentifier ?: node else node.nameIdentifier ?: node))
                    node.docComment?.let { put("docRange", text.range(it)) }
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
                    if (node is KtProperty) {
                        put("mutable", node.isVar)
                        put("storedProperty", analyze(node) { storedProperty(node) })
                    }
                    if (node is KtParameter && node.hasValOrVar()) {
                        put("mutable", node.isMutable)
                        put("storedProperty", analyze(node) { storedProperty(node) })
                    }
                    if (node is KtClass) put("dataConstruction", !node.isInterface() && !node.isEnum() && !node.isAnnotation()
                        && !node.hasModifier(KtTokens.INNER_KEYWORD) && node.secondaryConstructors.isEmpty()
                        && node.primaryConstructorParameters.all { it.hasValOrVar() && (it.defaultValue == null || it.defaultValue?.text == "null") }
                        && node.companionObjects.isEmpty() && node.superTypeListEntries.isEmpty()
                        && node.declarations.none { it is KtProperty || it is KtClassInitializer })
                    if (node is KtClass && node !is KtEnumEntry && !node.isInterface()) put("zeroArgumentConstruction",
                        (node.primaryConstructor?.let { accessible(it) } ?: node.secondaryConstructors.isEmpty()) && node.primaryConstructorParameters.all { it.hasDefaultValue() || it.isVarArg }
                            || node.secondaryConstructors.any { constructor -> accessible(constructor) && constructor.valueParameters.all { it.hasDefaultValue() || it.isVarArg } })
                    if (node is KtClass && node !is KtEnumEntry) analyze(node) {
                        put("readableProperties", JsonArray((node.symbol as KaNamedClassSymbol).memberScope.callables.filterIsInstance<KaPropertySymbol>()
                            .filter { !it.isExtension && it.visibility.name in setOf("PUBLIC", "PROTECTED") }.map { property -> buildJsonObject {
                                put("name", property.name.asString())
                                put("type", property.returnType.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT))
                            } }.toList()))
                    }
                    if (node is KtDeclarationWithBody) node.bodyExpression?.let { put("bodyRange", text.range(it)) }
                    if (node is KtClassOrObject) {
                        node.body?.let { put("bodyRange", text.range(it)) }
                        put("superTypeRanges", JsonArray(node.superTypeListEntries.mapNotNull { it.typeReference }.map { text.range(it) }))
                    }
                    if (node is KtCallableDeclaration) node.typeReference?.let { put("typeRange", text.range(it)) }
                    if (node is KtNamedFunction) node.valueParameterList?.let { put("typePosition", text.range(it).getValue("end")) }
                })
                if (node is KtClass && node !is KtEnumEntry && node.primaryConstructor == null && node.secondaryConstructors.isEmpty() && !node.isInterface()) analyze(node) {
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
                for (reference in file.collectDescendantsOfType<KtElement>().flatMap { it.references.filterIsInstance<KtReference>() }) {
                    val element = reference.element
                    if (parents(element).any { it is KtPackageDirective }) continue
                    val call = element.parent as? KtCallExpression
                    val direct = call?.takeIf { it.calleeExpression == element }?.resolveSymbol()
                    for (symbol in direct?.let { listOf(it) } ?: reference.resolveToSymbols()) {
                        val target = sourceDeclaration(symbol.psi)
                        val targetFile = target?.containingFile as? KtFile
                        val owner = parents(element).filterIsInstance<KtNamedDeclaration>().firstOrNull()
                        references.add(buildJsonObject {
                            put("file", text.file); put("range", text.range((element as? KtSimpleNameExpression)?.getReferencedNameElement()?.textRange ?: reference.absoluteRange)); put("name", (element as? KtSimpleNameExpression)?.getReferencedName() ?: reference.canonicalText)
                            put("owner", owner?.let { JsonArray(selector(it, text)) } ?: JsonNull)
                            if (target != null && targetFile in originals) {
                                val selected = selector(target, originals.getValue(targetFile!!)) + if (symbol is KaConstructorSymbol && target is KtClass) listOf(buildJsonObject {
                                    put("kind", "constructor"); put("name", "<init>")
                                    put("parameters", JsonArray(symbol.valueParameters.map { JsonPrimitive(it.returnType.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT)) }))
                                }) else emptyList()
                                put("targetFile", originals.getValue(targetFile!!).file); put("target", JsonArray(selected))
                            } else put("external", external(symbol))
                            put("role", if (element is KDocName) "reference" else if (symbol is KaConstructorSymbol) "construction" else if (element is KtOperationReferenceExpression || element !is KtSimpleNameExpression || element.parent is KtCallExpression) "call" else if (parents(element).any { it is KtTypeReference }) "type" else "reference")
                        })
                    }
                }
            }
        }
        println(buildJsonObject {
            put("files", JsonArray(files.map { JsonPrimitive(originals.getValue(it).file) }))
            put("typeChecks", JsonArray(typeChecks))
            put("declarations", JsonArray(declarations)); put("references", JsonArray(references.distinct())); put("problems", JsonArray(problems))
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
    is KtEnumEntry -> "property"
    is KtClass -> if (node.isInterface()) "interface" else "class"
    is KtObjectDeclaration -> "object"
    is KtNamedFunction -> "function"
    is KtTypeAlias -> "typealias"
    is KtParameter -> if (node.hasValOrVar()) "property" else "parameter"
    is KtTypeParameter -> "type-parameter"
    else -> "property"
}
/** A final native data slot cannot dispatch observation to an application accessor. */
private fun KaSession.storedProperty(node: KtNamedDeclaration): Boolean {
    val property: KaPropertySymbol = when (node) {
        is KtProperty -> node.symbol as? KaPropertySymbol
        is KtParameter -> (node.symbol as? KaValueParameterSymbol)?.generatedPrimaryConstructorProperty
        else -> null
    } ?: return false
    val owner = parents(node).filterIsInstance<KtClass>().firstOrNull()
    val final = property.modality.name == "FINAL" || owner?.symbol?.modality?.name == "FINAL"
    return final && property.hasBackingField && !property.isDelegatedProperty && !property.isExtension
        && property.getter?.isNotDefault != true && property.setter?.isNotDefault != true
}
private fun nativeName(node: KtNamedDeclaration, text: NativeText): String =
    if (node is KtConstructor<*>) "<init>" else node.name ?: "<anonymous@" + text.range(node).getValue("start") + ">"
private fun selector(node: KtNamedDeclaration, text: NativeText): List<JsonElement> =
    (parents(node).filterIsInstance<KtNamedDeclaration>().filterNot { node is KtParameter && node.hasValOrVar() && it is KtPrimaryConstructor }.toList().asReversed() + node).map { declaration -> buildJsonObject {
        put("kind", kind(declaration)); put("name", nativeName(declaration, text))
        if (declaration is KtNamedFunction || declaration is KtConstructor<*>) analyze(declaration) {
            declaration as KtFunction
            put("parameters", JsonArray(declaration.valueParameters.map { JsonPrimitive(it.returnType.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT)) }))
            declaration.receiverTypeReference?.let { put("receiver", it.type.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT)) }
        }
    } }
private fun KaSession.external(symbol: KaSymbol): String = when (symbol) {
    is KaClassLikeSymbol -> symbol.classId?.asSingleFqName()?.asString()
    is KaCallableSymbol -> symbol.callableId?.asSingleFqName()?.asString()?.let { name ->
        name + (symbol.receiverParameter?.let { " on " + it.returnType.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT) } ?: "") +
            if (symbol is KaFunctionSymbol) symbol.valueParameters.joinToString(",", "(", ")") { it.returnType.render(KaTypeRendererForSource.WITH_QUALIFIED_NAMES, Variance.INVARIANT) } else ""
    }
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
    fun range(node: PsiElement): JsonObject = range(node.textRange)
    fun range(range: TextRange): JsonObject = buildJsonObject {
        put("start", offsets[range.startOffset]); put("end", offsets[range.endOffset])
    }
}
