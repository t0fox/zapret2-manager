import { QuartzConfig } from "./quartz/cfg"
import { PluginTypes } from "./quartz/plugins/types"
/**
 * Quartz configuration overlay for zapret2-manager vault.
 * This file is copied into the bootstrapped Quartz directory during build.
 *
 * explicitPublish: true enables the publish frontmatter field.
 * Notes with `publish: false` (or absent when strict) are excluded from public output.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "zapret2-manager",
    explicitPublish: true,
    enableSPA: true,
    enablePopovers: true,
    analytics: { provider: "none" },
    locale: "en-US",
    baseUrl: "zapret2-manager.github.io",
    ignorePatterns: ["private", ".obsidian"],
    defaultDateType: "created",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Schibsted Grotesk",
        body: "Source Sans Pro",
        code: "IBM Plex Mono",
      },
      colors: {
        lightMode: {
          light: "#faf8f8",
          lightgray: "#e5e5e5",
          gray: "#b8b8b8",
          darkgray: "#4e4e4e",
          dark: "#2b2b2b",
          secondary: "#284b63",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#fff23688",
        },
        darkMode: {
          light: "#161618",
          lightgray: "#393639",
          gray: "#646464",
          darkgray: "#d4d4d4",
          dark: "#ebebec",
          secondary: "#7b97aa",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: PluginTypes.transformers,
    filters: PluginTypes.filters,
    emitters: PluginTypes.emitters,
  },
}
export default config
