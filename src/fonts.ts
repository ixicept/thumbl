import { invoke } from "@tauri-apps/api/core";

export interface FontVariant {
  label: string;
  weight: number;
  italic: boolean;
}

export interface FontFamily {
  family: string;
  variants: FontVariant[];
}

const REGULAR: FontVariant = { label: "Regular", weight: 400, italic: false };

const FALLBACK_FONTS: FontFamily[] = [
  {
    family: "Arial",
    variants: [
      REGULAR,
      { label: "Bold", weight: 700, italic: false },
      { label: "Italic", weight: 400, italic: true },
      { label: "Bold Italic", weight: 700, italic: true },
    ],
  },
  { family: "Impact", variants: [REGULAR] },
  { family: "Times New Roman", variants: [REGULAR] },
  { family: "Courier New", variants: [REGULAR] },
  { family: "Georgia", variants: [REGULAR] },
];

export async function loadFonts(): Promise<FontFamily[]> {
  try {
    const list = await invoke<FontFamily[]>("list_system_fonts");
    return list.length > 0 ? list : FALLBACK_FONTS;
  } catch {
    return FALLBACK_FONTS;
  }
}

export function variantsFor(fonts: FontFamily[], family: string): FontVariant[] {
  return fonts.find((f) => f.family === family)?.variants ?? [REGULAR];
}
