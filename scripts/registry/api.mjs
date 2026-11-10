// The API of a library export as the docs site and the showcase's code drawer show it, read with the TypeScript 7 API
// from an analyze() graph (scripts/registry/analyze.mjs). Used by scripts/build-docs-data.mjs, scripts/showcase-code.ts
// and (isComponentDecl) scripts/build-registry.mjs.
import { SymbolFlags } from 'typescript/unstable/sync'
import { SyntaxKind } from 'typescript/unstable/ast'
import { isComponentName } from './items.mjs'

/** A library export's API: props for a component (own props from the TypeScript types, with defaults from the parameter's
 * destructuring and JSDoc; props inherited from React's DOM types are counted, not listed), else its signature. */
export function apiOfDecl(graph, name) {
  const d = graph.decls.get(name)
  if (!d || d.isType) return null
  const { checker } = graph
  const fn = functionNode(graph, d.node, name)
  if (isComponentName(name) && fn) {
    const param = fn.parameters?.[0]
    if (!param) return { name, kind: 'component', doc: d.doc, props: [], inherited: 0 }
    const type = checker.getTypeAtLocation(param)
    const all = type ? checker.getPropertiesOfType(type) : []
    const own = all.filter(p => p.declarations.some(x => !x.path.includes('/node_modules/')))
    const types = own.length ? checker.getTypeOfSymbol(own) : []
    const defaults = {}
    if (param.name.kind === SyntaxKind.ObjectBindingPattern) {
      for (const el of param.name.elements) if (el.initializer && !el.dotDotDotToken) defaults[(el.propertyName ?? el.name).text] = el.initializer.getText().replace(/\s+/g, ' ')
    }
    const props = own.map((p, i) => {
      const optional = !!(p.flags & SymbolFlags.Optional)
      let t = types[i] ? checker.typeToString(types[i], fn) : 'unknown'
      if (optional) t = t.replace(/ \| undefined$/, '').replace(/^undefined \| /, '')
      return { name: p.name, type: t, required: !optional, default: defaults[p.name] ?? null, doc: p.getDocumentationComment(checker).replace(/\s+/g, ' ').trim() }
    })
    // required first, then in declaration order
    props.sort((a, b) => Number(b.required) - Number(a.required))
    const inheritedFrom = [...new Set(all.filter(p => !own.includes(p)).flatMap(p => p.declarations.map(x => x.path.match(/@types\/(react|react-dom)/)?.[1] ?? 'lib')))]
    return { name, kind: 'component', doc: d.doc, props, inherited: all.length - own.length, inheritedFrom }
  }
  // hooks, helpers, constants: the type as the checker prints it
  const nameNode = d.node.name ?? d.node.declarationList?.declarations?.find(x => x.name?.text === name)?.name
  const sym = nameNode ? checker.getSymbolAtLocation(nameNode) : null
  const type = sym ? checker.getTypeOfSymbol(sym) : null
  let signature = type ? checker.typeToString(type, d.node) : ''
  if (signature.length > 400) signature = signature.slice(0, 397) + '…'
  return { name, kind: /^use[A-Z]/.test(name) ? 'hook' : fn ? 'function' : 'value', doc: d.doc, signature }
}

/** Whether a top-level declaration is a React component: a PascalCase function, or a const holding one (memo(),
 * forwardRef(), Object.assign(Config, { Root, … })). The registry and the docs props tables decide alike. */
export const isComponentDecl = (graph, d) => !d.isType && isComponentName(d.name) && !!functionNode(graph, d.node, d.name)

/** The function behind a declaration: `function X`, `const X = (…) =>`, `const X = memo(function …)`. */
function functionNode(graph, node, name) {
  if (node.kind === SyntaxKind.FunctionDeclaration) return node
  if (node.kind !== SyntaxKind.VariableStatement) return null
  let init = node.declarationList.declarations.find(x => x.name?.text === name)?.initializer
  while (init && init.kind === SyntaxKind.CallExpression) init = init.arguments?.[0]
  if (init && (init.kind === SyntaxKind.ArrowFunction || init.kind === SyntaxKind.FunctionExpression)) return init
  // Object.assign(DialogConfig, { Root, … }): the props are DialogConfig's
  if (init && init.kind === SyntaxKind.Identifier && init.text !== name) { const d = graph.decls.get(init.text); return d ? functionNode(graph, d.node, init.text) : null }
  return null
}
