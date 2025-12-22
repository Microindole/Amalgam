use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::borrow::Cow;
use std::io::Cursor;
use std::path::Path;
use std::process::Command; 
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

// --- 辅助函数：通过 PowerShell 获取剪贴板文件路径 ---
fn get_clipboard_file_path() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        // 探测剪贴板中是否有 FileDropList (文件列表格式)
        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg("if (Get-Clipboard -Format FileDropList) { (Get-Clipboard -Format FileDropList).FullName | Select-Object -First 1 }")
            .output()
            .ok()?;
        
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

// --- 辅助函数：图片转换 (保持不变) ---
fn image_to_base64(img: ImageData) -> Option<String> {
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

fn base64_to_image(b64: &str) -> Result<ImageData<'static>, String> {
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

// --- 监听线程 (修复: 增加文件探测) ---
fn start_clipboard_listener(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let mut last_content = String::new();
        let mut last_img_len = 0;

        loop {
            let mut detected_new = false;

            if let Ok(mut clip) = Clipboard::new() {
                // 1. 优先探测文本
                if let Ok(text) = clip.get_text() {
                    if !text.is_empty() && text != last_content {
                        let path_obj = Path::new(&text);
                        // 判断是否是普通文本还是手动复制的路径字符串
                        let (msg_type, content) = if path_obj.is_absolute() && path_obj.exists() {
                            ("file-link", text.clone())
                        } else {
                            ("text", text.clone())
                        };
                        last_content = text;
                        let _ = app_handle.emit("clipboard-update", (msg_type, content));
                        detected_new = true;
                    }
                } 
                
                // 2. 如果没发现新文本，尝试探测“文件复制”行为
                if !detected_new {
                    if let Some(file_path) = get_clipboard_file_path() {
                        if file_path != last_content {
                            println!("Rust: 捕获到系统文件复制行为 -> {}", file_path);
                            last_content = file_path.clone();
                            let _ = app_handle.emit("clipboard-update", ("file-link", file_path));
                            detected_new = true;
                        }
                    }
                }

                // 3. 探测图片 (修复: 只有在没发现文件/文本时才检查图片，减少开销)
                if !detected_new {
                    if let Ok(img) = clip.get_image() {
                        if img.bytes.len() != last_img_len {
                            last_img_len = img.bytes.len();
                            if let Some(b64_str) = image_to_base64(img) {
                                let _ = app_handle.emit("clipboard-update", ("image", b64_str));
                            }
                        }
                    }
                }
            }
            // 扫描频率建议 500ms，体验更灵动
            thread::sleep(Duration::from_millis(500));
        }
    });
}

// --- 命令：写入剪贴板 (修复: 真正的底层文件复制) ---
#[tauri::command]
fn write_to_clipboard(kind: &str, content: &str) -> Result<(), String> {
    println!("Rust: 执行写入 -> 类型: {}", kind);

    if kind == "file-link" {
        // 使用更稳健的 PowerShell 命令将路径转为文件对象
        let escaped_path = content.replace("'", "''");
        let ps_cmd = format!("Set-Clipboard -Path '{}'", escaped_path);
        
        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(&ps_cmd)
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err("系统文件复制失败".into());
        }
        return Ok(());
    }

    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    if kind == "text" {
        clipboard.set_text(content).map_err(|e| e.to_string())?;
    } else if kind == "image" {
        let img_data = base64_to_image(content)?;
        clipboard.set_image(img_data).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- 命令：定位文件 ---
#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    Command::new("explorer").arg("/select,").arg(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = if window.is_visible().unwrap_or(false) { window.hide() } else { window.show().and_then(|_| window.set_focus()) };
                        }
                    }
                })
                .build(app)?;

            let handle = app.handle().clone();
            start_clipboard_listener(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![write_to_clipboard, open_in_explorer])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}