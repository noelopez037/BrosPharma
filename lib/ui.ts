import { Platform, type ColorValue } from "react-native";

export function alphaHex(hexColor: string, a: number) {
  // hexColor: "#RRGGBB"
  const c = String(hexColor ?? "").replace("#", "");
  if (c.length !== 6) return hexColor;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const aa = Math.max(0, Math.min(1, a));
  return `rgba(${r},${g},${b},${aa})`;
}

export function alphaColor(color: string, a: number) {
  const c = String(color ?? "");
  if (c.startsWith("#") && c.length === 7) return alphaHex(c, a);
  return c;
}

export function getPrimary(colors?: any): ColorValue {
  return (colors?.primary ?? "#153c9e") as any;
}

export function getSwitchColors(colors?: any) {
  const primary = String(colors?.primary ?? "#153c9e");
  const text = String(colors?.text ?? "#000000");
  const border = String(colors?.border ?? "#C7C7CC");

  const trackOn = Platform.OS === "android" ? (alphaColor(primary, 0.35) as any) : undefined;
  const trackOff = Platform.OS === "android" ? (alphaColor(text, 0.15) as any) : undefined;
  const thumbOn = Platform.OS === "android" ? (primary as any) : undefined;
  const thumbOff = Platform.OS === "android" ? (border as any) : undefined;

  return { trackOn, trackOff, thumbOn, thumbOff };
}
