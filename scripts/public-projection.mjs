import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DOCS = path.join(ROOT, 'docs')
export const PUBLIC_SOURCE_ROOT = path.join(ROOT, 'public-docs-source')

export const PUBLIC_ROOTS = [
  { path: '01-start', title: 'Начало работы' },
  { path: '02-interface', title: 'Интерфейс' },
  { path: '03-technology', title: 'Технологии и компоненты' },
  { path: '04-developers', title: 'Для разработчиков' },
]

// Canonical docs/ files are the only content sources. This manifest is the
// public product projection: it assigns product URLs and breadcrumbs without
// exposing the internal vault taxonomy.
export const PUBLIC_ENTRIES = [
  { publicPath: '01-start/about', source: 'docs/01-project/about.md', title: 'О продукте' },
  { publicPath: '01-start/capabilities', source: 'docs/index.md', title: 'Возможности' },
  { publicPath: '01-start/requirements', source: 'docs/01-project/requirements.md', title: 'Требования' },
  { publicPath: '01-start/installation', source: 'docs/01-project/installation.md', title: 'Установка' },
  { publicPath: '01-start/first-start', source: 'docs/01-project/first-start.md', title: 'Первый запуск' },
  { publicPath: '01-start/update', source: 'docs/01-project/update.md', title: 'Обновление' },
  { publicPath: '01-start/uninstall', source: 'docs/01-project/uninstall.md', title: 'Удаление' },
  { publicPath: '02-interface/dashboard', source: 'docs/03-products/dashboard.md', title: 'Главная' },
  { publicPath: '02-interface/dpi', source: 'docs/03-products/control.md', title: 'Обход DPI' },
  { publicPath: '02-interface/dpi/strategies', source: 'docs/03-products/strategy/index.md', title: 'Стратегии' },
  { publicPath: '02-interface/dpi/scanner', source: 'docs/03-products/scanner/index.md', title: 'Сканер' },
  { publicPath: '02-interface/proxy-routing/telegram-proxy', source: 'docs/03-products/telegram-proxy.md', title: 'Telegram Proxy' },
  { publicPath: '02-interface/proxy-routing/warp-masque', source: 'docs/03-products/warp.md', title: 'WARP / MASQUE' },
  { publicPath: '02-interface/services-domains', source: 'docs/03-products/services-domains.md', title: 'Сервисы и домены' },
  { publicPath: '02-interface/resources', source: 'docs/03-products/resources.md', title: 'Ресурсы' },
  { publicPath: '02-interface/dns', source: 'docs/03-products/dns.md', title: 'DNS' },
  { publicPath: '02-interface/monitoring', source: 'docs/03-products/monitoring.md', title: 'Мониторинг' },
  { publicPath: '02-interface/logs', source: 'docs/03-products/logs.md', title: 'Журналы' },
  { publicPath: '02-interface/components', source: 'docs/03-products/components.md', title: 'Компоненты' },
  { publicPath: '02-interface/backups', source: 'docs/03-products/backups.md', title: 'Резервные копии' },
  { publicPath: '02-interface/settings', source: 'docs/03-products/settings.md', title: 'Настройки' },
  { publicPath: '03-technology/zapret2-engine', source: 'docs/03-products/zapret2-engine.md', title: 'Движок Zapret2' },
  { publicPath: '03-technology/z2k-core', source: 'docs/03-products/z2k-core.md', title: 'Ядро Z2K' },
  { publicPath: '03-technology/strategy', source: 'docs/03-products/strategy-runtime.md', title: 'Стратегия Strategy' },
  { publicPath: '03-technology/autocircular', source: 'docs/03-products/autocircular.md', title: 'Autocircular' },
  { publicPath: '03-technology/scanner', source: 'docs/03-products/scanner-runtime.md', title: 'Сканер Scanner' },
  { publicPath: '03-technology/avatar-catalog', source: 'docs/03-products/avatar-catalog.md', title: 'Каталог Avatar' },
  { publicPath: '03-technology/asset-registry', source: 'docs/03-products/asset-registry.md', title: 'Реестр assets' },
  { publicPath: '03-technology/nfqueue', source: 'docs/03-products/nfqueue.md', title: 'NFQUEUE' },
  { publicPath: '03-technology/dnsmasq', source: 'docs/03-products/dnsmasq.md', title: 'DNS и dnsmasq' },
  { publicPath: '03-technology/telegram-proxy', source: 'docs/03-products/telegram-proxy-runtime.md', title: 'Прокси Telegram' },
  { publicPath: '03-technology/warp-masque', source: 'docs/03-products/warp-runtime.md', title: 'Маршрутизация WARP / MASQUE' },
  { publicPath: '04-developers/architecture', source: 'docs/08-development/architecture.md', title: 'Архитектура' },
  { publicPath: '04-developers/runtime-ownership', source: 'docs/08-development/runtime-ownership.md', title: 'Владение runtime' },
  { publicPath: '04-developers/strategy-lifecycle', source: 'docs/07-decisions/adr-005-strategy-apply-authority.md', title: 'Жизненный цикл Strategy' },
  { publicPath: '04-developers/scanner-architecture', source: 'docs/02-architecture/scanner-runtime-authority.md', title: 'Архитектура Scanner' },
  { publicPath: '04-developers/z2k-avatar-integration', source: 'docs/08-development/z2k-avatar-integration.md', title: 'Интеграция Z2K и Avatar' },
  { publicPath: '04-developers/resource-asset-model', source: 'docs/08-development/resource-asset-model.md', title: 'Модель ресурсов и assets' },
  { publicPath: '04-developers/api-rpc', source: 'docs/08-development/api-rpc.md', title: 'API и RPC' },
  { publicPath: '04-developers/apk-build', source: 'docs/08-development/apk-build.md', title: 'Сборка APK' },
  { publicPath: '04-developers/adr', source: 'docs/07-decisions/index.md', title: 'ADR' },
]

