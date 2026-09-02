export type ThemePreset = {
  id: string
  label: string
  editorMode: 'dark' | 'light'
  vars: Record<string, string>
}

export type WorkspaceTheme = {
  presetId: string
  uiFontFamily: string
  uiFontSize: number
  editorFontFamily: string
  editorFontSize: number
}

export const THEME_STORAGE_KEY = 'typstr.workspace-theme'

export const DERIVED_THEME_VARS: Record<string, string> = {
  '--input-bg': 'var(--editor-bg)',
  '--btn-hover-bg': 'var(--row-hover)',
  '--error-text': 'var(--danger)',
  '--warning': 'var(--accent-soft)',
  '--warning-bg': 'var(--action-bg)',
  '--success-bg': 'var(--action-bg)',
  '--neutral-bg': 'var(--card-bg)',
  '--overlay-bg': 'color-mix(in srgb, var(--page-bg) 72%, transparent)',
  '--surface-shadow': '0 24px 80px color-mix(in srgb, var(--page-bg) 72%, transparent)',
  '--surface-shadow-soft': '0 12px 36px color-mix(in srgb, var(--page-bg) 64%, transparent)',
  '--surface-shadow-strong': '0 25px 50px -12px color-mix(in srgb, var(--page-bg) 78%, transparent)',
  '--focus-ring': '0 0 0 2px var(--accent-soft)',
  '--on-accent': 'var(--page-bg)',
  '--code-font': 'var(--editor-font)',
  '--spinner-track': 'color-mix(in srgb, var(--text-bright) 20%, transparent)',
  '--feature-section': 'var(--warning)',
  '--feature-figure': 'var(--success)',
  '--feature-table': 'var(--accent)',
  '--feature-equation': 'var(--accent-soft)',
  '--feature-bibliography': 'var(--danger)',
}

export function resolveThemeVars(vars: Record<string, string>): Record<string, string> {
  return {
    ...vars,
    ...DERIVED_THEME_VARS,
  }
}

