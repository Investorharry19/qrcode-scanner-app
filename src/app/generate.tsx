import { HistoryItem } from "@/lib/history";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  QR_TYPES,
  type IconSpec,
  type QrType,
  type Values,
} from "../lib/qrTypes";

const YELLOW = "#FBB325";
const BG = "#545454";
const TILE = "#333333";
const HISTORY_KEY = "qr_history";
const MAX_LEN = 1000; // longer payloads make dense, hard-to-scan codes
const H_PAD = 24;
const CHIP_H = 24;

/* ---------- small pieces ---------- */

function TypeIcon({
  icon,
  size,
  color,
}: {
  icon: IconSpec;
  size: number;
  color: string;
}) {
  const C: any = icon.lib === "ion" ? Ionicons : MaterialCommunityIcons;
  return <C name={icon.name} size={size} color={color} />;
}

function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) =>
      setH(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}

/* ---------- generator sheet (form -> result) ---------- */

function GeneratorSheet({
  type,
  onClose,
}: {
  type: QrType;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const kb = useKeyboardHeight();

  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(type.fields.map((f) => [f.key, f.defaultValue ?? ""])),
  );
  const [stage, setStage] = useState<"form" | "result">("form");
  const [payload, setPayload] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [entry, setEntry] = useState<HistoryItem | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  const visible = type.fields.filter((f) => !f.showIf || f.showIf(values));
  const qrSize = Math.min(width - 80, 260);

  const generate = () => {
    for (const f of visible) {
      if (!f.optional && !(values[f.key] ?? "").trim()) {
        setError(`${f.label} is required`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
    }
    try {
      const out = type.build(values);
      if (out.length > MAX_LEN) {
        setError("That's too much data for a QR code.");
        return;
      }
      Keyboard.dismiss();
      setError(null);
      setQrFailed(false);
      setEntry(null);
      setPayload(out);
      setStage("result");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e?.message ?? "Something's wrong with that input.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  };

  const save = async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      const list: any[] = raw ? JSON.parse(raw) : [];
      if (!list.some((i) => i.value === payload)) {
        await AsyncStorage.setItem(
          HISTORY_KEY,
          JSON.stringify([
            {
              value: payload,
              format: "QR Code",
              source: "generated",
              createdAt: Date.now(),
            },
            ...list,
          ]),
        );
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setEntry({
        value: payload,
        format: "QR Code",
        source: "generated",
        createdAt: Date.now(),
        saved: true,
      } as HistoryItem);
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    }
  };

  const copy = async () => {
    await Clipboard.setStringAsync(payload);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Copied");
  };

  const share = () => Share.share({ message: payload });

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: (kb > 0 ? kb : insets.bottom) + 16,
              maxHeight: height - insets.top - 24,
            },
          ]}
        >
          <View style={styles.grabber} />

          <View style={styles.sheetHeader}>
            {stage === "result" && (
              <Pressable hitSlop={12} onPress={() => setStage("form")}>
                <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            )}
            <View style={styles.kindIcon}>
              <TypeIcon icon={type.icon} size={26} color="#000" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>{type.label}</Text>
              <Text style={styles.sheetSub}>
                {stage === "form"
                  ? "Fill in the details"
                  : "Your QR code is ready"}
              </Text>
            </View>
            <Pressable hitSlop={12} onPress={onClose}>
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
          </View>

          {stage === "form" ? (
            <>
              <ScrollView
                style={styles.sheetBody}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {visible.map((f) => (
                  <View key={f.key} style={{ marginBottom: 14 }}>
                    <Text style={styles.fieldLabel}>
                      {f.label.toUpperCase()}
                      {f.optional ? "  ·  OPTIONAL" : ""}
                    </Text>
                    {f.options ? (
                      <View style={styles.segment}>
                        {f.options.map((o) => {
                          const on = values[f.key] === o;
                          return (
                            <Pressable
                              key={o}
                              style={[styles.segBtn, on && styles.segBtnOn]}
                              onPress={() =>
                                setValues((p) => ({ ...p, [f.key]: o }))
                              }
                            >
                              <Text
                                style={[styles.segText, on && styles.segTextOn]}
                              >
                                {o}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <TextInput
                        value={values[f.key]}
                        onChangeText={(s) =>
                          setValues((p) => ({ ...p, [f.key]: s }))
                        }
                        onFocus={() => setFocused(f.key)}
                        onBlur={() => setFocused(null)}
                        placeholder={f.placeholder}
                        placeholderTextColor="rgba(255,255,255,0.35)"
                        keyboardType={f.keyboard}
                        autoCapitalize={f.caps ?? "sentences"}
                        autoCorrect={false}
                        secureTextEntry={f.secure}
                        multiline={f.multiline}
                        style={[
                          styles.input,
                          f.multiline && {
                            minHeight: 96,
                            textAlignVertical: "top",
                          },
                          focused === f.key && { borderColor: YELLOW },
                        ]}
                      />
                    )}
                  </View>
                ))}
                {error && <Text style={styles.error}>{error}</Text>}
              </ScrollView>

              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={generate}
                >
                  <Ionicons name="qr-code-outline" size={20} color="#000" />
                  <Text style={styles.btnPrimaryText}>Generate</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <ScrollView
                style={styles.sheetBody}
                contentContainerStyle={{ alignItems: "center" }}
                showsVerticalScrollIndicator={false}
              >
                <View
                  style={[styles.qrTile, { width: qrSize, height: qrSize }]}
                >
                  {qrFailed ? (
                    <Text style={styles.qrFail}>
                      This is too much data to fit in a QR code.
                    </Text>
                  ) : (
                    <QRCode
                      value={payload}
                      size={qrSize}
                      ecl="M"
                      quietZone={12}
                      color="#000"
                      backgroundColor="#fff"
                      onError={() => setTimeout(() => setQrFailed(true), 0)}
                    />
                  )}
                </View>
                <Text selectable numberOfLines={4} style={styles.payload}>
                  {payload}
                </Text>
              </ScrollView>

              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={save}
                  disabled={!!entry}
                >
                  <Ionicons
                    name={entry ? "checkmark" : "bookmark-outline"}
                    size={20}
                    color="#000"
                  />
                  <Text style={styles.btnPrimaryText}>
                    {entry ? "Saved" : "Save"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={copy}
                >
                  <Ionicons name="copy-outline" size={20} color="#fff" />
                  <Text style={styles.btnSecondaryText}>Copy</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={share}
                >
                  <Ionicons name="share-outline" size={20} color="#fff" />
                  <Text style={styles.btnSecondaryText}>Share</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/* ---------- screen ---------- */

export default function GenerateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<QrType | null>(null);

  const cell = (width - H_PAD * 2) / 3.1;
  const tile = Math.min(cell * 0.74, 104);

  const goScan = () =>
    router.canGoBack() ? router.back() : router.replace("/");

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Generate QR</Text>
      </View>

      {/* Type grid */}
      <ScrollView
        contentContainerStyle={[
          styles.grid,
          { paddingBottom: insets.bottom + 24 + 86 + 48 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {QR_TYPES.map((t) => (
          <Pressable
            key={t.id}
            style={({ pressed }) => [
              styles.cell,
              { width: cell },
              pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setSelected(t);
            }}
          >
            <View style={[styles.tile, { width: tile, height: tile }]}>
              <TypeIcon icon={t.icon} size={tile * 0.46} color={YELLOW} />
            </View>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{t.label}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { bottom: insets.bottom + 24 }]}>
        <View style={styles.tab}>
          <MaterialCommunityIcons name="qrcode" size={28} color={YELLOW} />
          <Text style={[styles.tabText, { color: YELLOW }]}>Generate</Text>
          <View style={styles.tabUnderline} />
        </View>
        <View style={styles.tab} />
        <Pressable style={styles.tab} onPress={() => router.push("/history")}>
          <Ionicons name="time-outline" size={28} color="#fff" />
          <Text style={styles.tabText}>History</Text>
        </Pressable>

        <Pressable style={styles.scanButton} onPress={goScan}>
          <Ionicons name="scan" size={44} color="#fff" />
        </Pressable>
      </View>

      {selected && (
        <GeneratorSheet
          key={selected.id}
          type={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: H_PAD,
    paddingBottom: 8,
  },
  title: {
    color: "#e8e8e8",
    fontSize: 30,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  menuBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: TILE,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: H_PAD,
    paddingTop: 40,
    rowGap: 36,
  },
  cell: { alignItems: "center", paddingTop: CHIP_H / 2 },
  tile: {
    backgroundColor: TILE,
    borderColor: YELLOW,
    borderWidth: 2,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    position: "absolute",
    top: 0,
    height: CHIP_H,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: YELLOW,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { color: "#333", fontSize: 12, fontWeight: "600" },

  bottomBar: {
    position: "absolute",
    left: 24,
    right: 24,
    height: 86,
    borderRadius: 14,
    backgroundColor: TILE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tab: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  tabText: { color: "#fff", fontSize: 18, letterSpacing: 0.5 },
  tabUnderline: {
    position: "absolute",
    bottom: 0,
    width: 44,
    height: 4,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: YELLOW,
  },
  scanButton: {
    position: "absolute",
    left: "50%",
    marginLeft: -45,
    top: -26,
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: YELLOW,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: YELLOW,
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 12,
  },

  /* sheet */
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
    marginBottom: 18,
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

  fieldLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "transparent",
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: "#fff",
    fontSize: 16,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segBtn: {
    flex: 1,
    height: 40,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segBtnOn: { backgroundColor: YELLOW },
  segText: { color: "rgba(255,255,255,0.7)", fontSize: 15, fontWeight: "600" },
  segTextOn: { color: "#000" },
  error: { color: "#ff6b6b", fontSize: 14, marginBottom: 6 },

  qrTile: {
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  qrFail: {
    color: "#333",
    textAlign: "center",
    paddingHorizontal: 20,
    fontSize: 15,
  },
  payload: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 14,
    textAlign: "center",
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
});