const REWRITES = [
  [/\.\/01-project\//g, './01-start/'],
  [/\.\/03-products\/index\.md/g, './02-interface/'],
  [/\.\/03-products\/dashboard\.md/g, './02-interface/dashboard.md'],
  [/\.\/03-products\/control\.md/g, './02-interface/dpi.md'],
  [/\.\/03-products\/strategy\/index\.md/g, './02-interface/dpi/strategies.md'],
  [/\.\/03-products\/scanner\/index\.md/g, './02-interface/dpi/scanner.md'],
  [/\.\/03-products\/services-domains\.md/g, './02-interface/services-domains.md'],
  [/\.\/03-products\/resources\.md/g, './02-interface/resources.md'],
  [/\.\/03-products\/dns\.md/g, './02-interface/dns.md'],
  [/\.\/03-products\/telegram-proxy\.md/g, './02-interface/proxy-routing/telegram-proxy.md'],
  [/\.\/03-products\/warp\.md/g, './02-interface/proxy-routing/warp-masque.md'],
  [/\.\/03-products\/monitoring\.md/g, './02-interface/monitoring.md'],
  [/\.\/03-products\/logs\.md/g, './02-interface/logs.md'],
  [/\.\/03-products\/components\.md/g, './02-interface/components.md'],
  [/\.\/03-products\/backups\.md/g, './02-interface/backups.md'],
  [/\.\/03-products\/settings\.md/g, './02-interface/settings.md'],
  [/\.\/08-development\/index\.md/g, './04-developers/'],
  [/\.\/04-guides\/[^)]+/g, './02-interface/'],
  [/\.\/05-troubleshooting\/[^)]+/g, './02-interface/monitoring.md'],
]

