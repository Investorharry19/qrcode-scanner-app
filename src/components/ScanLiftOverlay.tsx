import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import type { Image as NitroImageType } from "react-native-nitro-image";
import QRCode from "react-native-qrcode-svg";

export type Rect = { x: number; y: number; w: number; h: number };
export type Still = {
  uri: string;
  width: number; // upright pixel size of the still
  height: number;
  qr: Rect | null; // QR position inside the still, in pixels
  value: string; // decoded payload, used to regenerate a clean code
  logo: boolean; // true if the real code seems to have a center logo
};

/** ML Kit result -> pixel rect. Tolerates the different shapes wrappers return. */
export function rectFromMlkit(b: any, imgW: number, imgH: number): Rect | null {
  if (!b) return null;
  let r: Rect | null = null;
  const bb = b.bounds ?? b.frame;
  if (bb?.origin && bb?.size) {
    r = { x: bb.origin.x, y: bb.origin.y, w: bb.size.width, h: bb.size.height };
  } else if (bb && bb.left != null && bb.width != null) {
    r = { x: bb.left, y: bb.top, w: bb.width, h: bb.height };
  } else {
    const pts = b.cornerPoints ?? b.corners;
    if (Array.isArray(pts) && pts.length >= 3) {
      const xs = pts.map((p: any) => p.x);
      const ys = pts.map((p: any) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      r = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
  }
  if (!r || !(r.w > 0) || !(r.h > 0)) return null;
  if (r.x < -5 || r.y < -5 || r.x + r.w > imgW + 5 || r.y + r.h > imgH + 5)
    return null;
  return r;
}

/** Angle (degrees) of the code's top edge, or null if corner points are missing. */
export function tiltFromMlkit(b: any): number | null {
  const pts = b?.cornerPoints ?? b?.corners;
  if (!Array.isArray(pts) || pts.length < 2) return null;
  return (Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180) / Math.PI;
}

/**
 * Heuristic: does the middle of the code contain a (colored) logo?
 * Compares how much color is in the center vs. the rest of the code, so
 * fully colored QR codes don't count as "has a logo".
 */
export async function detectColorLogo(
  image: NitroImageType,
  qr: Rect,
): Promise<boolean> {
  try {
    const crop = await image.cropAsync(qr.x, qr.y, qr.x + qr.w, qr.y + qr.h);
    const small = await crop.resizeAsync(48, 48);
    const raw = await small.toRawPixelDataAsync();
    const { width: w, height: h, pixelFormat } = raw;
    const px = new Uint8Array(raw.buffer);
    if (px.length < w * h * 4) return false;

    // byte offsets of R, G, B for the formats Nitro Image can return
    const [ri, gi, bi] =
      pixelFormat === "BGRA" || pixelFormat === "BGRX"
        ? [2, 1, 0]
        : pixelFormat === "ARGB" || pixelFormat === "XRGB"
          ? [1, 2, 3]
          : pixelFormat === "ABGR" || pixelFormat === "XBGR"
            ? [3, 2, 1]
            : [0, 1, 2];

    let cColored = 0;
    let cTotal = 0;
    let oColored = 0;
    let oTotal = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = px[i + ri];
        const g = px[i + gi];
        const b = px[i + bi];
        const colored = Math.max(r, g, b) - Math.min(r, g, b) > 60;
        const center =
          x >= w * 0.36 && x < w * 0.64 && y >= h * 0.36 && y < h * 0.64;
        if (center) {
          cTotal++;
          if (colored) cColored++;
        } else {
          oTotal++;
          if (colored) oColored++;
        }
      }
    }
    const c = cColored / Math.max(1, cTotal);
    const o = oColored / Math.max(1, oTotal);
    return c > 0.15 && c > o * 2;
  } catch {
    return false;
  }
}

// The photo crop is the QR padded by 1.3x, so the real code fills ~77% of the
// card. The regenerated code uses the same proportion so the crossfade lines up.
const CROP_PAD = 1.3;
const QUIET_ZONE = (CROP_PAD - 1) / 2; // quiet zone per side, as a fraction of the card
const MAX_REGEN_LENGTH = 1200; // beyond this, keep the photo crop
const LOGO_FRAC = 0.26; // logo window as a fraction of the QR's side

type Props = {
  still: Still;
  viewW: number;
  viewH: number;
  /** Used when ML Kit couldn't locate the QR in the still (your yellow frame). */
  fallbackRect: Rect;
  closing: boolean;
  onReady: () => void; // still is on screen -> safe to pause the camera
  onLifted: () => void; // lift mostly done -> show the result sheet
  onFailed: () => void; // still couldn't load -> skip the effect
  onClosed: () => void; // fade-out finished -> unmount
};

