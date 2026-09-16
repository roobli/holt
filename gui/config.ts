/**
 * GUI preferences — re-exports shared holt config (CLI + GUI).
 * Preferred store: ~/.config/holt/config.json (legacy gui.json still read).
 */
export {
  loadHoltConfig as loadGuiConfig,
  saveHoltConfig as saveGuiConfig,
  holtConfigPath as guiConfigPath,
  holtConfigDir,
  legacyGuiConfigPath,
  type HoltConfig as GuiConfig,
} from '../src/core/config.ts';
