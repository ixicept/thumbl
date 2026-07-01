use font_kit::properties::Style;
use font_kit::source::SystemSource;
use std::collections::BTreeMap;

#[derive(serde::Serialize)]
struct ImageResult {
    img_src: String,
    thumbnail_src: Option<String>,
    title: String,
}

#[tauri::command]
async fn search_images(base_url: String, query: String) -> Result<Vec<ImageResult>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Thumbl/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(format!("{}/search", base_url.trim_end_matches('/')))
        .query(&[("q", &query), ("format", &"json".to_string()), ("categories", &"images".to_string())])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let results = json["results"]
        .as_array()
        .ok_or_else(|| "Invalid SearXNG response".to_string())?
        .iter()
        .filter_map(|r| {
            let img_src = r["img_src"].as_str()?.to_string();
            Some(ImageResult {
                img_src,
                thumbnail_src: r["thumbnail_src"]
                    .as_str()
                    .or_else(|| r["thumbnail"].as_str())
                    .map(|s| s.to_string()),
                title: r["title"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect();

    Ok(results)
}

#[tauri::command]
async fn proxy_image(url: String) -> Result<String, String> {
    use base64::Engine;

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(format!("data:{};base64,{}", content_type, b64))
}

#[tauri::command]
async fn save_image_file(data_url: String, path: String) -> Result<(), String> {
    use base64::Engine;
    let b64 = data_url
        .splitn(2, ',')
        .nth(1)
        .ok_or("Invalid data URL")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
async fn download_image_to_temp(url: String) -> Result<String, String> {
    // Reject non-http(s) schemes up front (e.g. data:, ftp:) with a clear message
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("Unsupported URL scheme: {}", url));
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("client build failed: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("request failed ({}): {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} from {}", response.status(), url));
    }

    let ext = {
        let ct = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        match ct.as_str() {
            "image/jpeg" | "image/jpg" => "jpg".to_string(),
            "image/png" => "png".to_string(),
            "image/webp" => "webp".to_string(),
            "image/gif" => "gif".to_string(),
            "image/bmp" => "bmp".to_string(),
            "image/avif" => "avif".to_string(),
            _ => {
                // fall back to URL path extension
                let path_part = url.split('?').next().unwrap_or(&url);
                let last = path_part.rsplit('/').next().unwrap_or("");
                let maybe = last.rsplit('.').next().unwrap_or("").to_lowercase();
                if ["jpg", "jpeg", "png", "webp", "gif"].contains(&maybe.as_str()) {
                    maybe
                } else {
                    "jpg".to_string()
                }
            }
        }
    };

    let bytes = response.bytes().await.map_err(|e| format!("download failed: {}", e))?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_path = std::env::temp_dir().join(format!("thumbl_{}.{}", ts, ext));
    std::fs::write(&temp_path, &bytes).map_err(|e| e.to_string())?;

    Ok(temp_path.to_string_lossy().to_string())
}

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
        .invoke_handler(tauri::generate_handler![list_system_fonts, search_images, proxy_image, download_image_to_temp, save_image_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