const CODE_EVIDENCE = {
  'docs/03-products/zapret2-engine.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-gate.uc', start: 1, end: 35, symbol: 'engine_gate_status', why: 'Engine gate сообщает capability и не позволяет UI подменить runtime-проверку.' }],
  'docs/03-products/z2k-core.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-component.uc', start: 39, end: 57, symbol: 'z2k_component_apply', why: 'Проверка manifest и staged asset завершается одной транзакцией Asset Registry.' }],
  'docs/03-products/strategy-runtime.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc', start: 613, end: 670, symbol: 'strategy_apply', why: 'Permanent Apply проходит guard, native validation, dependency check и canonical profile transaction.' }],
  'docs/03-products/autocircular.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', start: 129, end: 155, symbol: 'auto_state_save', why: 'Autocircular сохраняет состояние с expected revision и atomic publish.' }],
  'docs/03-products/scanner-runtime.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc', start: 218, end: 267, symbol: 'finish', why: 'Финал Scanner сначала проверяет cleanup/reconciliation и только потом публикует terminal state.' }],
  'docs/03-products/avatar-catalog.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc', start: 137, end: 154, symbol: 'active_pointer_write', why: 'Active pointer связывает verified source commit, aggregate digest и время проверки.' }],
  'docs/03-products/asset-registry.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc', start: 301, end: 306, symbol: 'asset_registry_register_builtin', why: 'Package asset принимается только после canonical path и SHA-256 проверки.' }],
  'docs/03-products/nfqueue.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc', start: 170, end: 238, symbol: 'scanner_candidate_activate', why: 'Temporary candidate получает ownership journal, process binding и обязательный cleanup.' }],
  'docs/03-products/dnsmasq.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc', start: 65, end: 95, symbol: 'dns_product_apply', why: 'DNS facade выбирает существующий writer по scope и не создаёт второго owner.' }],
  'docs/03-products/telegram-proxy-runtime.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc', start: 51, end: 86, symbol: 'status_model', why: 'Product status объединяет provider, runtime, config readiness и health.' }],
  'docs/03-products/warp-runtime.md': [{ path: 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-warp-page.js', start: 1, end: 35, symbol: 'WARP', why: 'WARP остаётся отдельной UI/backend capability и не объявляется частью Engine.' }],
  'docs/08-development/architecture.md': [{ path: 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js', start: 9, end: 63, symbol: 'GROUPS', why: 'Единый navigation source задаёт пользовательские группы и владельцев страниц.' }],
  'docs/08-development/runtime-ownership.md': [{ path: 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', start: 893, end: 912, symbol: 'strategies_apply_method', why: 'RPC facade направляет list/get/edit операции в Strategy owner.' }],
  'docs/08-development/strategy-lifecycle.md': [{ path: 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', start: 897, end: 904, symbol: 'strategies_apply_method', why: 'Apply остаётся canonical Strategy API, а IDE не добавляет второй lifecycle.' }],
  'docs/08-development/scanner-architecture.md': [{ path: 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', start: 394, end: 486, symbol: 'scanner_edit_action', why: 'Production RPC path идёт через scanner-cli-entry и bounded request handoff.' }],
  'docs/08-development/z2k-avatar-integration.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc', start: 15, end: 20, symbol: 'AUTHORITY_MARKER', why: 'Scanner planner фиксирует Avatar repository/commit и verified catalog digest.' }],
  'docs/08-development/resource-asset-model.md': [{ path: 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc', start: 201, end: 214, symbol: 'asset_registry_import', why: 'Typed asset import нормализует content, provenance и digest перед registry commit.' }],
  'docs/08-development/api-rpc.md': [{ path: 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', start: 1168, end: 1182, symbol: 'strategies_apply', why: 'UBUS методы объявляют bounded edit payload и отдельные read/edit actions.' }],
  'docs/08-development/apk-build.md': [{ path: '.github/workflows/knowledge-ci.yml', start: 1, end: 35, symbol: 'Knowledge CI', why: 'Документация публикуется только после проверок и artifact upload; runtime APK build остаётся отдельным workflow.' }],
  'docs/07-decisions/index.md': [{ path: 'docs/07-decisions/adr-005-strategy-apply-authority.md', start: 1, end: 35, symbol: 'Strategy Apply authority', why: 'ADR фиксирует owner boundary между Scanner result и permanent Strategy Apply.' }],
}

async function withCodeEvidence(content, source) {
  const references = CODE_EVIDENCE[source] ?? []
  if (!references.length) return content
  let result = `${content.trim()}\n\n## Реализация в текущем исходном коде\n\n`
  for (const reference of references) {
    const absolute = path.join(ROOT, reference.path)
    const lines = (await readFile(absolute, 'utf8')).split(/\r?\n/)
    const snippet = lines.slice(reference.start - 1, reference.end).join('\n')
    result += `### ${reference.symbol}\n\n${reference.why}\n\nИсточник: \`${reference.path}\`, строки ${reference.start}–${reference.end}.\n\n\`\`\`text\n${snippet}\n\`\`\`\n\n`
  }
  return result
}

function frontmatterReplace(content, entry) {
  const id = `public-${entry.publicPath.replaceAll('/', '-')}`
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, (block) => {
    const body = block.replace(/^---\r?\n|\r?\n---$/g, '')
      .replace(/^id:.*$/m, `id: ${id}`)
      .replace(/^title:.*$/m, `title: "${entry.title}"`)
      .replace(/^updated:.*$/m, 'updated: 2026-08-22')
      .replace(/^publish:.*$/m, 'publish: true')
      .replace(/^status:.*$/m, 'status: current')
    return `---\n${body}\n---`
  })
}

function rewriteLinks(content) {
  let result = content
  for (const [pattern, replacement] of REWRITES) result = result.replace(pattern, replacement)
  return result
}

function indexPage(rootPath, title, description, entries) {
  const links = entries.map((entry) => {
    const relative = path.posix.relative(rootPath, entry.publicPath)
    return `- [${entry.title}](./${relative}.md)`
  }).join('\n')
  return `---\nid: public-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\ntitle: "${title}"\ntype: index\nstatus: current\nauthority: index\nupdated: 2026-08-22\npublish: true\ntags: [public, navigation]\n---\n\n# ${title}\n\n${description}\n\n${links}\n`
}

export async function buildPublicProjection() {
  await rm(PUBLIC_SOURCE_ROOT, { recursive: true, force: true })
  await mkdir(PUBLIC_SOURCE_ROOT, { recursive: true })
  const byRoot = new Map(PUBLIC_ROOTS.map((root) => [root.path, []]))
  for (const entry of PUBLIC_ENTRIES) {
    const source = path.join(ROOT, entry.source)
    const baseContent = rewriteLinks(frontmatterReplace(await readFile(source, 'utf8'), entry))
    const content = await withCodeEvidence(baseContent, entry.source)
    const target = path.join(PUBLIC_SOURCE_ROOT, `${entry.publicPath}.md`)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
    byRoot.get(entry.publicPath.split('/')[0]).push(entry)
  }
  await writeFile(path.join(PUBLIC_SOURCE_ROOT, 'index.md'), rewriteLinks(await readFile(path.join(DOCS, 'index.md'), 'utf8')))
  const descriptions = {
    '01-start': 'Установка, первый запуск и безопасное обновление Z2M.',
    '02-interface': 'Канонические пользовательские страницы LuCI и их действия.',
    '03-technology': 'Компоненты, runtime-владение и verified границы системы.',
    '04-developers': 'Реальные контракты, RPC-пути и точки сопровождения кода.',
  }
  for (const root of PUBLIC_ROOTS) {
    const target = path.join(PUBLIC_SOURCE_ROOT, root.path, 'index.md')
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, indexPage(root.path, root.title, descriptions[root.path], byRoot.get(root.path)))
  }
  return PUBLIC_SOURCE_ROOT
}
