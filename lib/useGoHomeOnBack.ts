import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import { useCallback, useRef } from "react";
import { BackHandler } from "react-native";

export function useGoHomeOnBack(enabled: boolean = true, path: string = "/(drawer)/(tabs)") {
  const navigatingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;

      const go = () => {
        if (navigatingRef.current) return true;
        navigatingRef.current = true;
        router.replace(path as any);
        return true;
      };

      // NOTE: We intentionally do NOT prevent "beforeRemove" here.
      // Preventing removal is not fully supported by native-stack and can desync native vs JS state.
      const subBack = BackHandler.addEventListener("hardwareBackPress", go);

      return () => {
        navigatingRef.current = false;
        subBack.remove();
      };
    }, [enabled, path])
  );
}
