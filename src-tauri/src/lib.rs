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
async fn remove_background_api(src_path: String, api_key: String) -> Result<String, String> {
    let img_bytes = std::fs::read(&src_path).map_err(|e| e.to_string())?;
    let filename = std::path::Path::new(&src_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image.jpg")
        .to_string();

    let part = reqwest::multipart::Part::bytes(img_bytes).file_name(filename);
    let form = reqwest::multipart::Form::new()
        .part("image_file", part)
        .text("size", "auto");

    let client = reqwest::Client::builder()
        .user_agent("Thumbl/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post("https://api.remove.bg/v1.0/removebg")
        .header("X-Api-Key", &api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("remove.bg {}: {}", status, body));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let out_path = std::env::temp_dir().join(format!("thumbl_nobg_{}.png", ts));
    std::fs::write(&out_path, &bytes).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
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

const U2NET_URL: &str =
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx";

fn model_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("u2net.onnx"))
}

#[tauri::command]
async fn get_bg_model_status(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(model_path(&app)?.exists())
}

#[tauri::command]
async fn download_bg_model(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let path = model_path(&app)?;
    std::fs::create_dir_all(
        app.path().app_data_dir().map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("Thumbl/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(U2NET_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn remove_background_local(
    app: tauri::AppHandle,
    src_path: String,
) -> Result<String, String> {
    let path = model_path(&app)?;
    if !path.exists() {
        return Err("Model not downloaded.".to_string());
    }
    let model_str = path.to_string_lossy().to_string();
    let result_bytes = tokio::task::spawn_blocking(move || run_u2net(&model_str, &src_path))
        .await
        .map_err(|e| e.to_string())??;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let out = std::env::temp_dir().join(format!("thumbl_nobg_{}.png", ts));
    std::fs::write(&out, &result_bytes).map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().to_string())
}

fn run_u2net(model_path: &str, src_path: &str) -> Result<Vec<u8>, String> {
    use image::{GenericImageView, RgbaImage};
    use tract_onnx::prelude::*;

    let model = tract_onnx::onnx()
        .model_for_path(model_path)
        .map_err(|e| e.to_string())?
        .into_optimized()
        .map_err(|e| e.to_string())?
        .into_runnable()
        .map_err(|e| e.to_string())?;

    let img = image::ImageReader::open(src_path)
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    let (orig_w, orig_h) = img.dimensions();
    let resized = img.resize_exact(320, 320, image::imageops::FilterType::Lanczos3);
    let rgb = resized.to_rgb8();

    const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
    const STD: [f32; 3] = [0.229, 0.224, 0.225];

    let mut data = vec![0f32; 3 * 320 * 320];
    for y in 0..320usize {
        for x in 0..320usize {
            let p = rgb.get_pixel(x as u32, y as u32);
            for c in 0..3 {
                let v = p[c] as f32 / 255.0;
                data[c * 320 * 320 + y * 320 + x] = (v - MEAN[c]) / STD[c];
            }
        }
    }

    let input: Tensor =
        tract_ndarray::Array4::<f32>::from_shape_vec((1, 3, 320, 320), data)
            .map_err(|e| e.to_string())?
            .into();

    let outputs = model.run(tvec![input.into()]).map_err(|e| e.to_string())?;
    let mask = outputs[0].to_array_view::<f32>().map_err(|e| e.to_string())?;
    let mask_flat: Vec<f32> = mask.iter().copied().collect();

    let min = mask_flat.iter().cloned().fold(f32::INFINITY, f32::min);
    let max = mask_flat.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let range = (max - min).max(1e-6);

    let mut mask_img = image::GrayImage::new(320, 320);
    for y in 0..320u32 {
        for x in 0..320u32 {
            let idx = (y * 320 + x) as usize;
            let a = ((mask_flat[idx] - min) / range * 255.0).clamp(0.0, 255.0) as u8;
            mask_img.put_pixel(x, y, image::Luma([a]));
        }
    }

    let mask_full =
        image::imageops::resize(&mask_img, orig_w, orig_h, image::imageops::FilterType::Lanczos3);
    let orig_rgba = img.to_rgba8();
    let mut out = RgbaImage::new(orig_w, orig_h);
    for y in 0..orig_h {
        for x in 0..orig_w {
            let mut px = *orig_rgba.get_pixel(x, y);
            px[3] = mask_full.get_pixel(x, y)[0];
            out.put_pixel(x, y, px);
        }
    }

    let mut buf = std::io::Cursor::new(Vec::new());
    out.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            list_system_fonts,
            search_images,
            proxy_image,
            download_image_to_temp,
            save_image_file,
            remove_background_api,
            get_bg_model_status,
            download_bg_model,
            remove_background_local,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
