use arboard::ImageData;
use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::borrow::Cow;
use std::io::Cursor;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// --- 辅助函数：图片转换 ---

pub fn image_to_base64(img: ImageData) -> Option<String> {
    let img_buffer = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(
        img.width as u32,
        img.height as u32,
        img.bytes.into_owned(),
    )?;
    let mut bytes: Vec<u8> = Vec::new();
    img_buffer.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).ok()?;
    let b64 = general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

pub fn base64_to_image(b64: &str) -> Result<ImageData<'static>, String> {
    let clean_b64 = b64.split(',').nth(1).ok_or("数据格式错误")?;
    let bytes = general_purpose::STANDARD.decode(clean_b64).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (width, height) = img.dimensions();
    Ok(ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(img.into_raw()),
    })
}

// 定义与前端一致的数据结构
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct SavedClipboardItem {
    pub id: String,
    pub kind: String, // 对应前端的 type，因为 type 是关键字所以用 kind
    pub content: String,
}

// 获取存储路径：建议放在 AppData/com.amalgam.dev/history.json
fn get_history_file_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("history.json")
}

// 保存历史
pub fn save_history_to_disk(app: &AppHandle, history: Vec<SavedClipboardItem>) -> Result<(), String> {
    let path = get_history_file_path(app);
    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(&history).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// 读取并删除历史
pub fn load_history_from_disk(app: &AppHandle) -> Result<Vec<SavedClipboardItem>, String> {
    let path = get_history_file_path(app);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let history: Vec<SavedClipboardItem> = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // 读取后立即删除文件（根据你的需求）
    let _ = fs::remove_file(path);

    Ok(history)
}
