import { Ionicons } from "@expo/vector-icons";
import BarcodeScanning from "@react-native-ml-kit/barcode-scanning";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from "react-native-vision-camera";
import { useBarcodeScannerOutput } from "react-native-vision-camera-barcode-scanner";
import { ResultSheet } from "../components/DetailsSheet";
import {
  detectColorLogo,
  rectFromMlkit,
  ScanLiftOverlay,
  tiltFromMlkit,
  type Rect,
  type Still,
} from "../components/ScanLiftOverlay";
import { addToHistory, toggleSaved, type HistoryItem } from "../lib/history";

const YELLOW = "#FBB325";
const PANEL = "rgba(40,40,40,0.92)";
const CORNER = 56;
const THICK = 14;

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("timeout")), ms),
    ),
  ]);

/* ---------- UI pieces ---------- */

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const top = pos[0] === "t";
  const left = pos[1] === "l";
  return (
    <View
      style={{
        position: "absolute",
        width: CORNER,
        height: CORNER,
        [top ? "top" : "bottom"]: 0,
        [left ? "left" : "right"]: 0,
        borderColor: YELLOW,
        [top ? "borderTopWidth" : "borderBottomWidth"]: THICK,
        [left ? "borderLeftWidth" : "borderRightWidth"]: THICK,
        [`border${top ? "Top" : "Bottom"}${left ? "Left" : "Right"}Radius`]: 28,
      }}
    />
  );
}

function CameraUnavailable({
  message,
  onGallery,
  onRetry,
}: {
  message: string;
  onGallery: () => void;
  onRetry: () => void;
}) {
  return (
    <View style={styles.unavailable}>
      <Ionicons name="videocam-off-outline" size={56} color="#fff" />
      <Text style={styles.unavailableTitle}>Camera unavailable</Text>
      <Text style={styles.unavailableText}>
        {message} You can still scan a QR code from a photo.
      </Text>
      <Pressable
        style={[styles.btn, styles.btnPrimary, styles.unavailableBtn]}
        onPress={onGallery}
      >
        <Ionicons name="images-outline" size={20} color="#000" />
        <Text style={styles.btnPrimaryText}>Choose from gallery</Text>
      </Pressable>
      <Pressable
        style={[styles.btn, styles.btnSecondary, styles.unavailableBtn]}
        onPress={onRetry}
      >
        <Ionicons name="refresh-outline" size={20} color="#fff" />
        <Text style={styles.btnSecondaryText}>Try camera again</Text>
      </Pressable>
    </View>
  );
}

/* ---------- screen ---------- */