export function themeStorageKeyForUser(userId?: string | null): string {
  const normalized = (userId ?? '').trim()
  if (!normalized) {
    return THEME_STORAGE_KEY
  }

  return `${THEME_STORAGE_KEY}.${normalized}`
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    editorMode: 'dark',
    vars: {
      '--page-bg': '#0b0f1a',
      '--sidebar-bg': '#080c14',
      '--editor-bg': '#050810',
      '--panel-border': '#2d3748',
      '--text-strong': '#ffffff',
      '--text-soft': '#cbd5e0',
      '--text-bright': '#f7fafc',
      '--muted-text': '#a0aec0',
      '--accent': '#63b3ed',
      '--accent-soft': '#90cdf4',
      '--accent-strong': '#4299e1',
      '--action-bg': 'rgba(99, 179, 237, 0.15)',
      '--action-bg-hover': 'rgba(99, 179, 237, 0.25)',
      '--action-border': 'rgba(99, 179, 237, 0.3)',
      '--row-hover': 'rgba(255, 255, 255, 0.08)',
      '--active-bg': 'rgba(66, 153, 225, 0.25)',
      '--active-border': 'rgba(99, 179, 237, 0.5)',
      '--drop-bg': 'rgba(99, 179, 237, 0.2)',
      '--drop-border': 'rgba(99, 179, 237, 0.6)',
      '--card-bg': 'rgba(255, 255, 255, 0.05)',
      '--resize-alt': '#2d3748',
      '--danger': '#fc8181',
      '--danger-bg': 'rgba(245, 101, 101, 0.2)',
      '--success': '#68d391',
    },
  },
  {
    id: 'paper',
    label: 'Paper',
    editorMode: 'light',
    vars: {
      '--page-bg': '#fcfcfc',
      '--sidebar-bg': '#f7f7f7',
      '--editor-bg': '#ffffff',
      '--panel-border': '#cbd5e0',
      '--text-strong': '#1a202c',
      '--text-soft': '#2d3748',
      '--text-bright': '#000000',
      '--muted-text': '#4a5568',
      '--accent': '#3182ce',
      '--accent-soft': '#4299e1',
      '--accent-strong': '#2b6cb0',
      '--action-bg': 'rgba(49, 130, 206, 0.1)',
      '--action-bg-hover': 'rgba(49, 130, 206, 0.2)',
      '--action-border': 'rgba(49, 130, 206, 0.25)',
      '--row-hover': 'rgba(0, 0, 0, 0.04)',
      '--active-bg': 'rgba(49, 130, 206, 0.15)',
      '--active-border': 'rgba(49, 130, 206, 0.4)',
      '--drop-bg': 'rgba(49, 130, 206, 0.1)',
      '--drop-border': 'rgba(49, 130, 206, 0.5)',
      '--card-bg': '#ffffff',
      '--resize-alt': '#e2e8f0',
      '--danger': '#c53030',
      '--danger-bg': 'rgba(197, 48, 48, 0.1)',
      '--success': '#2f855a',
    },
  },
  {
    id: 'high-contrast',
    label: 'High Contrast (Accessibility)',
    editorMode: 'dark',
    vars: {
      '--page-bg': '#000000',
      '--sidebar-bg': '#000000',
      '--editor-bg': '#000000',
      '--panel-border': '#ffffff',
      '--text-strong': '#ffffff',
      '--text-soft': '#ffffff',
      '--text-bright': '#ffffff',
      '--muted-text': '#ffff00',
      '--accent': '#00ff00',
      '--accent-soft': '#00ff00',
      '--accent-strong': '#00ff00',
      '--action-bg': 'rgba(255, 255, 255, 0.2)',
      '--action-bg-hover': 'rgba(255, 255, 255, 0.4)',
      '--action-border': '#ffffff',
      '--row-hover': 'rgba(255, 255, 255, 0.2)',
      '--active-bg': 'rgba(255, 255, 255, 0.3)',
      '--active-border': '#00ff00',
      '--drop-bg': 'rgba(0, 255, 0, 0.2)',
      '--drop-border': '#00ff00',
      '--card-bg': '#000000',
      '--resize-alt': '#ffffff',
      '--danger': '#ff0000',
      '--danger-bg': 'rgba(255, 0, 0, 0.3)',
      '--success': '#00ff00',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    editorMode: 'dark',
    vars: {
      '--page-bg': '#0a100d',
      '--sidebar-bg': '#070c0a',
      '--editor-bg': '#040806',
      '--panel-border': '#2d4a3e',
      '--text-strong': '#ffffff',
      '--text-soft': '#b8d8c0',
      '--text-bright': '#e6ffed',
      '--muted-text': '#7a968a',
      '--accent': '#48bb78',
      '--accent-soft': '#68d391',
      '--accent-strong': '#38a169',
      '--action-bg': 'rgba(72, 187, 120, 0.15)',
      '--action-bg-hover': 'rgba(72, 187, 120, 0.25)',
      '--action-border': 'rgba(72, 187, 120, 0.3)',
      '--row-hover': 'rgba(255, 255, 255, 0.08)',
      '--active-bg': 'rgba(72, 187, 120, 0.25)',
      '--active-border': 'rgba(72, 187, 120, 0.5)',
      '--drop-bg': 'rgba(72, 187, 120, 0.2)',
      '--drop-border': 'rgba(72, 187, 120, 0.6)',
      '--card-bg': 'rgba(255, 255, 255, 0.05)',
      '--resize-alt': '#2d4a3e',
      '--danger': '#fc8181',
      '--danger-bg': 'rgba(245, 101, 101, 0.2)',
      '--success': '#48bb78',
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    editorMode: 'dark',
    vars: {
      '--page-bg': '#12141d',
      '--sidebar-bg': '#0f111a',
      '--editor-bg': '#0b0d14',
      '--panel-border': '#2e3250',
      '--text-strong': '#ffffff',
      '--text-soft': '#b0b8d6',
      '--text-bright': '#f1f5ff',
      '--muted-text': '#718096',
      '--accent': '#9f7aea',
      '--accent-soft': '#b794f4',
      '--accent-strong': '#805ad5',
      '--action-bg': 'rgba(159, 122, 234, 0.15)',
      '--action-bg-hover': 'rgba(159, 122, 234, 0.25)',
      '--action-border': 'rgba(159, 122, 234, 0.3)',
      '--row-hover': 'rgba(255, 255, 255, 0.08)',
      '--active-bg': 'rgba(159, 122, 234, 0.25)',
      '--active-border': 'rgba(159, 122, 234, 0.5)',
      '--drop-bg': 'rgba(159, 122, 234, 0.2)',
      '--drop-border': 'rgba(159, 122, 234, 0.6)',
      '--card-bg': 'rgba(255, 255, 255, 0.05)',
      '--resize-alt': '#2e3250',
      '--danger': '#fc8181',
      '--danger-bg': 'rgba(245, 101, 101, 0.2)',
      '--success': '#68d391',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    editorMode: 'dark',
    vars: {
      '--page-bg': '#001a2c',
      '--sidebar-bg': '#001321',
      '--editor-bg': '#000c15',
      '--panel-border': '#1a365d',
      '--text-strong': '#ffffff',
      '--text-soft': '#90cdf4',
      '--text-bright': '#ebf8ff',
      '--muted-text': '#4299e1',
      '--accent': '#00b0ff',
      '--accent-soft': '#4fc3f7',
      '--accent-strong': '#0091ea',
      '--action-bg': 'rgba(0, 176, 255, 0.15)',
      '--action-bg-hover': 'rgba(0, 176, 255, 0.25)',
      '--action-border': 'rgba(0, 176, 255, 0.3)',
      '--row-hover': 'rgba(255, 255, 255, 0.1)',
      '--active-bg': 'rgba(0, 176, 255, 0.25)',
      '--active-border': 'rgba(0, 176, 255, 0.5)',
      '--drop-bg': 'rgba(0, 176, 255, 0.2)',
      '--drop-border': 'rgba(0, 176, 255, 0.6)',
      '--card-bg': 'rgba(255, 255, 255, 0.05)',
      '--resize-alt': '#1a365d',
      '--danger': '#ff5252',
      '--danger-bg': 'rgba(255, 82, 82, 0.2)',
      '--success': '#00e676',
    },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    editorMode: 'light',
    vars: {
      '--page-bg': '#f4ebd0',
      '--sidebar-bg': '#efe3c2',
      '--editor-bg': '#faf3e0',
      '--panel-border': '#d6bc97',
      '--text-strong': '#433422',
      '--text-soft': '#5c4731',
      '--text-bright': '#2d2214',
      '--muted-text': '#8c6d46',
      '--accent': '#a0522d',
      '--accent-soft': '#cd853f',
      '--accent-strong': '#8b4513',
      '--action-bg': 'rgba(160, 82, 45, 0.12)',
      '--action-bg-hover': 'rgba(160, 82, 45, 0.22)',
      '--action-border': 'rgba(160, 82, 45, 0.28)',
      '--row-hover': 'rgba(0, 0, 0, 0.05)',
      '--active-bg': 'rgba(160, 82, 45, 0.18)',
      '--active-border': 'rgba(160, 82, 45, 0.4)',
      '--drop-bg': 'rgba(160, 82, 45, 0.15)',
      '--drop-border': 'rgba(160, 82, 45, 0.5)',
      '--card-bg': '#ffffff88',
      '--resize-alt': '#d6bc97',
      '--danger': '#a52a2a',
      '--danger-bg': 'rgba(165, 42, 42, 0.1)',
      '--success': '#2e8b57',
    },
  },
]

export const UI_FONT_OPTIONS = [
  { label: 'Avenir', value: '"Avenir Next", "Segoe UI", sans-serif' },
  { label: 'IBM Plex Sans', value: '"IBM Plex Sans", "Segoe UI", sans-serif' },
  { label: 'Atkinson Hyperlegible', value: '"Atkinson Hyperlegible", "Segoe UI", sans-serif' },
  { label: 'Nunito', value: 'Nunito, "Segoe UI", sans-serif' },
  { label: 'Source Sans 3', value: '"Source Sans 3", "Segoe UI", sans-serif' },
  { label: 'Fira Sans', value: '"Fira Sans", "Segoe UI", sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Merriweather', value: 'Merriweather, Georgia, serif' },
  { label: 'Helvetica', value: '"Helvetica Neue", Arial, sans-serif' },
  { label: 'Menlo UI', value: 'Menlo, Monaco, monospace' },
]

export const EDITOR_FONT_OPTIONS = [
  { label: 'Cascadia', value: '"Cascadia Code", "SFMono-Regular", Menlo, monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", "SFMono-Regular", Menlo, monospace' },
  { label: 'Fira Code', value: '"Fira Code", "SFMono-Regular", Menlo, monospace' },
  { label: 'IBM Plex Mono', value: '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace' },
  { label: 'Inconsolata', value: 'Inconsolata, "SFMono-Regular", Menlo, monospace' },
  { label: 'Ubuntu Mono', value: '"Ubuntu Mono", "SFMono-Regular", Menlo, monospace' },
  { label: 'Source Code Pro', value: '"Source Code Pro", "SFMono-Regular", Menlo, monospace' },
  { label: 'Menlo', value: 'Menlo, Monaco, monospace' },
]

export const DEFAULT_THEME: WorkspaceTheme = {
  presetId: 'midnight',
  uiFontFamily: UI_FONT_OPTIONS[0].value,
  uiFontSize: 11,
  editorFontFamily: EDITOR_FONT_OPTIONS[0].value,
  editorFontSize: 14,
}

export function normalizeWorkspaceTheme(input: unknown): WorkspaceTheme {
  const parsed = input && typeof input === 'object' ? input as Partial<WorkspaceTheme> : {}

  return {
    presetId: THEME_PRESETS.some((preset) => preset.id === parsed.presetId)
      ? parsed.presetId ?? DEFAULT_THEME.presetId
      : DEFAULT_THEME.presetId,
    uiFontFamily: UI_FONT_OPTIONS.some((font) => font.value === parsed.uiFontFamily)
      ? parsed.uiFontFamily ?? DEFAULT_THEME.uiFontFamily
      : DEFAULT_THEME.uiFontFamily,
    uiFontSize: typeof parsed.uiFontSize === 'number' && parsed.uiFontSize >= 9 && parsed.uiFontSize <= 24
      ? parsed.uiFontSize
      : DEFAULT_THEME.uiFontSize,
    editorFontFamily: EDITOR_FONT_OPTIONS.some((font) => font.value === parsed.editorFontFamily)
      ? parsed.editorFontFamily ?? DEFAULT_THEME.editorFontFamily
      : DEFAULT_THEME.editorFontFamily,
    editorFontSize: typeof parsed.editorFontSize === 'number' && parsed.editorFontSize >= 9 && parsed.editorFontSize <= 24
      ? parsed.editorFontSize
      : DEFAULT_THEME.editorFontSize,
  }
}
