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
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const subShow = Keyboard.addListener(showEvt as any, () => setKeyboardOpen(true));
    const subHide = Keyboard.addListener(hideEvt as any, () => setKeyboardOpen(false));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const overlayColor = useMemo(() => {
    const op = Math.max(0, Math.min(1, backdropOpacity));
    return `rgba(0,0,0,${op})`;
  }, [backdropOpacity]);

  const maxHeight = useMemo(() => {
    const r = Math.max(0.4, Math.min(0.95, maxHeightRatio));
    return Math.round(height * r);
  }, [height, maxHeightRatio]);

  const handleBackdropPress = () => {
    if (keyboardOpen) {
      Keyboard.dismiss();
      return;
    }
    onClose();
  };

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
                marginBottom: Math.max(12, insets.bottom),
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
  card: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
});
