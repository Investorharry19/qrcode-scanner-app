import type { KeyboardTypeOptions } from "react-native";

export type IconSpec = { lib: "ion" | "mci"; name: string };
export type Values = Record<string, string>;

export type Field = {
  key: string;
  label: string;
  placeholder?: string;
  keyboard?: KeyboardTypeOptions;
  caps?: "none" | "sentences" | "words";
  multiline?: boolean;
  secure?: boolean;
  optional?: boolean;
  options?: string[]; // renders a segmented picker instead of a text input
  defaultValue?: string;
  showIf?: (v: Values) => boolean;
};

export type QrType = {
  id: string;
  label: string;
  icon: IconSpec;
  fields: Field[];
  /** Returns the string to encode. Throw an Error with a friendly message if invalid. */
  build: (v: Values) => string;
};

/* ---------- helpers ---------- */

const t = (s?: string) => (s ?? "").trim();
const lines = (...l: (string | false | undefined)[]) =>
  l.filter(Boolean).join("\n");
const wifiEsc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
const vEsc = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/([;,])/g, "\\$1");
const withScheme = (u: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
const digits = (s: string) => s.replace(/\D/g, "");
const username = (s: string) =>
  t(s)
    .replace(/^https?:\/\/(www\.)?(twitter|x|instagram)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function icsDate(s: string, label: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(t(s));
  if (!m) throw new Error(`${label} must look like 2026-11-11 13:00`);
  const [, y, mo, d, h, mi] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59)
    throw new Error(`${label} isn't a valid date`);
  return `${y}${mo}${d}T${h}${mi}00`;
}

/* ---------- types (order matches the grid) ---------- */

export const QR_TYPES: QrType[] = [
  {
    id: "text",
    label: "Text",
    icon: { lib: "mci", name: "alpha-t-box-outline" },
    fields: [
      {
        key: "text",
        label: "Text",
        placeholder: "Type anything…",
        multiline: true,
      },
    ],
    build: (v) => t(v.text),
  },
  {
    id: "website",
    label: "Website",
    icon: { lib: "ion", name: "globe-outline" },
    fields: [
      {
        key: "url",
        label: "Web address",
        placeholder: "example.com",
        keyboard: "url",
        caps: "none",
      },
    ],
    build: (v) => {
      const u = withScheme(t(v.url));
      if (/\s/.test(u) || !u.includes("."))
        throw new Error("Enter a valid web address");
      return u;
    },
  },
  {
    id: "wifi",
    label: "Wi-Fi",
    icon: { lib: "ion", name: "wifi" },
    fields: [
      { key: "ssid", label: "Network name (SSID)", caps: "none" },
      {
        key: "security",
        label: "Security",
        options: ["WPA", "WEP", "None"],
        defaultValue: "WPA",
      },
      {
        key: "password",
        label: "Password",
        secure: true,
        caps: "none",
        showIf: (v) => v.security !== "None",
      },
    ],
    build: (v) => {
      const sec = v.security === "None" ? "nopass" : v.security;
      const pass = sec === "nopass" ? "" : wifiEsc(v.password ?? "");
      return `WIFI:T:${sec};S:${wifiEsc(t(v.ssid))};${pass ? `P:${pass};` : ""};`;
    },
  },
  {
    id: "event",
    label: "Event",
    icon: { lib: "mci", name: "calendar-check" },
    fields: [
      { key: "title", label: "Title" },
      {
        key: "start",
        label: "Starts",
        placeholder: "2026-11-11 13:00",
        keyboard: "numbers-and-punctuation",
      },
      {
        key: "end",
        label: "Ends",
        placeholder: "2026-11-11 14:00",
        keyboard: "numbers-and-punctuation",
      },
      { key: "location", label: "Location", optional: true },
    ],
    build: (v) => {
      const start = icsDate(v.start, "Start");
      const end = icsDate(v.end, "End");
      if (end <= start) throw new Error("End must be after start");
      return lines(
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        `SUMMARY:${vEsc(t(v.title))}`,
        t(v.location) && `LOCATION:${vEsc(t(v.location))}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        "END:VEVENT",
        "END:VCALENDAR",
      );
    },
  },
  {
    id: "contact",
    label: "Contact",
    icon: { lib: "mci", name: "contacts" },
    fields: [
      { key: "first", label: "First name", caps: "words" },
      { key: "last", label: "Last name", caps: "words", optional: true },
      { key: "phone", label: "Phone", keyboard: "phone-pad", optional: true },
      {
        key: "email",
        label: "Email",
        keyboard: "email-address",
        caps: "none",
        optional: true,
      },
    ],
    build: (v) => {
      const first = t(v.first);
      const last = t(v.last);
      if (t(v.email) && !EMAIL.test(t(v.email)))
        throw new Error("Enter a valid email");
      return lines(
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:${vEsc(last)};${vEsc(first)};;;`,
        `FN:${vEsc(`${first} ${last}`.trim())}`,
        t(v.phone) && `TEL;TYPE=CELL:${t(v.phone)}`,
        t(v.email) && `EMAIL:${t(v.email)}`,
        "END:VCARD",
      );
    },
  },
  {
    id: "business",
    label: "Business",
    icon: { lib: "mci", name: "office-building" },
    fields: [
      { key: "company", label: "Business name", caps: "words" },
      { key: "phone", label: "Phone", keyboard: "phone-pad", optional: true },
      {
        key: "email",
        label: "Email",
        keyboard: "email-address",
        caps: "none",
        optional: true,
      },
      {
        key: "website",
        label: "Website",
        keyboard: "url",
        caps: "none",
        optional: true,
      },
      { key: "address", label: "Address", multiline: true, optional: true },
    ],
    build: (v) => {
      if (t(v.email) && !EMAIL.test(t(v.email)))
        throw new Error("Enter a valid email");
      const company = vEsc(t(v.company));
      return lines(
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${company}`,
        `ORG:${company}`,
        t(v.phone) && `TEL;TYPE=WORK:${t(v.phone)}`,
        t(v.email) && `EMAIL:${t(v.email)}`,
        t(v.website) && `URL:${withScheme(t(v.website))}`,
        t(v.address) && `ADR;TYPE=WORK:;;${vEsc(t(v.address))};;;;`,
        "END:VCARD",
      );
    },
  },
  {
    id: "location",
    label: "Location",
    icon: { lib: "ion", name: "location" },
    fields: [
      {
        key: "lat",
        label: "Latitude",
        placeholder: "48.8584",
        keyboard: "numbers-and-punctuation",
      },
      {
        key: "lng",
        label: "Longitude",
        placeholder: "2.2945",
        keyboard: "numbers-and-punctuation",
      },
    ],
    build: (v) => {
      const lat = parseFloat(v.lat);
      const lng = parseFloat(v.lng);
      if (!isFinite(lat) || Math.abs(lat) > 90)
        throw new Error("Latitude must be between -90 and 90");
      if (!isFinite(lng) || Math.abs(lng) > 180)
        throw new Error("Longitude must be between -180 and 180");
      return `geo:${lat},${lng}`;
    },
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: { lib: "ion", name: "logo-whatsapp" },
    fields: [
      {
        key: "phone",
        label: "Phone (with country code)",
        placeholder: "15551234567",
        keyboard: "phone-pad",
      },
      { key: "message", label: "Message", multiline: true, optional: true },
    ],
    build: (v) => {
      const d = digits(v.phone);
      if (d.length < 7)
        throw new Error("Enter the full number with country code");
      const msg = t(v.message);
      return `https://wa.me/${d}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;
    },
  },
  {
    id: "email",
    label: "Email",
    icon: { lib: "ion", name: "mail" },
    fields: [
      { key: "to", label: "To", keyboard: "email-address", caps: "none" },
      { key: "subject", label: "Subject", optional: true },
      { key: "body", label: "Message", multiline: true, optional: true },
    ],
    build: (v) => {
      if (!EMAIL.test(t(v.to))) throw new Error("Enter a valid email");
      const params = [
        t(v.subject) && `subject=${encodeURIComponent(t(v.subject))}`,
        t(v.body) && `body=${encodeURIComponent(t(v.body))}`,
      ].filter(Boolean);
      return `mailto:${t(v.to)}${params.length ? `?${params.join("&")}` : ""}`;
    },
  },
  {
    id: "twitter",
    label: "Twitter",
    icon: { lib: "ion", name: "logo-twitter" },
    fields: [
      {
        key: "user",
        label: "Username",
        placeholder: "@username",
        caps: "none",
      },
    ],
    build: (v) => {
      const u = username(v.user);
      if (!/^[A-Za-z0-9_]{1,15}$/.test(u))
        throw new Error("Enter a valid Twitter username");
      return `https://twitter.com/${u}`;
    },
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: { lib: "ion", name: "logo-instagram" },
    fields: [
      {
        key: "user",
        label: "Username",
        placeholder: "@username",
        caps: "none",
      },
    ],
    build: (v) => {
      const u = username(v.user);
      if (!/^[A-Za-z0-9._]{1,30}$/.test(u))
        throw new Error("Enter a valid Instagram username");
      return `https://instagram.com/${u}`;
    },
  },
  {
    id: "telephone",
    label: "Telephone",
    icon: { lib: "ion", name: "call" },
    fields: [
      {
        key: "number",
        label: "Phone number",
        placeholder: "+15551234567",
        keyboard: "phone-pad",
      },
    ],
    build: (v) => {
      const n = t(v.number).replace(/[^\d+]/g, "");
      if (digits(n).length < 3) throw new Error("Enter a valid phone number");
      return `tel:${n}`;
    },
  },
];