export default function App() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { hasPermission, requestPermission } = useCameraPermission();

  // Camera devices (hooks must be called unconditionally)
  const backDevice = useCameraDevice("back");
  const frontDevice = useCameraDevice("front");
  const device = backDevice ?? frontDevice;

  const [active, setActive] = useState(true);
  const [torch, setTorch] = useState(false);
  const [permissionRequesting, setPermissionRequesting] = useState(false);
  const permissionAttempted = useRef(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const [result, setResult] = useState<HistoryItem | null>(null);
  const pending = useRef<HistoryItem | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const locked = useRef(false);

  // scan "lift" effect
  const [still, setStill] = useState<Still | null>(null);
  const [closing, setClosing] = useState(false);
  const [viewSize, setViewSize] = useState({ w: width, h: height });

  const photoOutput = usePhotoOutput();
  const handleScannedRef = useRef<(b: any[]) => void>(() => {});
  const barcodeOutput = useBarcodeScannerOutput({
    barcodeFormats: ["qr-code"],
    onBarcodeScanned: (barcodes) => handleScannedRef.current(barcodes as any[]),
    onError: (err: any) => {
      console.log(err);
      setCameraError(String(err?.message ?? err));
    },
  });

  const cameraUnavailable = !device || !!cameraError;
  const cameraIsActive = hasPermission && active && appState === "active";
  const torchUnavailable =
    cameraUnavailable || !device?.hasTorch || !cameraIsActive;
  const unavailableMessage =
    cameraError ?? "No camera was found on this device.";

  const frameSize = Math.min(width * 0.82, 360);
  const frameTop = height * 0.2;

  // animated scan line
  const scan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scan, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scan]);

  const requestCameraAccess = async () => {
    if (permissionRequesting) return;

    setPermissionRequesting(true);
    try {
      await requestPermission();
    } catch (error) {
      console.warn("Camera permission request failed:", error);
    } finally {
      setPermissionRequesting(false);
    }
  };

  // Ask for permission once when this screen mounts. The scanner is kept
  // unmounted until VisionCamera reports that permission has been granted.
  useEffect(() => {
    if (hasPermission) return;
    if (permissionAttempted.current) return;

    permissionAttempted.current = true;
    void requestCameraAccess();
  }, [hasPermission]);

  useEffect(() => {
    if (!active || !cameraIsActive) setTorch(false);
  }, [active, cameraIsActive]);

  // Pause the native camera while the app is backgrounded. This also
  // prevents scanner callbacks from acting on an inactive camera session.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setAppState(state);

      // Clear a stale camera error when returning to the foreground.
      if (state === "active") {
        setCameraError(null);
      }
    });
    return () => sub.remove();
  }, []);

  /** Gallery results (no lift effect) */
  const showResult = async (
    value: string,
    format: string,
    source: "camera" | "gallery",
  ) => {
    if (locked.current) return;
    locked.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setActive(false);
    setResult(await addToHistory({ value, format, source }));
  };

  const closeResult = () => {
    setResult(null);
    setActive(true);
    if (still)
      setClosing(true); // overlay fades out, then onClosed unlocks
    else locked.current = false;
  };

  /** Grab a still, then find the QR inside it with ML Kit. Null = skip the effect. */
  const captureStill = async (value: string): Promise<Still | null> => {
    try {
      const photo = await withTimeout(
        photoOutput.capturePhoto({ enableShutterSound: false }, {}),
        2000,
      );
      const image = await photo.toImageAsync(); // orientation applied
      const path = await image.saveToTemporaryFileAsync("jpg", 90);
      const uri = `file://${path}`;

      let qr: Rect | null = null;
      let logo = false;
      try {
        const found = await BarcodeScanning.scan(uri);
        const match = found?.find((b: any) => b.value === value) ?? found?.[0];
        console.log("still scan:", match); // check the bounds field names here
        qr = rectFromMlkit(match, image.width, image.height);

        // carry a center logo over, but only for upright codes with short payloads
        const tilt = tiltFromMlkit(match);
        logo =
          !!qr &&
          tilt != null &&
          Math.abs(tilt) < 10 &&
          value.length <= 300 &&
          (await detectColorLogo(image, qr));
        console.log("logo detected:", logo, "tilt:", tilt);
      } catch (e) {
        console.log("still scan failed", e);
      }
      return { uri, width: image.width, height: image.height, qr, value, logo };
    } catch (e) {
      console.log("capture failed", e);
      return null;
    }
  };

  const liftResult = async (value: string, format: string) => {
    setClosing(false);
    const [item, s] = await Promise.all([
      addToHistory({ value, format, source: "camera" }),
      captureStill(value),
    ]);
    pending.current = item;
    if (s) {
      setStill(s); // overlay -> onReady pauses camera -> onLifted shows the sheet
    } else {
      setActive(false);
      setResult(item);
    }
  };

  const handleScanned = (barcodes: any[]) => {
    if (!cameraIsActive || locked.current) return;

    const code = barcodes?.[0];
    if (!code?.rawValue) return;
    locked.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    liftResult(code.rawValue, String(code.format ?? "QR Code"));
  };
  handleScannedRef.current = handleScanned;

  const pickFromGallery = async () => {
    if (locked.current) return;
    locked.current = true; // block camera scans while picker is open
    setActive(false);

    const resume = () => {
      locked.current = false;
      setActive(true);
    };

    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      if (picked.canceled || !picked.assets?.[0]?.uri) return resume();

      const uri = picked.assets[0].uri;
      const found = await BarcodeScanning.scan(uri);
      console.log("ML Kit result:", found);

      const first = found?.[0];
      if (!first?.value) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("No QR code found", "Try a clearer or closer image.");
        return resume();
      }

      locked.current = false; // let showResult take the lock
      showResult(first.value, String(first.format ?? "QR Code"), "gallery");
    } catch (e) {
      console.log(e);
      Alert.alert(
        "Couldn't read image",
        "Something went wrong scanning that photo.",
      );
      resume();
    }
  };

  const toggleSave = async () => {
    if (!result) return;
    const updated = await toggleSaved(result.id);
    if (!updated) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setResult(updated);
    pending.current = updated;
  };

  if (!hasPermission) {
    return (
      <View style={styles.permissionScreen}>
        <Ionicons name="camera-outline" size={58} color={YELLOW} />
        <Text style={styles.permissionTitle}>Camera access required</Text>
        <Text style={styles.permissionText}>
          Allow camera access so you can scan QR codes. The scanner will only
          start after permission has been granted.
        </Text>
        <Pressable
          style={[styles.btn, styles.btnPrimary, styles.permissionButton]}
          disabled={permissionRequesting}
          onPress={() => {
            permissionAttempted.current = true;
            void requestCameraAccess();
          }}
        >
          <Text style={styles.btnPrimaryText}>
            {permissionRequesting
              ? "Requesting permission..."
              : "Grant camera permission"}
          </Text>
        </Pressable>
        {permissionAttempted.current && !permissionRequesting && (
          <Text style={styles.permissionHint}>
            If access was permanently denied, enable Camera permission in your
            device settings and return to the app.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View
      style={styles.root}
      onLayout={(e) =>
        setViewSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      {cameraUnavailable ? (
        <CameraUnavailable
          message={unavailableMessage}
          onGallery={pickFromGallery}
          onRetry={() => setCameraError(null)}
        />
      ) : (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={cameraIsActive}
          torchMode={cameraIsActive && device.hasTorch && torch ? "on" : "off"}
          outputs={[photoOutput, barcodeOutput]}
        />
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + 16 }]}>
        <Pressable hitSlop={12} onPress={pickFromGallery}>
          <Ionicons name="images-outline" size={28} color="#fff" />
        </Pressable>
        <Pressable
          hitSlop={12}
          disabled={torchUnavailable}
          style={{ opacity: torchUnavailable ? 0.4 : 1 }}
          onPress={() => {
            if (!cameraIsActive || !device?.hasTorch) return;
            setTorch((current) => !current);
          }}
        >
          <Ionicons
            name={torch ? "flash" : "flash-outline"}
            size={30}
            color={torch ? YELLOW : "#fff"}
          />
        </Pressable>
      </View>

      {!cameraUnavailable && (
        <View
          pointerEvents="none"
          style={[
            styles.frame,
            { width: frameSize, height: frameSize, top: frameTop },
          ]}
        >
          <Corner pos="tl" />
          <Corner pos="tr" />
          <Corner pos="bl" />
          <Corner pos="br" />
          <Animated.View
            style={[
              styles.scanLine,
              {
                transform: [
                  {
                    translateY: scan.interpolate({
                      inputRange: [0, 1],
                      outputRange: [CORNER / 2, frameSize - CORNER / 2],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
      )}

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { bottom: insets.bottom + 24 }]}>
        <Pressable style={styles.tab} onPress={() => router.push("/generate")}>
          <Ionicons name="qr-code-outline" size={28} color="#fff" />
          <Text style={styles.tabText}>Generate</Text>
        </Pressable>
        <View style={styles.tab} />
        <Pressable style={styles.tab} onPress={() => router.push("/history")}>
          <Ionicons name="time-outline" size={28} color="#fff" />
          <Text style={styles.tabText}>History</Text>
        </Pressable>

        <View style={styles.scanButton} pointerEvents="none">
          <Ionicons name="scan" size={44} color="#fff" />
        </View>
      </View>

      {/* Frozen frame + blur + lifted QR card */}
      {still && (
        <ScanLiftOverlay
          key={still.uri}
          still={still}
          viewW={viewSize.w}
          viewH={viewSize.h}
          fallbackRect={{
            x: (viewSize.w - frameSize) / 2,
            y: frameTop,
            w: frameSize,
            h: frameSize,
          }}
          closing={closing}
          onReady={() => setActive(false)}
          onLifted={() => setResult(pending.current)}
          onFailed={() => {
            setStill(null);
            setActive(false);
            setResult(pending.current);
          }}
          onClosed={() => {
            setStill(null);
            setClosing(false);
            locked.current = false;
          }}
        />
      )}

      <ResultSheet
        item={result}
        lifted={!!still}
        onSave={toggleSave}
        onClose={closeResult}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  permissionScreen: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  permissionTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    marginTop: 20,
    textAlign: "center",
  },
  permissionText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: "center",
  },
  permissionButton: { alignSelf: "stretch", flex: 0, marginTop: 24 },
  permissionHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
    textAlign: "center",
  },
  topBar: {
    position: "absolute",
    left: 24,
    right: 24,
    height: 64,
    borderRadius: 14,
    backgroundColor: PANEL,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
  },
  frame: { position: "absolute", alignSelf: "center" },
  scanLine: {
    position: "absolute",
    left: -8,
    right: -8,
    height: 6,
    borderRadius: 3,
    backgroundColor: YELLOW,
  },
  zoomWrap: { position: "absolute", left: 24, right: 24 },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sliderHit: { flex: 1, height: 44, justifyContent: "center" },
  sliderTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  sliderThumb: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: YELLOW,
  },
  bottomBar: {
    position: "absolute",
    left: 24,
    right: 24,
    height: 86,
    borderRadius: 14,
    backgroundColor: PANEL,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tab: { flex: 1, alignItems: "center", gap: 6 },
  tabText: { color: "#fff", fontSize: 18, letterSpacing: 0.5 },
  scanButton: {
    position: "absolute",
    alignSelf: "center",
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

  /* camera unavailable */
  unavailable: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  unavailableTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 16,
    textAlign: "center",
  },
  unavailableText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
    textAlign: "center",
  },
  unavailableBtn: { alignSelf: "stretch", flex: 0, marginTop: 14 },

  /* result modal */
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
    maxHeight: "80%",
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
  sheetBody: { flexGrow: 0 },
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
});
