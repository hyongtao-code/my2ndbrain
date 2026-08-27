// Inline SVG icon set used across the frontend chrome.
//
// All icons are 14px (default) or 12px (IconClose / IconCheck),
// 1.4px stroke (1.2px for the more delicate Brain/Sparkle,
// 1.6px for the chunkier Check), `currentColor` so they pick up
// the surrounding text colour via CSS. They are aria-hidden by
// default — pass `aria-label` on the wrapping button for the
// accessible name.
//
// Before this file, every modal duplicated its own Icon* functions
// (3 copies of IconClose, 2 each of IconDraft / IconLink / IconTrash).
// Adding a new modal meant copy-pasting the SVG again. Consolidating
// here means each icon lives in exactly one place; if you need to
// tweak a stroke width or add a new icon, do it here.

type IconProps = { size?: number };

export function IconArrowDown({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <line x1={8} y1={3} x2={8} y2={13} />
      <polyline points="3.5,8.5 8,13 12.5,8.5" />
    </svg>
  );
}

export function IconArrowUp({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <line x1={8} y1={13} x2={8} y2={3} />
      <polyline points="3.5,7.5 8,3 12.5,7.5" />
    </svg>
  );
}

export function IconBrain({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.2} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M5 4.5 C3.5 4.5 3 6 3 7.2 C3 8.2 3.5 9 4.2 9.3
               C4.1 9.5 4.2 10.2 4 10.7 C4 12 5.3 12.6 6.4 12.3
               L6.4 13 L8 12.5 L9.6 13 L9.6 12.3
               C10.7 12.6 12 12 12 10.7 C11.8 10.2 11.9 9.5 12.8 9.3
               C12.5 9 13 8.2 13 7.2 C13 6 12.5 4.5 11 4.5
               C10.5 3.5 9.5 3.5 9 4.2 C8.5 3.5 7.5 3.5 7 4.2
               C6.5 3.5 5.5 3.5 5 4.5 Z" />
      <line x1={8} y1={5.5} x2={8} y2={12} />
    </svg>
  );
}

export function IconBulb({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M8 2 C5.5 2 4 4 4 6 C4 7.5 5 8.5 5.5 9.5 L5.5 10.5 L10.5 10.5 L10.5 9.5 C11 8.5 12 7.5 12 6 C12 4 10.5 2 8 2 Z" />
      <line x1={6} y1={12} x2={10} y2={12} />
      <line x1={6.5} y1={13.5} x2={9.5} y2={13.5} />
    </svg>
  );
}

export function IconChat({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M2.5 4 C2.5 3.2 3.2 2.5 4 2.5 L12 2.5 C12.8 2.5 13.5 3.2 13.5 4 L13.5 9.5 C13.5 10.3 12.8 11 12 11 L6 11 L3.5 13 L3.5 11 C3 10.7 2.5 10.2 2.5 9.5 Z" />
    </svg>
  );
}

export function IconCheck({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <polyline points="3.5,8 7,11.5 12.5,5" />
    </svg>
  );
}

export function IconClose({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <line x1={3.5} y1={3.5} x2={12.5} y2={12.5} />
      <line x1={12.5} y1={3.5} x2={3.5} y2={12.5} />
    </svg>
  );
}

export function IconDownload({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <line x1={8} y1={2.5} x2={8} y2={10.5} />
      <polyline points="4,7 8,11 12,7" />
      <line x1={3} y1={13.5} x2={13} y2={13.5} />
    </svg>
  );
}

export function IconDraft({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M3.5 2.5 L10.5 2.5 L13 5 L13 13.5 L3.5 13.5 Z" />
      <polyline points="10,2.5 10,5.5 13,5.5" />
      <line x1={5.5} y1={7.5} x2={11} y2={7.5} />
      <line x1={5.5} y1={10} x2={11} y2={10} />
    </svg>
  );
}

export function IconEdit({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M3 13 L3 11 L11 3 L13 5 L5 13 Z" />
      <line x1={9} y1={5} x2={11} y2={7} />
    </svg>
  );
}

export function IconError({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <circle cx={8} cy={8} r={6} />
      <line x1={5.5} y1={5.5} x2={10.5} y2={10.5} />
      <line x1={10.5} y1={5.5} x2={5.5} y2={10.5} />
    </svg>
  );
}

export function IconEye({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M1.5 8 C3.5 4.5 5.5 3 8 3 C10.5 3 12.5 4.5 14.5 8 C12.5 11.5 10.5 13 8 13 C5.5 13 3.5 11.5 1.5 8 Z" />
      <circle cx={8} cy={8} r={2} />
    </svg>
  );
}

