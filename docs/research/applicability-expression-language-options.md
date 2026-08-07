# Applicability expression language options

Status: research input for **Define Applicability Rule composition and precedence**; this note recommends a direction but does not make the product decision.

## Question

Can Applicability Rules reuse an established expression language instead of defining a Boolean grammar, while supporting safe evaluation, `AND`/`OR`/`NOT`, same-file path-and-content matching, globs, regexes, fail-fast handling of unavailable content, useful explanations, and more than one implementation language?

## Recommendation for consideration

Use a deliberately restricted **Common Expression Language (CEL) profile** as the expression core, plus one Quality Bar host function for changed-path glob matching. Do not use Git pathspec, GitHub Actions path filters, or a bespoke parser as the complete language.

CEL is the closest fit because it is memory-safe, side-effect-free, terminating, gradually type-checkable, and designed for embedded, compile-once/evaluate-many predicates. It standardizes Boolean operators, grouping, list quantifiers, and RE2 regular expressions; its specification also has a conformance suite and official implementations/tutorials for C++, Go, Java, and Python. [CEL language overview](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#overview), [CEL specification](https://github.com/cel-expr/cel-spec#common-expression-language), [official implementations/tutorials](https://cel.dev/tutorials/cel-get-started-tutorial)

The core same-file case is direct:

```cel
changed_files.exists(f,
  glob(f.path, "**/*.cs") &&
  f.content.matches(r'\[Fact\]') &&
  f.content.matches(r'\[TestCategory\("Unit"\)\]')
)
```

All predicates inside this `exists` bind the same `f`, so one changed file must satisfy the path and both content predicates. Cross-file composition remains explicit by using two separate `exists` expressions. CEL specifies `exists`/`all` quantification and scopes the comprehension variable to the predicate. [CEL comprehension macros](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#presence-and-comprehension-macros)

This is not zero-customization. Adoption should be conditional on all of the following:

1. **Pin one glob dialect.** Glob matching is not part of CEL's standard environment. Quality Bar must expose one total, side-effect-free `glob(path, pattern)` function and define its exact `*`, `**`, slash, anchoring, escaping, and case semantics.
2. **Compile and validate at rule creation.** CEL uses RE2 substring matching unless the expression supplies anchors. Every regex and glob should be compiled before a rule is accepted, and the whole expression should be parsed and type-checked. [CEL regex semantics](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#regular-expressions), [CEL parsing and type-checking](https://github.com/cel-expr/cel-go#parse-and-check)
3. **Bound expression cost.** CEL terminates, but nested/chained comprehensions can multiply work. The chosen runtime must enforce expression-size, nesting, and evaluation-cost limits; CEL-Go exposes a runtime `CostLimit`. [CEL macro performance](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#macro-performance), [CEL-Go cost limit](https://pkg.go.dev/github.com/google/cel-go/cel#CostLimit)
4. **Make file availability a host-input contract.** Deleted, binary, generated, oversized, or otherwise unavailable content must never be substituted with `""`, `null`, or an omitted field and treated as a non-match. The host must reject an evaluation that requires unavailable content, or the human must separately define a domain state for it.
5. **Build the explanation contract on tracked evaluation state.** CEL-Go can record intermediate values and CEL AST nodes retain source positions, which is enough to derive which file and predicate matched. CEL does not itself define Quality Bar's user-facing explanation. [CEL-Go evaluation state](https://github.com/cel-expr/cel-go#evaluate), [CEL source positions](https://github.com/cel-expr/cel-go#errors)
6. **Resolve the explicit-parentheses policy.** Standard CEL intentionally defines `!`, `&&`, and `||` precedence and therefore accepts mixed unparenthesized expressions. Requiring parentheses whenever `AND` and `OR` mix is compatible only as a stricter Quality Bar source-level lint/profile, not as unmodified CEL syntax. The lint must inspect source tokens or the parser tree because CEL-Go removes nested-parenthesis nodes when it lowers to the AST. The alternatives are to keep that lint or consciously adopt CEL's standard precedence. [CEL grammar and precedence](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#syntax), [CEL-Go parser lowering](https://github.com/cel-expr/cel-go/blob/master/parser/parser.go#L1004-L1052)

The fail-fast condition is load-bearing. CEL's logical operators can absorb an error when another operand determines the result—for example, `false && error` is `false`, and `true || error` is `true`; `exists` follows the corresponding OR behavior. Unsupported or invalid predicates therefore must be eliminated before runtime, and content availability cannot be left to incidental expression evaluation. [CEL logical-operator error semantics](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#logical-operators), [CEL `exists` semantics](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#presence-and-comprehension-macros)

## Comparison

| Candidate | Strengths | Blocking gaps / costs | Explicit-grouping fit |
| --- | --- | --- | --- |
| **CEL profile** | Safe and terminating; typed compilation; native Boolean logic and same-element `exists`; standard RE2; intermediate evaluation state; canonical spec and conformance suite | Needs one glob function, input preflight, product explanation mapping, and runtime vetting if the implementation language lacks an official CEL implementation | Conflicts with unmodified CEL because CEL has standard precedence; compatible as a stricter lint/profile |
| **JSON Logic** | Small, read-only core with no loops; `and`/`or`/`!`; `some` binds predicates to the same array element; serialized AST makes grouping structurally unambiguous; many linked language ports | No standard glob or regex; custom operators are runtime-specific and may reintroduce side effects; missing variables become `null`; no standardized per-node evaluation trace; ports and extensions require project conformance testing | Excellent structurally, but raw JSON has no parentheses and is not file-selector-like; an infix front end would again require a parser |
| **Git pathspec / GitHub Actions paths** | Familiar path globbing; established include/exclude behavior | Path-only; no content regex, arbitrary nested Boolean expressions, same-file path-plus-content predicate, or evaluation trace. Git pathspec applies exclusions as a post-pass; GitHub Actions uses ordered negative and positive patterns | Not applicable: these are path-set filters, not general expression languages |
| **OPA/Rego** | Terminating policy language; native existential/universal quantification; built-in glob and RE2 functions; strong query explanations; Go, REST, and Wasm integration | A full policy engine and module language for a narrow predicate; must restrict capabilities; missing/dynamically invalid input can become undefined unless host validation and strict error handling are added; greater operational and authoring surface | Grouping is structural across rule bodies/definitions rather than the requested infix expression style |

### JSON Logic

JSON Logic's core is intentionally small and safe: no setters, loops, functions, or `eval`, and rule nesting is an explicit AST. Its `some`/`all`/`none` operations evaluate their inner rule relative to one array element, so it can express the same-file requirement. [JSON Logic overview](https://jsonlogic.com/), [array quantifiers](https://jsonlogic.com/operations.html#all-none-and-some)

It is weaker as the canonical standard here because glob and regex are not standard operations. The JavaScript implementation can register them, but the official documentation warns that custom operations may have side effects, and that extension facility is not uniformly implemented across ports. Missing variables also become `null` unless defaulted, which is unsafe for fail-fast content handling. Core explainability is limited to a pass-through `log` operator rather than a standardized evaluation trace. [supported operations](https://jsonlogic.com/operations), [adding operations and safety caveat](https://jsonlogic.com/add_operation.html), [reference `var` behavior](https://github.com/jwadhams/json-logic-js/blob/master/logic.js#L1413-L1446), [JSON Logic debugging](https://jsonlogic.com/operations.html#log)

JSON Logic is a reasonable canonical AST if rules are built only through a UI. It is not a ready-made textual selector language; adding a friendly infix surface would reintroduce the parser work the investigation is trying to avoid.

### Git and GitHub path selection

Git pathspec defines path patterns, glob magic, attribute requirements, and exclusion as a post-filter after non-exclude pathspecs match. GitHub Actions `paths` runs when at least one changed path matches and uses ordered `!` patterns that may exclude and later re-include. Neither is an arbitrary Boolean language, neither inspects complete file contents, and neither can bind path and content predicates to the same changed-file value. [Git pathspec](https://git-scm.com/docs/gitglossary#Documentation/gitglossary.txt-aiddefpathspecapathspec), [GitHub Actions path filters](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#using-filters-to-target-specific-paths-for-pull-request-or-push-events)

Quality Bar can still borrow a positive glob dialect from one of them. It should not inherit their include/exclude composition rules because CEL's explicit Boolean `!`, `&&`, and `||` would own composition. Whichever glob dialect is chosen needs a small cross-language conformance corpus.

### OPA/Rego

Rego is the strongest runner-up when a full policy engine is desired. It prohibits recursion to preserve termination, has built-in glob and RE2 matching, supports quantification over input, exposes exact evaluation explanations, and can run through Go, REST, or Wasm. [Rego termination](https://www.openpolicyagent.org/docs/errors/rego-recursion-error/rule-name-is-recursive), [glob built-in](https://www.openpolicyagent.org/docs/policy-reference/builtins/glob), [regex built-ins](https://www.openpolicyagent.org/docs/policy-reference/builtins/regex), [tracing](https://www.openpolicyagent.org/docs/policy-reference/builtins/tracing), [integration options](https://www.openpolicyagent.org/docs/integration)

For Applicability Rules alone, that power brings a larger language, policy-module concepts, capability configuration, and undefined-value semantics. OPA documents that some runtime type problems produce undefined rather than errors and that strict built-in errors require explicit configuration. [OPA error behavior](https://www.openpolicyagent.org/docs/errors) Rego becomes preferable only if the destination expands from one applicability predicate into a broader policy platform.

## Human decisions still required

This research narrows, but does not settle, four choices:

1. Adopt a restricted CEL profile, JSON Logic AST, Rego, or a custom language.
2. Keep the explicit-parentheses lint or adopt CEL's standard precedence.
3. Choose the exact changed-path glob dialect.
4. Define what deleted, binary, generated, and oversized files mean when complete post-change text content is unavailable.