export function ScanLiftOverlay(props: Props) {
  const { still, viewW, viewH, fallbackRect, closing } = props;
  const cb = useRef(props);
  cb.current = props;

  const [ready, setReady] = useState(false);
  const [regenOk, setRegenOk] = useState(
    still.value.length <= MAX_REGEN_LENGTH,
  );
  const p = useRef(new Animated.Value(0)).current; // 0 = in the camera, 1 = lifted
  const fade = useRef(new Animated.Value(1)).current; // whole overlay, used on close

  const g = useMemo(() => {
    // The still is shown with "cover", same as the camera preview.
    const s = Math.max(viewW / still.width, viewH / still.height);
    const offX = (viewW - still.width * s) / 2;
    const offY = (viewH - still.height * s) / 2;

    let src: Rect;
    let qrC = { x: 0, y: 0 }; // QR center, view coords
    let qrSide = 0; // QR side, view px
    if (still.qr) {
      qrSide = Math.max(still.qr.w, still.qr.h) * s;
      const side = qrSide * CROP_PAD; // keep the quiet zone
      const cx = (still.qr.x + still.qr.w / 2) * s + offX;
      const cy = (still.qr.y + still.qr.h / 2) * s + offY;
      qrC = { x: cx, y: cy };
      src = { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
    } else {
      src = fallbackRect;
    }

    // Lay the card out at its FINAL size so it's crisp when it lands.
    const L = Math.min(Math.min(viewW * 0.72, viewH * 0.3), src.w * 4);
    const k = L / src.w;
    const targetCy = viewH * 0.27;
    return {
      src,
      L,
      k,
      qrC,
      qrSide,
      left: viewW / 2 - L / 2,
      top: targetCy - L / 2,
      tx0: src.x + src.w / 2 - viewW / 2,
      ty0: src.y + src.h / 2 - targetCy,
      s0: src.w / L,
    };
  }, [still, viewW, viewH, fallbackRect]);

  // enter
  useEffect(() => {
    if (!ready) return;
    cb.current.onReady();
    Animated.timing(p, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const t = setTimeout(() => cb.current.onLifted(), 260);
    return () => clearTimeout(t);
  }, [ready, p]);

  // exit
  useEffect(() => {
    if (!closing) return;
    Animated.sequence([
      Animated.timing(p, {
        toValue: 0,
        duration: 260,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => finished && cb.current.onClosed());
  }, [closing, p, fade]);

  const source = { uri: still.uri };

  // photo crop fades out while the regenerated code fades in (mid-lift)
  const cropOpacity = regenOk
    ? p.interpolate({
        inputRange: [0.35, 0.9],
        outputRange: [1, 0],
        extrapolate: "clamp",
      })
    : 1;
  const regenOpacity = p.interpolate({
    inputRange: [0.35, 0.9],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const quiet = g.L * QUIET_ZONE;

  // center logo, cut out of the photo and laid over the regenerated code
  const showLogo = regenOk && still.logo && !!still.qr;
  const logoView = g.qrSide * LOGO_FRAC; // window side in view px
  const logoCard = logoView * g.k; // window side in card px

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity: fade }]}
    >
      {/* 1. sharp frozen frame (hides the paused camera) */}
      <Image
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="none"
        onLoad={() => setReady(true)}
        onError={() => cb.current.onFailed()}
      />

      {/* 2. blurred copy fades in */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: p }]}>
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={24}
          cachePolicy="none"
        />
      </Animated.View>

      {/* 3. dim */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: "#000",
            opacity: p.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.4],
            }),
          },
        ]}
      />

      {/* 4. the QR card: starts exactly over the real code, then lifts */}
      <Animated.View
        style={{
          position: "absolute",
          left: g.left,
          top: g.top,
          width: g.L,
          height: g.L,
          transform: [
            {
              translateX: p.interpolate({
                inputRange: [0, 1],
                outputRange: [g.tx0, 0],
              }),
            },
            {
              translateY: p.interpolate({
                inputRange: [0, 1],
                outputRange: [g.ty0, 0],
              }),
            },
            {
              scale: p.interpolate({
                inputRange: [0, 1],
                outputRange: [g.s0, 1],
              }),
            },
          ],
        }}
      >
        <Animated.View style={[styles.shadow, { opacity: p }]} />
        <View style={styles.clip}>
          {/* 4a. crop of the real photo (what the user was pointing at) */}
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: cropOpacity }]}
          >
            <Image
              source={source}
              contentFit="cover"
              cachePolicy="none"
              style={{
                position: "absolute",
                left: -g.src.x * g.k,
                top: -g.src.y * g.k,
                width: viewW * g.k,
                height: viewH * g.k,
              }}
            />
          </Animated.View>

          {/* 4b. freshly generated, perfectly crisp code */}
          {regenOk && (
            <Animated.View style={[styles.regen, { opacity: regenOpacity }]}>
              <QRCode
                value={still.value}
                size={g.L}
                ecl={still.logo ? "H" : "M"}
                quietZone={quiet}
                color="#000"
                backgroundColor="#fff"
                onError={() => setTimeout(() => setRegenOk(false), 0)}
              />
            </Animated.View>
          )}

          {/* 4c. the real logo, cut from the photo, over the middle */}
          {showLogo && (
            <Animated.View
              style={{
                position: "absolute",
                left: (g.L - logoCard) / 2,
                top: (g.L - logoCard) / 2,
                width: logoCard,
                height: logoCard,
                borderRadius: logoCard * 0.12,
                overflow: "hidden",
                opacity: regenOpacity,
              }}
            >
              <Image
                source={source}
                contentFit="cover"
                cachePolicy="none"
                style={{
                  position: "absolute",
                  left: -(g.qrC.x - logoView / 2) * g.k,
                  top: -(g.qrC.y - logoView / 2) * g.k,
                  width: viewW * g.k,
                  height: viewH * g.k,
                }}
              />
            </Animated.View>
          )}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    ...StyleSheet.absoluteFill,
    borderRadius: 20,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 24,
  },
  clip: {
    ...StyleSheet.absoluteFill,
    borderRadius: 20,
    overflow: "hidden",
  },
  regen: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});
