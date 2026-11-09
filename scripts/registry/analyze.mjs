// Top-level dependency graph of src/lib (and src/blocks), built with the TypeScript 7 API (typescript/unstable/sync:
// the real parser and checker, so a local variable that shadows a library name is not mistaken for it).
//
// Every top-level name is unique across src/lib (CONVENTIONS.md), so a declaration is identified by its name. For each
// top-level statement we record the text, the library names it references (resolved through the checker, imports
// included) and the external imports it uses (react, motion/react, react-dom …). `closure(roots)` then returns the
// statements a file needs, in source order, and the imports they use.
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { API, SymbolFlags } from 'typescript/unstable/sync'
import { SyntaxKind } from 'typescript/unstable/ast'

const ALIAS = SymbolFlags.Alias

/** @param {string} root repository root */
export function analyze(root, { tsconfig = 'tsconfig.app.json', extraDirs = [] } = {}) {
  const libDir = join(root, 'src/lib')
  const moduleFiles = readdirSync(libDir).filter(f => f.endsWith('.tsx')).map(f => join(libDir, f))
  const extraFiles = extraDirs.filter(d => existsSync(join(root, d))).flatMap(d => readdirSync(join(root, d)).filter(f => f.endsWith('.tsx')).map(f => join(root, d, f)))
  const api = new API({ cwd: root })
  try {
    const snap = api.updateSnapshot({ openProject: join(root, tsconfig) })
    const project = snap.getProjects()[0]
    const { program, checker } = project
    /** name → decl */
    const decls = new Map()
    const sideEffects = []
    const modules = []
    const files = [...moduleFiles, ...extraFiles]
    const parsed = files.map(file => ({ file, sf: program.getSourceFile(file) }))
    for (const { file, sf } of parsed) if (!sf) throw new Error(`not in ${tsconfig}: ${file}`)

    // pass 1: declarations and their symbols
    const topSymbol = new Map() // symbol id → name
    for (const { file, sf } of parsed) {
      const mod = { file, name: basename(file, '.tsx'), dir: file.startsWith(libDir) ? 'lib' : 'extra', imports: [], relImports: new Set(), reexports: [], exportedValues: [], statements: [] }
      modules.push(mod)
      const text = sf.text
      const nameNodes = []
      sf.statements.forEach((s, index) => {
        // the statement with its leading comments (JSDoc, section headings), without the blank lines before them
        const entry = { index, node: s, text: text.slice(s.pos, s.end).replace(/^\s*\n/, ''), names: [] }
        switch (s.kind) {
          case SyntaxKind.ImportDeclaration: {
            const from = s.moduleSpecifier.text
            const clause = s.importClause
            if (from.startsWith('.')) { mod.relImports.add(from.replace(/^\.\.?\/(lib\/)?/, '').replace(/^\.\//, '').replace(/\.tsx?$/, '')) }
            if (!clause) { if (!from.startsWith('.')) mod.imports.push({ from, sideEffect: true }); return }
            if (clause.name) mod.imports.push({ from, kind: 'default', local: clause.name.text, typeOnly: !!clause.isTypeOnly, node: clause.name })
            const nb = clause.namedBindings
            if (nb && nb.kind === SyntaxKind.NamespaceImport) mod.imports.push({ from, kind: 'namespace', local: nb.name.text, typeOnly: !!clause.isTypeOnly, node: nb.name })
            else if (nb) for (const e of nb.elements) mod.imports.push({ from, kind: 'named', local: e.name.text, imported: (e.propertyName ?? e.name).text, typeOnly: !!(clause.isTypeOnly || e.isTypeOnly), node: e.name })
            return
          }
          case SyntaxKind.ExportDeclaration: { // `export … from './x'`: the names already exist; remember for the public API
            const from = s.moduleSpecifier?.text
            if (from?.startsWith('.')) mod.reexports.push({ from: from.replace(/^\.\//, '').replace(/\.tsx?$/, ''), names: s.exportClause?.elements?.map(e => (e.propertyName ?? e.name).text) ?? null })
            return
          }
          case SyntaxKind.FunctionDeclaration: case SyntaxKind.ClassDeclaration:
          case SyntaxKind.InterfaceDeclaration: case SyntaxKind.TypeAliasDeclaration: case SyntaxKind.EnumDeclaration:
            if (s.name) entry.names.push(s.name)
            break
          case SyntaxKind.VariableStatement:
            for (const d of s.declarationList.declarations) collectBindingNames(d.name, entry.names)
            break
          case SyntaxKind.ExpressionStatement: break
          default: throw new Error(`${file}: unsupported top-level ${SyntaxKind[s.kind]}`)
        }
        mod.statements.push(entry)
        nameNodes.push(...entry.names)
        if (s.modifiers?.some(m => m.kind === SyntaxKind.ExportKeyword) && s.kind !== SyntaxKind.InterfaceDeclaration && s.kind !== SyntaxKind.TypeAliasDeclaration) mod.exportedValues.push(...entry.names.map(n => n.text))
      })
      const syms = nameNodes.length ? checker.getSymbolAtLocation(nameNodes) : []
      nameNodes.forEach((n, i) => { if (syms[i]) topSymbol.set(syms[i].id, n.text) })
      const impSyms = mod.imports.filter(i => i.node).length ? checker.getSymbolAtLocation(mod.imports.filter(i => i.node).map(i => i.node)) : []
      mod.importBySymbol = new Map()
      mod.imports.filter(i => i.node).forEach((imp, i) => { if (impSyms[i]) mod.importBySymbol.set(impSyms[i].id, imp) })
    }

    const topNames = new Set([...topSymbol.values()])
    // pass 2: references
    modules.forEach((mod, modIndex) => {
      const localImportNames = new Set(mod.imports.map(i => i.local))
      const dynamic = [] // per statement: lib modules loaded with import('./x') (lazy data such as the world map)
      const perStatement = mod.statements.map(st => {
        const ids = [], dyn = new Set()
        const own = new Set(st.names)
        const walk = n => {
          if (n.kind === SyntaxKind.Identifier) { if (!own.has(n) && (topNames.has(n.text) || localImportNames.has(n.text))) ids.push(n) }
          else if (n.kind === SyntaxKind.CallExpression && n.expression.kind === SyntaxKind.ImportKeyword && n.arguments?.[0]?.text?.startsWith('.')) dyn.add(n.arguments[0].text.replace(/^\.\//, '').replace(/\.tsx?$/, ''))
          n.forEachChild(walk)
        }
        st.node.forEachChild(walk)
        dynamic.push(dyn)
        return ids
      })
      const all = perStatement.flat()
      const syms = all.length ? checker.getSymbolAtLocation(all) : []
      let k = 0
      mod.statements.forEach((st, si) => {
        const deps = new Set(), ext = []
        for (const id of perStatement[si]) {
          let sym = syms[k++]
          if (id.parent?.kind === SyntaxKind.ShorthandPropertyAssignment && id.parent.name === id) sym = checker.getShorthandAssignmentValueSymbol(id.parent) ?? sym
          if (!sym) continue
          const top = topSymbol.get(sym.id)
          if (top) { deps.add(top); continue }
          if (sym.flags & ALIAS) {
            const imp = mod.importBySymbol.get(sym.id)
            if (!imp) continue
            if (imp.from.startsWith('.')) { if (topNames.has(imp.imported)) deps.add(imp.imported) }
            else ext.push(imp)
          }
        }
        const dynImports = {}
        for (const m of dynamic[si]) {
          const exported = modules.find(x => x.name === m)?.exportedValues ?? []
          if (!exported.length) throw new Error(`${mod.name}: import('./${m}') of a module with no exported values (analyse it first)`)
          dynImports[m] = exported
          exported.forEach(n => deps.add(n))
        }
        const names = st.names.map(n => n.text)
        const order = modIndex * 1e5 + st.index
        const exported = st.node.modifiers?.some(m => m.kind === SyntaxKind.ExportKeyword) ?? false
        const isType = st.node.kind === SyntaxKind.InterfaceDeclaration || st.node.kind === SyntaxKind.TypeAliasDeclaration
        if (!names.length) { sideEffects.push({ module: mod.name, dir: mod.dir, order, text: st.text, deps, ext, dynImports }); return }
        for (const name of names) {
          const prev = decls.get(name)
          if (prev && prev.module !== mod.name) throw new Error(`top-level name ${name} declared in ${prev.module} and ${mod.name}`)
          if (prev) { // overloads, or several names in one statement (then the same statement is shared)
            if (!prev.parts.some(p => p.order === order)) prev.parts.push({ order, text: st.text })
            deps.forEach(d => prev.deps.add(d)); prev.ext.push(...ext); Object.assign(prev.dynImports, dynImports)
            continue
          }
          decls.set(name, { name, module: mod.name, dir: mod.dir, parts: [{ order, text: st.text }], deps: new Set(deps), ext: [...ext], dynImports, exported, isType, kind: SyntaxKind[st.node.kind], doc: leadingDoc(st.text), node: st.node })
        }
      })
    })
    for (const d of decls.values()) d.deps.delete(d.name)
    return { decls, sideEffects, modules, api, project, checker, program, publicNames: publicNames(root, modules, decls), close: () => api.close() }
  } catch (e) { api.close(); throw e }
}

/** Names reachable from src/lib/index.ts (`export * from './x'`, following re-exports inside the modules). */
function publicNames(root, modules, decls) {
  const index = readFileSync(join(root, 'src/lib/index.ts'), 'utf8')
  const out = new Set()
  const seen = new Set()
  const add = name => {
    if (seen.has(name)) return
    seen.add(name)
    const mod = modules.find(m => m.name === name && m.dir === 'lib')
    if (!mod) return
    for (const d of decls.values()) if (d.module === name && d.exported) out.add(d.name)
    for (const r of mod.reexports) { if (r.names) r.names.forEach(n => out.add(n)); else add(r.from) }
  }
  for (const m of index.matchAll(/^export \* from '\.\/([\w-]+)'/gm)) add(m[1])
  for (const m of index.matchAll(/^export \{([^}]*)\} from '\.\/([\w-]+)'/gm)) m[1].split(',').map(x => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean).forEach(n => out.add(n))
  return out
}

function collectBindingNames(name, out) {
  if (name.kind === SyntaxKind.Identifier) out.push(name)
  else for (const el of name.elements ?? []) if (el.name) collectBindingNames(el.name, out)
}

/** The last JSDoc block before the declaration, as plain text (first paragraph). */
export function leadingDoc(text) {
  const m = /\/\*\*([\s\S]*?)\*\/\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|class|interface|type)\b/.exec(text)
  if (!m) return ''
  const all = [...text.slice(0, m.index + m[0].length).matchAll(/\/\*\*([\s\S]*?)\*\//g)]
  const body = all[all.length - 1][1]
  return body.split('\n').map(l => l.replace(/^\s*\* ?/, '')).join('\n').split(/\n\s*\n|\n@/)[0].replace(/\s+/g, ' ').trim()
}

/**
 * The declarations `roots` need, transitively (side-effect statements come along with any name they touch), sorted in
 * source order (modules in dependency order), plus the merged external imports.
 */
export function closure(graph, roots, moduleOrder) {
  const { decls, sideEffects } = graph
  const seen = new Set()
  const stack = [...roots]
  const effects = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (seen.has(n)) continue
    const d = decls.get(n)
    if (!d) throw new Error(`unknown name: ${n}`)
    seen.add(n)
    for (const dep of d.deps) if (!seen.has(dep)) stack.push(dep)
    for (const se of sideEffects) if (!effects.has(se) && se.deps.has(n)) { effects.add(se); for (const dep of se.deps) if (!seen.has(dep)) stack.push(dep) }
  }
  const rank = o => { const m = Math.floor(o / 1e5); return moduleOrder[m] * 1e5 + (o % 1e5) }
  const parts = []
  const ext = []
  const seenParts = new Set()
  const dynImports = {}
  for (const n of seen) {
    const d = decls.get(n)
    ext.push(...d.ext)
    Object.assign(dynImports, d.dynImports)
    for (const p of d.parts) if (!seenParts.has(p.order)) { seenParts.add(p.order); parts.push(p) }
  }
  for (const se of effects) { ext.push(...se.ext); Object.assign(dynImports, se.dynImports); parts.push({ order: se.order, text: se.text }) }
  parts.sort((a, b) => rank(a.order) - rank(b.order))
  return { names: seen, parts, ext, dynImports }
}
