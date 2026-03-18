import React, { type ErrorInfo, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={s.root}>
        <View style={s.card}>
          <Text style={s.title}>Algo salió mal</Text>
          <Text style={s.subtitle}>La aplicación encontró un error inesperado.</Text>

          {__DEV__ && this.state.error && (
            <ScrollView style={s.errorBox} contentContainerStyle={s.errorContent}>
              <Text style={s.errorText}>{this.state.error.message}</Text>
            </ScrollView>
          )}

          <Pressable
            onPress={this.handleRetry}
            style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
          >
            <Text style={s.btnText}>Reintentar</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    padding: 24,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    maxWidth: 400,
    width: "100%",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
      default: {},
    }),
  },
  title: { fontSize: 20, fontWeight: "700", color: "#111", marginBottom: 8 },
  subtitle: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 20, lineHeight: 21 },
  errorBox: {
    maxHeight: 120,
    width: "100%",
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    marginBottom: 20,
  },
  errorContent: { padding: 12 },
  errorText: { fontSize: 12, color: "#991b1b", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  btn: {
    backgroundColor: "#153c9e",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  btnPressed: { opacity: 0.8 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
