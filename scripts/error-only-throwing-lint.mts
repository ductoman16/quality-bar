import {
  errorConstructors,
  nonErrorCallables,
  nonErrorConstructors,
  parentOf,
  rangeStart,
} from "./error-only-throwing-ast.mts";

export const errorOnlyThrowing = {
  rules: {
    "error-only-throwing": {
      meta: {
        messages: { errorOnly: "Thrown values must be Error instances." },
        schema: [],
        type: "problem",
      },
      create(context: import("eslint").Rule.RuleContext) {
        function variableFor(
          node: import("estree").Node,
        ): import("eslint").Scope.Variable | undefined {
          if (node.type !== "Identifier") {
            return undefined;
          }
          let scope: import("eslint").Scope.Scope | null =
            context.sourceCode.getScope(node);
          while (scope) {
            const variable = scope.variables.find(
              (candidate) => candidate.name === node.name,
            );
            if (variable) {
              return variable;
            }
            scope = scope.upper;
          }
          return undefined;
        }

        function executionScope(
          node: import("estree").Node | undefined,
        ): import("estree").Node | undefined {
          let current = node;
          while (current) {
            if (
              [
                "ArrowFunctionExpression",
                "FunctionDeclaration",
                "FunctionExpression",
                "Program",
              ].includes(current.type)
            ) {
              return current;
            }
            current = parentOf(current);
          }
          return undefined;
        }

        function isErrorConstructorIdentifier(
          node: import("estree").Node,
        ): boolean {
          if (node.type !== "Identifier") {
            return false;
          }
          const variable = variableFor(node);
          const definition = variable?.defs[0];
          if (!definition) {
            return errorConstructors.has(node.name);
          }
          if (definition.type === "ImportBinding") {
            // The lint is single-file, so we cannot follow an import to the
            // module that declares the class. Instead trust the repository
            // convention that every Error subclass ends in "Error" — grep of
            // the codebase confirms every `throw new X` uses that suffix.
            return (
              definition.node.type === "ImportSpecifier" &&
              definition.node.imported.type === "Identifier" &&
              /Error$/.test(definition.node.imported.name)
            );
          }
          if (definition.type !== "ClassName") {
            return false;
          }
          return definition.node.superClass
            ? isErrorConstructorIdentifier(definition.node.superClass)
            : false;
        }

        function bindingValue(
          variable: import("eslint").Scope.Variable | undefined,
          definition: import("eslint").Scope.Definition | undefined,
          position: number,
          scopeNode: import("estree").Node,
        ): import("estree").Node | null | undefined {
          const definitionScope = executionScope(
            definition?.type === "FunctionName"
              ? parentOf(definition.node)
              : definition?.node,
          );
          if (definitionScope !== executionScope(scopeNode)) {
            return undefined;
          }
          const writes = variable?.references.filter(
            (reference) =>
              reference.isWrite() &&
              rangeStart(reference.identifier) < position,
          );
          if (definition?.type === "FunctionName" && writes?.length === 0) {
            return definition.node;
          }
          if (!writes || writes.length === 0) {
            return undefined;
          }
          if (
            writes.length > 1 &&
            !writes.slice(1).every((reference) => {
              const assignment = parentOf(reference.identifier);
              const statement = assignment ? parentOf(assignment) : undefined;
              const container = statement ? parentOf(statement) : undefined;
              return (
                assignment?.type === "AssignmentExpression" &&
                assignment.left === reference.identifier &&
                executionScope(reference.identifier) === definitionScope &&
                statement !== undefined &&
                statement.type === "ExpressionStatement" &&
                container !== undefined &&
                (container.type === "Program" ||
                  (container.type === "BlockStatement" &&
                    (() => {
                      const parentType = parentOf(container)?.type;
                      return (
                        parentType !== undefined &&
                        [
                          "ArrowFunctionExpression",
                          "FunctionDeclaration",
                          "FunctionExpression",
                        ].includes(parentType)
                      );
                    })()))
              );
            })
          ) {
            return undefined;
          }
          return writes.at(-1)?.writeExpr;
        }

        function frozenObject(
          node: import("estree").Node,
          position: number,
        ): import("estree").ObjectExpression | undefined {
          if (node.type === "ObjectExpression") {
            return node;
          }
          const variable =
            node.type === "Identifier" ? variableFor(node) : undefined;
          const initializer =
            node.type === "CallExpression"
              ? node
              : bindingValue(variable, variable?.defs[0], position, node);
          if (initializer?.type === "Identifier") {
            return frozenObject(initializer, rangeStart(initializer));
          }
          if (
            initializer?.type !== "CallExpression" ||
            initializer.callee.type !== "MemberExpression" ||
            initializer.callee.object.type !== "Identifier" ||
            initializer.callee.object.name !== "Object" ||
            variableFor(initializer.callee.object)?.defs[0] !== undefined ||
            initializer.callee.property.type !== "Identifier" ||
            initializer.callee.property.name !== "freeze" ||
            initializer.arguments.length !== 1 ||
            initializer.arguments[0].type !== "ObjectExpression"
          ) {
            return undefined;
          }
          return initializer.arguments[0];
        }

        function frozenMemberValue(
          node: import("estree").Node,
          position: number,
        ): import("estree").Node | undefined {
          if (node.type !== "MemberExpression") {
            return undefined;
          }
          const object = frozenObject(node.object, position);
          const propertyName =
            node.computed && node.property.type === "Literal"
              ? node.property.value
              : !node.computed && node.property.type === "Identifier"
                ? node.property.name
                : undefined;
          const property = object?.properties.find(
            (candidate) =>
              candidate.type === "Property" &&
              !candidate.computed &&
              ((candidate.key.type === "Identifier" &&
                candidate.key.name === propertyName) ||
                (candidate.key.type === "Literal" &&
                  candidate.key.value === propertyName)),
          );
          return property?.type === "Property" ? property.value : undefined;
        }

        function isKnownNonError(
          node: import("estree").Node,
          checkedVariables: Set<
            import("eslint").Scope.Variable | undefined
          > = new Set(),
          position: number = rangeStart(node),
        ): boolean {
          if (
            [
              "ArrayExpression",
              "ArrowFunctionExpression",
              "FunctionExpression",
              "Literal",
              "ObjectExpression",
              "TemplateLiteral",
            ].includes(node.type) ||
            (node.type === "Identifier" && node.name === "undefined")
          ) {
            return true;
          }
          if (node.type === "NewExpression") {
            return !isErrorConstructorIdentifier(node.callee);
          }
          if (
            node.type === "Identifier" &&
            isErrorConstructorIdentifier(node)
          ) {
            return true;
          }
          if (
            node.type === "Identifier" &&
            variableFor(node)?.defs[0] === undefined &&
            nonErrorConstructors.has(node.name)
          ) {
            return true;
          }
          if (node.type === "CallExpression") {
            const variable = variableFor(node.callee);
            const definition = variable?.defs[0];
            if (
              node.callee.type === "Identifier" &&
              definition === undefined &&
              nonErrorCallables.has(node.callee.name)
            ) {
              return true;
            }
            if (
              node.callee.type === "MemberExpression" &&
              node.callee.object.type === "Identifier" &&
              node.callee.object.name === "JSON" &&
              variableFor(node.callee.object)?.defs[0] === undefined &&
              !node.callee.computed &&
              node.callee.property.type === "Identifier" &&
              node.callee.property.name === "parse" &&
              node.arguments.length === 1 &&
              node.arguments[0].type === "Literal" &&
              typeof node.arguments[0].value === "string"
            ) {
              try {
                JSON.parse(node.arguments[0].value);
                return true;
              } catch {
                return false;
              }
            }
            let functionNode =
              node.callee.type === "ArrowFunctionExpression" ||
              node.callee.type === "FunctionExpression"
                ? node.callee
                : node.callee.type === "MemberExpression"
                  ? frozenMemberValue(node.callee, position)
                  : bindingValue(variable, definition, position, node.callee);
            if (functionNode?.type === "Identifier") {
              const functionVariable = variableFor(functionNode);
              if (
                functionVariable?.defs[0] === undefined &&
                nonErrorCallables.has(functionNode.name)
              ) {
                return true;
              }
              functionNode = bindingValue(
                functionVariable,
                functionVariable?.defs[0],
                rangeStart(functionNode),
                functionNode,
              );
            }
            if (
              !functionNode ||
              (functionNode.type !== "ArrowFunctionExpression" &&
                functionNode.type !== "FunctionExpression" &&
                functionNode.type !== "FunctionDeclaration")
            ) {
              return false;
            }
            if (
              functionNode.type === "ArrowFunctionExpression" &&
              functionNode.expression
            ) {
              return isKnownNonError(
                functionNode.body,
                checkedVariables,
                position,
              );
            }
            if (functionNode.body.type !== "BlockStatement") {
              return false;
            }
            const [statement] = functionNode.body.body;
            return (
              functionNode.body.body.length === 1 &&
              statement !== undefined &&
              statement.type === "ReturnStatement" &&
              statement.argument !== null &&
              statement.argument !== undefined &&
              isKnownNonError(statement.argument, checkedVariables, position)
            );
          }
          if (node.type === "MemberExpression") {
            const value = frozenMemberValue(node, position);
            return (
              value !== undefined &&
              isKnownNonError(value, checkedVariables, position)
            );
          }
          if (node.type !== "Identifier") {
            return false;
          }
          const variable = variableFor(node);
          if (checkedVariables.has(variable)) {
            return false;
          }
          checkedVariables.add(variable);
          const definition = variable?.defs[0];
          if (
            definition?.type === "Variable" &&
            definition.node.id.type === "ObjectPattern" &&
            definition.node.init !== null &&
            definition.node.init !== undefined
          ) {
            const destructuredProperty = definition.node.id.properties.find(
              (property) =>
                property.type === "Property" &&
                ((property.value.type === "Identifier" &&
                  property.value.name === node.name) ||
                  (property.value.type === "AssignmentPattern" &&
                    property.value.left.type === "Identifier" &&
                    property.value.left.name === node.name)),
            );
            if (
              !destructuredProperty ||
              destructuredProperty.type !== "Property"
            ) {
              return false;
            }
            const sourceValue = frozenMemberValue(
              {
                computed: destructuredProperty.computed,
                object: definition.node.init,
                optional: false,
                property: destructuredProperty.key,
                type: "MemberExpression",
              },
              rangeStart(definition.node.init),
            );
            const propertyIsUndefined =
              (sourceValue?.type === "Identifier" &&
                sourceValue.name === "undefined") ||
              (sourceValue?.type === "UnaryExpression" &&
                sourceValue.operator === "void");
            const defaultValue =
              destructuredProperty.value.type === "AssignmentPattern"
                ? destructuredProperty.value.right
                : undefined;
            if (
              (sourceValue === undefined || propertyIsUndefined) &&
              defaultValue === undefined
            ) {
              return true;
            }
            const property =
              sourceValue === undefined || propertyIsUndefined
                ? defaultValue
                : sourceValue;
            return (
              property !== undefined &&
              isKnownNonError(property, checkedVariables, position)
            );
          }
          if (executionScope(definition?.node) !== executionScope(node)) {
            return false;
          }
          const value = bindingValue(variable, definition, position, node);
          return (
            value !== null &&
            value !== undefined &&
            isKnownNonError(value, checkedVariables, position)
          );
        }

        return {
          ThrowStatement(node: import("estree").ThrowStatement) {
            if (
              isKnownNonError(
                node.argument,
                new Set(),
                rangeStart(node.argument),
              )
            ) {
              context.report({ messageId: "errorOnly", node: node.argument });
            }
          },
        };
      },
    },
  },
};