export function IconEyeOff({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <line x1={2.5} y1={3.5} x2={13.5} y2={12.5} />
      <path d="M4 5 C3 6 2 7 1.5 8 C3.5 11.5 5.5 13 8 13 C9.5 13 10.5 12.5 11.5 11.5" />
      <path d="M6 4 C6.5 3.5 7.5 3 8 3 C10.5 3 12.5 4.5 14.5 8 C14 9 13.5 9.5 13 10" />
      <circle cx={8} cy={8} r={2} />
    </svg>
  );
}

export function IconFile({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M3.5 2 L10.5 2 L13 4.5 L13 14 L3.5 14 Z" />
      <polyline points="10,2 10,5 13,5" />
    </svg>
  );
}

export function IconGear({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <circle cx={8} cy={8} r={2.4} />
      <line x1={8} y1={2.5} x2={8} y2={4.5} />
      <line x1={8} y1={11.5} x2={8} y2={13.5} />
      <line x1={2.5} y1={8} x2={4.5} y2={8} />
      <line x1={11.5} y1={8} x2={13.5} y2={8} />
      <line x1={4} y1={4} x2={5.5} y2={5.5} />
      <line x1={10.5} y1={10.5} x2={12} y2={12} />
      <line x1={12} y1={4} x2={10.5} y2={5.5} />
      <line x1={5.5} y1={10.5} x2={4} y2={12} />
    </svg>
  );
}

export function IconLink({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M7 9 C5.5 10.5 3.5 10.5 2.5 9.5 C1.5 8.5 1.5 6.5 2.5 5.5 L4 4" />
      <path d="M9 7 C10.5 5.5 12.5 5.5 13.5 6.5 C14.5 7.5 14.5 9.5 13.5 10.5 L12 12" />
      <line x1={6} y1={10} x2={10} y2={6} />
    </svg>
  );
}

export function IconMerge({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <circle cx={4} cy={4} r={2} />
      <circle cx={12} cy={4} r={2} />
      <circle cx={8} cy={13} r={2} />
      <line x1={4.5} y1={5.5} x2={7.5} y2={11} />
      <line x1={11.5} y1={5.5} x2={8.5} y2={11} />
      <line x1={6} y1={4} x2={10} y2={4} />
    </svg>
  );
}

export function IconMinimize({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <line x1={3} y1={11} x2={13} y2={11} />
    </svg>
  );
}

export function IconPlus({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <line x1={8} y1={3} x2={8} y2={13} />
      <line x1={3} y1={8} x2={13} y2={8} />
    </svg>
  );
}

export function IconRefresh({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M3 8 C3 5.2 5.2 3 8 3 C10 5 11.5 6 12 7" />
      <polyline points="12,4 12,7 9,7" />
      <path d="M13 8 C13 10.8 10.8 13 8 13 C6 11 4.5 10 4 9" />
      <polyline points="4,12 4,9 7,9" />
    </svg>
  );
}

export function IconSearch({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <circle cx={7} cy={7} r={4.5} />
      <line x1={10.4} y1={10.4} x2={13.5} y2={13.5} />
    </svg>
  );
}

export function IconSparkle({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.2} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M8 2 L9 6 L13 7 L9 8 L8 12 L7 8 L3 7 L7 6 Z" />
      <line x1={12} y1={3} x2={12} y2={4.5} />
      <line x1={12} y1={9.5} x2={12} y2={11} />
      <line x1={13.25} y1={6.25} x2={11.75} y2={6.25} />
      <line x1={13.25} y1={7.75} x2={11.75} y2={7.75} />
    </svg>
  );
}

export function IconTrash({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <line x1={3} y1={5} x2={13} y2={5} />
      <path d="M5 5 L5 12.5 C5 13 5.5 13.5 6 13.5 L10 13.5 C10.5 13.5 11 13 11 12.5 L11 5" />
      <path d="M6 5 L6 3.5 C6 3 6.5 2.5 7 2.5 L9 2.5 C9.5 2.5 10 3 10 3.5 L10 5" />
      <line x1={7} y1={7} x2={7} y2={12} />
      <line x1={9} y1={7} x2={9} y2={12} />
    </svg>
  );
}

export function IconUpload({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <line x1={8} y1={13.5} x2={8} y2={5.5} />
      <polyline points="4,9 8,5 12,9" />
      <line x1={3} y1={2.5} x2={13} y2={2.5} />
    </svg>
  );
}
