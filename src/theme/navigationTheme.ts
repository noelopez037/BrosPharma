// src/theme/navigationTheme.ts
import { Theme } from "@react-navigation/native";
import { FB_DARK_BG, FB_DARK_BLUE, FB_DARK_BORDER, FB_DARK_SURFACE, FB_DARK_TEXT, HEADER_BG } from "./headerColors";

export function makeNativeTheme(isDark: boolean): Theme {
  const PRIMARY = isDark ? FB_DARK_BLUE : HEADER_BG;
  const colors = isDark
    ? {
        primary: PRIMARY,
        background: FB_DARK_BG,
        card: FB_DARK_SURFACE,
        text: FB_DARK_TEXT,
        border: FB_DARK_BORDER,
        notification: PRIMARY,
      }
    : {
        primary: PRIMARY,
        background: "#F5F6F8",     // off-white (light)
        card: "#F9FAFB",           // slightly gray card (light)
        text: "#000000",           // label light
        border: "#C6C6C8",         // separator light
        notification: PRIMARY,
      };

  return {
    dark: isDark,
    colors,
    fonts: {
      regular: { fontFamily: "System", fontWeight: "400" },
      medium: { fontFamily: "System", fontWeight: "500" },
      bold: { fontFamily: "System", fontWeight: "700" },
      heavy: { fontFamily: "System", fontWeight: "800" },
    },
  };
}
