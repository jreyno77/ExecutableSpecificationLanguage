# Relationships derived from declared uses

The user accepted this approach on September 25, 2026. Relationships have no separate source keyword. They arise from dependencies, construction parameters, capability/function inputs and outputs, and typed fields.

```expec
concept X {
  depends on Y
  construction(y: Y)
  public make
  capability make() returns Y
}
concept Y {
  public handle
  capability handle(x: X) returns Nothing
}
```

The dependency identifies X as dependent on Y. Construction receives Y into X: X ← Y. The make capability supplies Y from X: X → Y. Y.handle receives X: Y ← X. These are distinct uses with their own source locations, even when they connect the same pair of concepts.

The resolved model exposes derived records with owner, target, source, kind, and direction. Input means target → owner; output means owner → target; reference means a declared dependency or field reference without claiming value flow. A diagram can display its own conventional arrowheads while retaining the underlying facts. Generic arguments remain inspectable references too. Builtin types do not become project-concept relationships.

A reference does not establish ownership, shared lifetime, object creation, an actual method call, or an execution order. Explicit interactions retain their ordered message semantics. The old proposed ownership syntax and the pending requirement to invent a replacement are superseded by this decision.
