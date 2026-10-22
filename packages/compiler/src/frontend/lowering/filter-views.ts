import * as ts from "../ts7/adapter.js";
import { type IrType, typeEquals, arrayOf } from "../../ir/ir.js";
import type { Lowerer } from "./lowerer.js";
import type { FileParts } from "./lower-modules.js";

/** A tuple refinement can keep its original fields. Reads of a refined
 * dynamic or union field already use checked extraction; changing the
 * tuple's layout here would instead copy it and sever aliases. */
export function filterTupleView(lowerer: Lowerer, stored: IrType, view: IrType): boolean {
  if (typeEquals(stored, view)) return true;
  if (stored.kind === "array" && view.kind === "array")
    return filterTupleView(lowerer, stored.elem, view.elem);
  if (stored.kind === "func" && view.kind === "func")
    return (
      typeEquals({ ...stored, ret: view.ret }, view) &&
      filterTupleView(lowerer, stored.ret, view.ret)
    );
  if (stored.kind !== "record" || view.kind !== "record") return false;
  const source = lowerer.shapes.get(stored.shapeId);
  const target = lowerer.shapes.get(view.shapeId);
  if (!source?.tuple || !target?.tuple || source.fields.length !== target.fields.length)
    return false;
  return target.fields.every((field, i) => {
    const slot = source.fields[i]!;
    if (slot.name !== field.name) return false;
    if (typeEquals(slot.type, field.type)) return true;
    // Reference refinements need a view of their own: a checked cast to a
    // new record or array layout could copy the field and lose identity.
    const targetArms =
      field.type.kind === "union"
        ? (lowerer.unions.get(field.type.unionId)?.arms ?? [])
        : [field.type];
    if (
      targetArms.length === 0 ||
      !targetArms.every((arm) =>
        ["string", "f64", "bool", "bigint", "nullT", "undefinedT"].includes(arm.kind),
      )
    )
      return false;
    const fromId = slot.type.kind === "union" ? slot.type.unionId : null;
    return (
      slot.type.kind === "dyn" ||
      (fromId !== null && targetArms.every((arm) => lowerer.armTag(fromId, arm) >= 0))
    );
  });
}

/** Choose storage for filter results and their binding aliases before any
 * function body lowers. Checker types continue to supply the refined read
 * types; globals, captures and callbacks must agree on the stored layout. */
