import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  detectKind,
  displayTitle,
  formatDate,
  KIND_META,
  ResultSheet,
} from "../components/DetailsSheet";
import {
  loadHistory,
  removeItem,
  toggleSaved,
  type HistoryItem,
} from "../lib/history";

const YELLOW = "#FBB325";
const BG = "#545454";
const TILE = "#333333";
const H_PAD = 24;
const SEG_PAD = 8;

const TABS = ["Scanned", "Created", "Saved"] as const;
type Tab = (typeof TABS)[number];

const EMPTY: Record<Tab, { icon: string; title: string; sub: string }> = {
  Scanned: {
    icon: "qrcode-scan",
    title: "No scans yet",
    sub: "Codes you scan will show up here.",
  },
  Created: {
    icon: "qrcode-plus",
    title: "Nothing created yet",
    sub: "Codes you generate will show up here.",
  },
  Saved: {
    icon: "bookmark-outline",
    title: "No saved codes",
    sub: "Tap Save on any code to keep it here.",
  },
};

/* ---------- segmented toggle ---------- */

function Segmented({
  value,
  onChange,
}: {
  value: Tab;
  onChange: (t: Tab) => void;
}) {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const segW = (w - SEG_PAD * 2) / TABS.length;
  const idx = TABS.indexOf(value);

  useEffect(() => {
    if (w === 0) return;
    Animated.spring(x, {
      toValue: idx * segW,
      useNativeDriver: true,
      bounciness: 4,
      speed: 16,
    }).start();
  }, [idx, segW, w, x]);

  return (
    <View style={styles.seg} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Animated.View
          style={[
            styles.segThumb,
            { width: segW, transform: [{ translateX: x }] },
          ]}
        />
      )}
      {TABS.map((t) => (
        <Pressable key={t} style={styles.segItem} onPress={() => onChange(t)}>
          <Text style={[styles.segText, t === value && styles.segTextOn]}>
            {t}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ---------- list row ---------- */

function Row({
  item,
  onOpen,
  onDelete,
}: {
  item: HistoryItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const meta = KIND_META[detectKind(item.value)];
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      onPress={onOpen}
    >
      <MaterialCommunityIcons name="qrcode-scan" size={44} color={YELLOW} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={styles.rowLine}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {displayTitle(item.value)}
          </Text>
          <Pressable hitSlop={12} onPress={onDelete}>
            <MaterialCommunityIcons
              name="delete-forever"
              size={26}
              color={YELLOW}
            />
          </Pressable>
        </View>
        <View style={styles.rowLine}>
          <View style={styles.kindWrap}>
            {item.saved && (
              <Ionicons name="bookmark" size={13} color={YELLOW} />
            )}
            <Text style={styles.rowKind}>{meta.label}</Text>
          </View>
          <Text style={styles.rowDate}>{formatDate(item.createdAt)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

/* ---------- screen ---------- */

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("Scanned");
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [open, setOpen] = useState<HistoryItem | null>(null);

  // reload whenever the screen comes into focus (new scans / creations / saves)
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadHistory().then((l) => alive && setItems(l));
      return () => {
        alive = false;
      };
    }, []),
  );

  const shown = (items ?? []).filter((i) =>
    tab === "Scanned"
      ? i.source !== "generated"
      : tab === "Created"
        ? i.source === "generated"
        : i.saved,
  );

  const confirmDelete = (item: HistoryItem) =>
    Alert.alert("Delete this code?", "It will be removed from your history.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await removeItem(item.id);
          setItems((p) => p?.filter((i) => i.id !== item.id) ?? p);
          setOpen((o) => (o?.id === item.id ? null : o));
        },
      },
    ]);

  const toggleSave = async () => {
    if (!open) return;
    const updated = await toggleSaved(open.id);
    if (!updated) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(updated);
    setItems((p) => p?.map((i) => (i.id === updated.id ? updated : i)) ?? p);
  };

  const empty = EMPTY[tab];

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />

      {/* decorative rings */}
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            width: 640,
            height: 640,
            borderRadius: 320,
            top: -260,
            right: -180,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            width: 520,
            height: 520,
            borderRadius: 260,
            bottom: -140,
            left: -300,
          },
        ]}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>History</Text>
      </View>

      {/* Toggle */}
      <View style={styles.segWrap}>
        <Segmented value={tab} onChange={setTab} />
      </View>

      {/* List */}
      <FlatList
        data={shown}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <Row
            item={item}
            onOpen={() => setOpen(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 + 86 + 48 },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          items === null ? null : (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={empty.icon as any}
                size={56}
                color="rgba(255,255,255,0.35)"
              />
              <Text style={styles.emptyTitle}>{empty.title}</Text>
              <Text style={styles.emptySub}>{empty.sub}</Text>
            </View>
          )
        }
      />

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { bottom: insets.bottom + 24 }]}>
        <Pressable
          style={styles.tab}
          onPress={() => router.replace("/generate")}
        >
          <MaterialCommunityIcons name="qrcode" size={28} color="#fff" />
          <Text style={styles.tabText}>Generate</Text>
        </Pressable>
        <View style={styles.tab} />
        <View style={styles.tab}>
          <Ionicons name="time-outline" size={28} color={YELLOW} />
          <Text style={[styles.tabText, { color: YELLOW }]}>History</Text>
        </View>

        <Pressable
          style={styles.scanButton}
          onPress={() => router.replace("/")}
        >
          <Ionicons name="scan" size={44} color="#fff" />
        </Pressable>
      </View>

      <ResultSheet
        item={open}
        onSave={toggleSave}
        onDelete={open ? () => confirmDelete(open) : undefined}
        onClose={() => setOpen(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, overflow: "hidden" },
  ring: {
    position: "absolute",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

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

  segWrap: { paddingHorizontal: H_PAD, marginTop: 24 },
  seg: {
    height: 62,
    borderRadius: 12,
    backgroundColor: TILE,
    padding: SEG_PAD,
    flexDirection: "row",
  },
  segThumb: {
    position: "absolute",
    left: SEG_PAD,
    top: SEG_PAD,
    bottom: SEG_PAD,
    borderRadius: 9,
    backgroundColor: YELLOW,
  },
  segItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  segText: {
    color: "#e8e8e8",
    fontSize: 18,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  segTextOn: { color: "#000", fontWeight: "700" },

  list: { paddingHorizontal: H_PAD, paddingTop: 28, flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: TILE,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  rowLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowTitle: { flex: 1, color: "#e8e8e8", fontSize: 18, fontWeight: "500" },
  kindWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  rowKind: { color: "rgba(255,255,255,0.55)", fontSize: 14 },
  rowDate: { color: "rgba(255,255,255,0.55)", fontSize: 13 },

  empty: {
    alignItems: "center",
    paddingTop: 70,
    gap: 8,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: "#e8e8e8",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 8,
  },
  emptySub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 15,
    textAlign: "center",
  },

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
});
