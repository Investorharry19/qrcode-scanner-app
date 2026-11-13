import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as MediaLibrary from "expo-media-library";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HistoryItem, Source } from "../lib/history";

const YELLOW = "#FBB325";

/* ---------- shared helpers ---------- */

export type Kind = "url" | "wifi" | "email" | "phone" | "sms" | "geo" | "text";

export function detectKind(v: string): Kind {
  const s = v.trim();
  if (/^https?:\/\//i.test(s) || /^www\.[^\s]+\.[^\s]+$/i.test(s)) return "url";
  if (/^WIFI:/i.test(s)) return "wifi";
  if (/^mailto:/i.test(s)) return "email";
  if (/^tel:/i.test(s)) return "phone";
  if (/^sms:/i.test(s)) return "sms";
  if (/^geo:/i.test(s)) return "geo";
  return "text";
}

export const KIND_META: Record<Kind, { label: string; icon: any }> = {
  url: { label: "Website link", icon: "link-outline" },
  wifi: { label: "Wi-Fi network", icon: "wifi-outline" },
  email: { label: "Email", icon: "mail-outline" },
  phone: { label: "Phone number", icon: "call-outline" },
  sms: { label: "SMS", icon: "chatbubble-outline" },
  geo: { label: "Location", icon: "location-outline" },
  text: { label: "Plain text", icon: "document-text-outline" },
};

const OPEN_LABEL: Partial<Record<Kind, string>> = {
  url: "Visit",
  email: "Email",
  phone: "Call",
  sms: "Message",
  geo: "Map",
};

function toOpenableUrl(v: string) {
  const s = v.trim();
  return /^www\./i.test(s) ? `https://${s}` : s;
}

/** Parse "WIFI:T:WPA;S:MyNet;P:pass;;" into fields */
function parseWifi(v: string) {
  const get = (key: string) =>
    new RegExp(`${key}:((?:\\\\;|[^;])*)`, "i")
      .exec(v)?.[1]
      ?.replace(/\\;/g, ";");
  return { ssid: get("S"), security: get("T"), password: get("P") };
}

/** A friendly one-line title for lists (SSID for Wi-Fi, name for contacts/events…). */
export function displayTitle(v: string) {
  if (detectKind(v) === "wifi") return parseWifi(v).ssid || v;
  const named = /^(?:FN|SUMMARY):(.+)$/im.exec(v);
  if (named) return named[1].trim();
  return v.split("\n")[0];
}

export function sourceLabel(s: Source) {
  return s === "camera"
    ? "Scanned from camera"
    : s === "gallery"
      ? "Scanned from photo"
      : "Created in the app";
}

/** "16 Dec 2022, 9:30 pm" */
export function formatDate(ts: number) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
  return `${date}, ${time}`;
}

/* ---------- pieces ---------- */

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

type QrSvgHandle = {
  toDataURL: (
    callback: (data: string) => void,
    options?: { width?: number; height?: number },
  ) => void;
};

function QrPreview({ value }: { value: string }) {
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const qrRef = useRef<QrSvgHandle | null>(null);

  if (failed || value.length > 1000) return null;

  const saveQrCode = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    let file: File | null = null;
    try {
      const qr = qrRef.current;
      if (!qr) throw new Error("The QR code is not ready yet.");

      const image = await new Promise<string>((resolve, reject) => {
        try {
          qr.toDataURL(resolve, { width: 512, height: 512 });
        } catch (error) {
          reject(error);
        }
      });

      if (Platform.OS === "web") {
        const link = document.createElement("a");
        link.href = `data:image/png;base64,${image}`;
        link.download = "qr-code.png";
        document.body.appendChild(link);
        link.click();
        link.remove();
        Alert.alert(
          "QR code downloaded",
          "The image was downloaded to your device.",
        );
        return;
      }

      const permission = await MediaLibrary.requestPermissionsAsync(true, [
        "photo",
      ]);
      if (permission.status !== "granted") {
        Alert.alert(
          "Photo access needed",
          permission.canAskAgain
            ? "Allow photo access to save QR codes to your device."
            : "Enable photo access for this app in Settings to save QR codes.",
        );
        return;
      }

      file = new File(Paths.cache, `qr-code-${Date.now()}.png`);
      file.create({ overwrite: true });
      file.write(image, { encoding: "base64" });
      await MediaLibrary.Asset.create(file.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("QR code saved", "Saved to your photo library.");
    } catch (error) {
      console.error("Could not save QR code", error);
      Alert.alert("Couldn't save QR code", "Please try again.");
    } finally {
      try {
        if (file?.exists) file.delete();
      } catch (error) {
        console.warn("Could not remove the temporary QR image", error);
      }
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <View>
      <View style={styles.qrTile}>
        <QRCode
          value={value}
          size={150}
          ecl="M"
          quietZone={8}
          color="#000"
          backgroundColor="#fff"
          getRef={(ref: QrSvgHandle | null) => {
            qrRef.current = ref;
          }}
          onError={() => setTimeout(() => setFailed(true), 0)}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        style={({ pressed }) => [
          styles.qrSaveButton,
          pressed && !saving && styles.qrSaveButtonPressed,
        ]}
        onPress={saveQrCode}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="download-outline" size={20} color="#fff" />
        )}
        <Text style={styles.qrSaveButtonText}>
          {saving ? "Saving QR code..." : "Save QR code"}
        </Text>
      </Pressable>
    </View>
  );
}

