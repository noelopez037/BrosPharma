import { useCallback, useRef } from "react";
import type { ScrollView } from "react-native";

export function useKeyboardAutoScroll(extraOffset = 90) {
  const scrollRef = useRef<ScrollView>(null);

  const handleFocus = useCallback(
    (e: any) => {
      const target = e?.target;
      const scroll = scrollRef.current as any;
      if (!scroll || !target) return;

      const fn = scroll.scrollResponderScrollNativeHandleToKeyboard;
      if (typeof fn === "function") fn.call(scroll, target, extraOffset, true);
    },
    [extraOffset]
  );

  return { scrollRef, handleFocus };
}
