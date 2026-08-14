import { QuartzConfig } from "./quartz/cfg"
import { PluginTypes } from "./quartz/plugins/types"
/**
 * Quartz configuration overlay for the public zapret2-manager documentation.
 * The executable docs pipeline also applies these publication constraints to the
 * pinned Quartz YAML configuration at build time.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "zapret2-manager",
    explicitPublish: true,
    enableSPA: true,
    enablePopovers: true,
    analytics: { provider: "none" },
    locale: "ru-RU",
    baseUrl: "t0fox.github.io/zapret2-manager",
    ignorePatterns: [
      "private",
      ".obsidian",
      "04-contracts",
      "05-parity",
      "07-decisions",
      "09-work",
      "10-research",
      "12-ai",
      "90-templates",
      "99-archive",
      "02-architecture/atomic-write-json-v1-design.md",
      "02-architecture/traceability",
      "08-development/knowledge-workflow.md",
    ],
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