export function analyzeFilterViews(lowerer: Lowerer, parts: FileParts[]): void {
  if (!parts.some((part) => part.sf.text.includes("filter"))) return;
  // Avoid mapping unrelated function and variable types speculatively. Only
  // tuple-refining filter calls can introduce storage views into this graph.
  let hasTupleRefinement = false;
  const callKinds = new Set([ts.SyntaxKind.CallExpression]);
  for (const part of parts) {
    ts.walkPreorder(
      part.sf,
      (node) => {
        if (
          hasTupleRefinement ||
          !ts.isCallExpression(node) ||
          !ts.isPropertyAccessExpression(node.expression) ||
          node.expression.name.text !== "filter" ||
          node.arguments.nodes.length !== 1 ||
          !lowerer.isStdlibMember(node.expression)
        )
          return;
        const callback = node.arguments.nodes[0]!;
        if ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && !callback.type)
          return;
        const result = lowerer.typeOf(node);
        const source = lowerer.typeOf(node.expression.expression);
        if (!lowerer.checker.isArrayType(result) || !lowerer.checker.isArrayType(source)) return;
        const resultElement = lowerer.checker.getTypeArguments(result as ts.TypeReference)[0];
        const sourceElement = lowerer.checker.getTypeArguments(source as ts.TypeReference)[0];
        if (
          resultElement &&
          lowerer.checker.isTupleType(resultElement) &&
          resultElement.id !== sourceElement?.id
        ) {
          hasTupleRefinement = true;
          return "stop";
        }
      },
      callKinds,
    );
    if (hasTupleRefinement) break;
  }
  if (!hasTupleRefinement) return;
  const resolve = (identifier: ts.Identifier): ts.Symbol | null => {
    // This is a storage probe, not a runtime read. Leave deferred errors
    // on unreachable declarations for ordinary reference lowering to flush.
    const wasCollecting = lowerer.collecting;
    lowerer.collecting = true;
    try {
      return lowerer.resolveValueSymbol(identifier);
    } finally {
      lowerer.collecting = wasCollecting;
    }
  };
  const declarations: ts.VariableDeclaration[] = [];
  const functions: ts.FunctionDeclaration[] = [];
  for (const part of parts) {
    ts.walkPreorder(part.sf, (node) => {
      if (ts.isFunctionDeclaration(node) && node.body) functions.push(node);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        declarations.push(node);
    });
  }
  const active = new Set<ts.Symbol>();
  const expressions = new Map<ts.Expression, IrType | null>();
  let depth = 0;
  const storage = (node: ts.Expression): IrType | null => {
    if (expressions.has(node)) return expressions.get(node)!;
    // This optional proof must not overflow on a deep alias or call graph.
    // Declining it leaves the ordinary lowering and its diagnostics intact.
    if (depth >= 96) return null;
    depth++;
    try {
      const result = expressionStorage(node);
      expressions.set(node, result);
      return result;
    } finally {
      depth--;
    }
  };
  const expressionStorage = (node: ts.Expression): IrType | null => {
    while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))
      node = node.expression;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (
        node.typeParameters?.nodes.length ||
        node.asteriskToken ||
        node.modifiers?.nodes.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      )
        return null;
      const values: ts.Expression[] = [];
      let bareReturn = false;
      if (ts.isBlock(node.body)) {
        ts.walkPreorder(node.body, (child) => {
          if (ts.isFunctionLike(child)) return "skip";
          if (ts.isReturnStatement(child)) {
            if (child.expression) values.push(child.expression);
            else bareReturn = true;
          }
        });
      } else values.push(node.body);
      if (bareReturn) return null;
      let result: IrType | null = null;
      for (const value of values) {
        const type = storage(value);
        if (!type || (result && !typeEquals(result, type))) {
          result = null;
          break;
        }
        result = type;
      }
      if (!result) return null;
      const declared = lowerer.mapTypeOf(lowerer.typeOf(node));
      if (
        declared?.kind !== "func" ||
        !filterTupleView(
          lowerer,
          result,
          lowerer.runtimeOptionalFunctionReturnType(node, declared.ret),
        )
      )
        return null;
      lowerer.filterViewFunctionReturns.set(node, result);
      return { ...declared, ret: result };
    }
    if (ts.isIdentifier(node)) {
      const symbol = resolve(node);
      if (!symbol || active.has(symbol)) return null;
      const known = lowerer.filterViewBindings.get(symbol);
      if (known) return known;
      const declaration = symbol.valueDeclaration;
      if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer)
        return null;
      active.add(symbol);
      const result = storage(declaration.initializer);
      active.delete(symbol);
      return result && bind(declaration, result) ? result : null;
    }
    if (ts.isElementAccessExpression(node)) {
      const receiver = storage(node.expression);
      if (receiver?.kind !== "array") return null;
      const result = lowerer.mapTypeOf(lowerer.typeOf(node));
      if (receiver?.kind === "array" && result && filterTupleView(lowerer, receiver.elem, result))
        return receiver.elem;
      return null;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const symbol = resolve(node.expression);
      const declaration = symbol?.declarations.find(
        (candidate) => ts.isFunctionDeclaration(candidate) && candidate.body !== undefined,
      );
      if (declaration && ts.isFunctionDeclaration(declaration)) return functionStorage(declaration);
      const callable = storage(node.expression);
      if (callable?.kind === "func") return callable.ret;
    }
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "filter" ||
      node.arguments.nodes.length !== 1 ||
      !lowerer.isStdlibMember(node.expression)
    )
      return null;
    const receiver = node.expression.expression;
    const sourceView = storage(receiver);
    const callback = node.arguments.nodes[0]!;
    // Existing inferred predicates keep their original layout selection.
    // An unannotated callback only propagates a view already in its receiver.
    if (
      !sourceView &&
      (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
      !callback.type
    )
      return null;
    const resultType = lowerer.typeOf(node);
    if (!lowerer.checker.isArrayType(resultType)) return null;
    const resultElement = lowerer.checker.getTypeArguments(resultType as ts.TypeReference)[0];
    if (!resultElement || !lowerer.checker.isTupleType(resultElement)) return null;
    if (!sourceView) {
      const receiverType = lowerer.typeOf(receiver);
      if (!lowerer.checker.isArrayType(receiverType)) return null;
      const element = lowerer.checker.getTypeArguments(receiverType as ts.TypeReference)[0];
      if (element?.id === resultElement.id) return null;
    }
    const mappedSource = sourceView ?? lowerer.mapTypeOf(lowerer.typeOf(receiver));
    const source =
      !sourceView && mappedSource && ts.isIdentifier(receiver)
        ? lowerer.runtimeOptionalBindingType(receiver, mappedSource)
        : mappedSource;
    const result = lowerer.mapTypeOf(resultType);
    if (
      source?.kind !== "array" ||
      result?.kind !== "array" ||
      typeEquals(source.elem, result.elem)
    )
      return null;
    const candidates =
      source.elem.kind === "union"
        ? (lowerer.unions.get(source.elem.unionId)?.arms ?? [])
        : [source.elem];
    const hosts = candidates.filter(
      (arm) => arm.kind === "record" && filterTupleView(lowerer, arm, result.elem),
    );
    if (hosts.length !== 1) return null;
    const actual = arrayOf(hosts[0]!);
    lowerer.filterViewCalls.set(node, actual);
    return actual;
  };
  const bind = (declaration: ts.VariableDeclaration, actual: IrType): boolean => {
    const declared = lowerer.mapTypeOf(lowerer.typeOf(declaration.name));
    if (!declared || !filterTupleView(lowerer, actual, declared)) return false;
    const symbol = lowerer.checker.getSymbolAtLocation(declaration.name);
    if (!symbol) return false;
    lowerer.filterViewBindings.set(symbol, actual);
    const global = lowerer.globalsBySymbol.get(symbol);
    if (global) global.type = actual;
    return true;
  };
  const functionTypes = new Map<ts.Symbol, IrType | null>();
  const functionStorage = (declaration: ts.FunctionDeclaration): IrType | null => {
    if (
      !declaration.name ||
      !declaration.body ||
      declaration.typeParameters?.nodes.length ||
      declaration.modifiers?.nodes.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    )
      return null;
    const symbol = lowerer.checker.getSymbolAtLocation(declaration.name);
    if (!symbol || active.has(symbol)) return null;
    if (functionTypes.has(symbol)) return functionTypes.get(symbol)!;
    const signature = lowerer.fnSigsBySymbol.get(symbol);
    if (!signature || signature.generator) return null;
    active.add(symbol);
    const returns: ts.ReturnStatement[] = [];
    ts.walkPreorder(declaration.body, (node) => {
      if (ts.isFunctionLike(node)) return "skip";
      if (ts.isReturnStatement(node)) returns.push(node);
    });
    let result: IrType | null = null;
    for (const statement of returns) {
      const type = statement.expression ? storage(statement.expression) : null;
      if (!type || (result && !typeEquals(result, type))) {
        result = null;
        break;
      }
      result = type;
    }
    active.delete(symbol);
    if (result && !filterTupleView(lowerer, result, signature.returnType)) result = null;
    functionTypes.set(symbol, result);
    if (result) signature.returnType = result;
    return result;
  };
  for (const declaration of functions) functionStorage(declaration);
  for (const declaration of declarations) {
    const actual = storage(declaration.initializer!);
    if (actual) bind(declaration, actual);
  }
  // Calls consumed immediately have no binding from which to discover the
  // view. Visit them too, without lowering the receiver or callback twice.
  for (const part of parts) {
    ts.walkPreorder(
      part.sf,
      (node) => {
        if (ts.isCallExpression(node)) storage(node);
      },
      callKinds,
    );
  }
}
