import React, { ReactNode, useEffect, useMemo, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { useTheme } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  animationType?: "none" | "slide" | "fade";
  keyboardVerticalOffset?: number;
  cardStyle?: StyleProp<ViewStyle>;
  backdropOpacity?: number;
  maxHeightRatio?: number;
};

export function KeyboardAwareModal({
  visible,
  onClose,
  children,
  animationType = "fade",
  keyboardVerticalOffset = 0,
  cardStyle,
  backdropOpacity = 0.4,
  maxHeightRatio = 0.82,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardOpen = keyboardHeight > 0;

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const subShow = Keyboard.addListener(showEvt as any, (e: any) => {
      setKeyboardHeight(Math.max(0, Number(e?.endCoordinates?.height) || 0));
    });
    const subHide = Keyboard.addListener(hideEvt as any, () => setKeyboardHeight(0));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [visible]);

  const overlayColor = useMemo(() => {
    const op = Math.max(0, Math.min(1, backdropOpacity));
    return `rgba(0,0,0,${op})`;
  }, [backdropOpacity]);

  // Con teclado abierto, KeyboardAvoidingView empuja la card hacia arriba por el alto
  // del teclado — si la card ya usa casi toda la pantalla, ese empuje la saca por
  // arriba. Recortamos el maxHeight para que card + teclado quepan en la pantalla.
  const maxHeight = useMemo(() => {
    const r = Math.max(0.4, Math.min(0.95, maxHeightRatio));
    const base = Math.round(height * r);
    if (keyboardHeight <= 0) return base;
    const available = Math.round(height - keyboardHeight - insets.top - 24);
    return Math.max(160, Math.min(base, available));
  }, [height, maxHeightRatio, keyboardHeight, insets.top]);

  const handleBackdropPress = () => {
    if (keyboardOpen) {
      Keyboard.dismiss();
      return;
    }
    onClose();
  };

  if (!visible) return null;

  if (Platform.OS === "web") {
    return (
      <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
        <View style={styles.rootWeb}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]} onPress={handleBackdropPress} />
          <View
            style={[
              styles.card,
              styles.cardWeb,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              cardStyle,
            ]}
          >
            {children}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal transparent visible={visible} animationType={animationType} onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]} onPress={handleBackdropPress} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={keyboardVerticalOffset}
          style={{ width: "100%" }}
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                marginBottom: keyboardOpen ? 12 : Math.max(12, insets.bottom),
                maxHeight,
              },
              cardStyle,
            ]}
          >
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  rootWeb: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    overflow: "hidden",
  },
  cardWeb: {
    marginHorizontal: 0,
    width: "100%",
    maxWidth: 480,
  },
});
