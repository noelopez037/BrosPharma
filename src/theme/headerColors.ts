// src/theme/headerColors.ts
// Centralized colors for headers/drawer + shared dark palette.

// Brand (light mode) primary.
export const HEADER_BG = "#153c9e";
export const HEADER_FG = "#ffffff";

// Facebook-like dark mode palette.
export const FB_DARK_BG = "#18191A";
export const FB_DARK_SURFACE = "#242526";
export const FB_DARK_BORDER = "#3A3B3C";
export const FB_DARK_TEXT = "#E4E6EB";
export const FB_DARK_MUTED = "#B0B3B8";
export const FB_DARK_BLUE = "#2D88FF";
export const FB_DARK_DANGER = "#F02849";

export const HEADER_BG_DARK = FB_DARK_SURFACE;
export const HEADER_FG_DARK = FB_DARK_TEXT;

// Drawer background: slight variation from header for separation (light mode).
// Light mode: airy off-white with brand-blue accents applied in the UI layer.
export const DRAWER_BG = "#F6F7FB";
export const DRAWER_FG = "#0F172A";
export const DRAWER_BG_DARK = FB_DARK_SURFACE;
export const DRAWER_FG_DARK = FB_DARK_TEXT;

export function getHeaderColors(isDark: boolean) {
  return isDark ? { bg: HEADER_BG_DARK, fg: HEADER_FG_DARK } : { bg: HEADER_BG, fg: HEADER_FG };
}

export function getDrawerColors(isDark: boolean) {
  return isDark ? { bg: DRAWER_BG_DARK, fg: DRAWER_FG_DARK } : { bg: DRAWER_BG, fg: DRAWER_FG };
}
