function blockBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

export function reportNavigation({ appSource, navigationSource }) {
  const moduleBlock = blockBetween(appSource, 'var MODULES = {', '\n};');
  const moduleRoutes = [...moduleBlock.matchAll(/^\s*['"]?([A-Za-z0-9-]+)['"]?\s*:/gm)].map((match) => match[1]);
  const navItems = [];
  for (const line of navigationSource.split(/\r?\n/)) {
    const match = line.match(/^\s*\{\s*id:\s*['"]([^'"]+)['"][^\n]*?module:\s*([^,}\s]+)/);
    if (match) navItems.push({ id: match[1], module: match[2].replace(/["']/g, '') });
  }
  const ids = navItems.map((item) => item.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missingTargets = navItems.filter((item) => item.module !== 'null' && !moduleRoutes.includes(item.id));
  const moduleGroups = {};
  for (const item of navItems) (moduleGroups[item.module] ||= []).push(item.id);
  return {
    mode: 'report',
    reachable_routes: moduleRoutes,
    navigation_items: navItems,
    duplicate_route_ids: [...new Set(duplicateIds)],
    missing_module_targets: missingTargets,
    duplicate_module_routes: Object.fromEntries(Object.entries(moduleGroups).filter(([, routes]) => routes.length > 1)),
    redundant_overview_item: ids.includes('overview'),
  };
}
