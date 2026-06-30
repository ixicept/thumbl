use font_kit::properties::Style;
use font_kit::source::SystemSource;
use std::collections::BTreeMap;

#[derive(serde::Serialize)]
struct FontVariant {
    label: String,
    weight: u32,
    italic: bool,
}

#[derive(serde::Serialize)]
struct FontFamily {
    family: String,
    variants: Vec<FontVariant>,
}

fn weight_name(weight: u32) -> &'static str {
    match weight {
        0..=149 => "Thin",
        150..=249 => "ExtraLight",
        250..=349 => "Light",
        350..=449 => "Regular",
        450..=549 => "Medium",
        550..=649 => "SemiBold",
        650..=749 => "Bold",
        750..=849 => "ExtraBold",
        _ => "Black",
    }
}

fn variant_label(weight: u32, italic: bool) -> String {
    if weight == 400 && !italic {
        "Regular".to_string()
    } else if weight == 400 && italic {
        "Italic".to_string()
    } else if italic {
        format!("{} Italic", weight_name(weight))
    } else {
        weight_name(weight).to_string()
    }
}

#[tauri::command]
fn list_system_fonts() -> Vec<FontFamily> {
    let source = SystemSource::new();
    // family name -> set of (weight, italic) variants
    let mut map: BTreeMap<String, Vec<(u32, bool)>> = BTreeMap::new();

    if let Ok(handles) = source.all_fonts() {
        for handle in handles {
            if let Ok(font) = handle.load() {
                let props = font.properties();
                let weight = props.weight.0.round() as u32;
                let italic = props.style != Style::Normal;
                map.entry(font.family_name())
                    .or_default()
                    .push((weight, italic));
            }
        }
    }

    map.into_iter()
        .map(|(family, mut variants)| {
            variants.sort();
            variants.dedup();
            FontFamily {
                family,
                variants: variants
                    .into_iter()
                    .map(|(weight, italic)| FontVariant {
                        label: variant_label(weight, italic),
                        weight,
                        italic,
                    })
                    .collect(),
            }
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![list_system_fonts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
