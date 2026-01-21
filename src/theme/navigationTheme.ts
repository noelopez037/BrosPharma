// src/theme/navigationTheme.ts
import { Theme } from "@react-navigation/native";

const IOS_BLUE = "#007AFF";

export function makeNativeTheme(isDark: boolean): Theme {
  const colors = isDark
    ? {
        primary: IOS_BLUE,
        background: "#000000",     // iOS systemBackground dark
        card: "#1C1C1E",           // iOS secondarySystemBackground-ish
        text: "#FFFFFF",           // label dark
        border: "#38383A",         // separator dark
        notification: IOS_BLUE,
      }
    : {
        primary: IOS_BLUE,
        background: "#FFFFFF",     // systemBackground light
        card: "#FFFFFF",
        text: "#000000",           // label light
        border: "#C6C6C8",         // separator light
        notification: IOS_BLUE,
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