/* ---------- the sheet ---------- */

type Props = {
  item: HistoryItem | null;
  instant?: boolean;
  onSave: () => void; // toggles saved
  onDelete?: () => void; // only shown when provided (History)
  onClose: () => void;
};

export function ResultSheet({
  item,
  instant = false,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  if (!item) return null;

  const kind = detectKind(item.value);
  const meta = KIND_META[kind];
  const wifi = kind === "wifi" ? parseWifi(item.value) : null;
  const openLabel = OPEN_LABEL[kind];

  const open = async () => {
    try {
      await Linking.openURL(toOpenableUrl(item.value));
    } catch {
      Alert.alert("Can't open this", item.value);
    }
  };

  const copy = async () => {
    await Clipboard.setStringAsync(item.value);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Copied");
  };

  return (
    <Modal
      visible
      transparent
      animationType={instant ? "none" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: insets.bottom + 16,
              maxHeight: "85%",
            },
          ]}
        >
          <View style={styles.grabber} />

          <View style={styles.sheetHeader}>
            <View style={styles.kindIcon}>
              <Ionicons name={meta.icon} size={26} color="#000" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>{meta.label}</Text>
              <Text style={styles.sheetSub}>{sourceLabel(item.source)}</Text>
            </View>
            <Pressable hitSlop={12} onPress={onClose}>
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
          </View>

          <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator>
            <QrPreview key={item.id} value={item.value} />

            <Text style={styles.contentLabel}>CONTENT</Text>
            <View style={styles.contentBox}>
              <Text selectable style={styles.contentText}>
                {item.value}
              </Text>
            </View>

            {wifi && (
              <>
                <DetailRow label="Network (SSID)" value={wifi.ssid ?? "—"} />
                <DetailRow label="Security" value={wifi.security ?? "—"} />
                <DetailRow label="Password" value={wifi.password ?? "—"} />
              </>
            )}

            <DetailRow label="Format" value={item.format} />
            <DetailRow
              label="Length"
              value={`${item.value.length} characters`}
            />
            <DetailRow
              label={item.source === "generated" ? "Created" : "Scanned"}
              value={formatDate(item.createdAt)}
            />
          </ScrollView>

          <View style={styles.actions}>
            {openLabel && (
              <Pressable style={[styles.btn, styles.btnPrimary]} onPress={open}>
                <Ionicons name="open-outline" size={20} color="#000" />
                <Text style={styles.btnPrimaryText}>{openLabel}</Text>
              </Pressable>
            )}
            <Pressable
              style={[
                styles.btn,
                openLabel ? styles.btnSecondary : styles.btnPrimary,
              ]}
              onPress={onSave}
            >
              <Ionicons
                name={item.saved ? "bookmark" : "bookmark-outline"}
                size={20}
                color={openLabel ? "#fff" : "#000"}
              />
              <Text
                style={
                  openLabel ? styles.btnSecondaryText : styles.btnPrimaryText
                }
              >
                {item.saved ? "Saved" : "Save"}
              </Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnSecondary]} onPress={copy}>
              <Ionicons name="copy-outline" size={20} color="#fff" />
              <Text style={styles.btnSecondaryText}>Copy</Text>
            </Pressable>
          </View>

          {onDelete && (
            <Pressable style={styles.deleteBtn} onPress={onDelete}>
              <Ionicons name="trash-outline" size={20} color="#ff6b6b" />
              <Text style={styles.deleteText}>Delete from history</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#1f1f1f",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  kindIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: YELLOW,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  sheetSub: { color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 2 },
  sheetBody: { flexGrow: 0, flexShrink: 1 },
  qrTile: {
    alignSelf: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 16,
  },
  qrSaveButton: {
    alignSelf: "center",
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 20,
  },
  qrSaveButtonPressed: { opacity: 0.75 },
  qrSaveButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  contentLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 6,
  },
  contentBox: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  contentText: { color: "#fff", fontSize: 16, lineHeight: 22 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.15)",
    gap: 16,
  },
  detailLabel: { color: "rgba(255,255,255,0.6)", fontSize: 14 },
  detailValue: {
    color: "#fff",
    fontSize: 14,
    flexShrink: 1,
    textAlign: "right",
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  btn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnPrimary: { backgroundColor: YELLOW },
  btnPrimaryText: { color: "#000", fontSize: 16, fontWeight: "700" },
  btnSecondary: { backgroundColor: "rgba(255,255,255,0.12)" },
  btnSecondaryText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  deleteBtn: {
    height: 46,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  deleteText: { color: "#ff6b6b", fontSize: 15, fontWeight: "600" },
});
