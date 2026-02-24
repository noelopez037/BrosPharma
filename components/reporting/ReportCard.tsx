import { useTheme } from "@react-navigation/native";
import React, { ReactNode, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppButton } from "@/components/ui/app-button";

const EXCEL_GREEN = "#217346";
const EXCEL_TEXT = "#FFFFFF";

type ReportCardProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  onExport?: () => void;
  exportLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  exportButtonVariant?: "default" | "excel";
};

export function ReportCard({
  title,
  description,
  children,
  actions,
  footer,
  onExport,
  exportLabel = "Excel",
  loading,
  disabled,
  exportButtonVariant = "default",
}: ReportCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isExcelExportButton = exportButtonVariant === "excel";

  const renderActions = actions
    ? actions
    : onExport
      ? (
          <AppButton
            title={exportLabel}
            onPress={onExport}
            size="sm"
            variant={isExcelExportButton ? "primary" : "outline"}
            loading={loading}
            disabled={disabled}
            style={isExcelExportButton ? styles.excelButton : undefined}
            textStyle={isExcelExportButton ? styles.excelButtonText : undefined}
          />
        )
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>

        {renderActions}
      </View>

      {children ? <View style={styles.body}>{children}</View> : null}

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    card: {
      padding: 16,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      justifyContent: "space-between",
      marginBottom: 16,
    },
    headerText: {
      flex: 1,
      gap: 4,
    },
    title: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.text,
    },
    description: {
      fontSize: 14,
      color: colors.text + "AA",
    },
    body: {
      gap: 12,
    },
    footer: {
      marginTop: 12,
      gap: 6,
    },
    excelButton: {
      backgroundColor: EXCEL_GREEN,
      borderColor: EXCEL_GREEN,
    },
    excelButtonText: {
      color: EXCEL_TEXT,
    },
  });
