import { router } from "expo-router";

// Always go to a safe "home" route, ignoring navigation history.
export function goHome(path: any = "/(drawer)/(tabs)") {
  router.replace(path as any);
}
