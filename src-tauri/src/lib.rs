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

mod settings; // 引入新模块

use settings::{AppSettings, SettingsState, get_settings, save_settings, init_settings};

// --- 辅助函数：通过 PowerShell 获取剪贴板所有文件路径 (解决乱码与多选) ---
fn get_clipboard_file_paths() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        // 核心修复：强制 PowerShell 以 UTF8 编码输出
        let ps_script = "
            [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
            $files = Get-Clipboard -Format FileDropList;
            if ($files) { $files.FullName }
        ";
        
        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(ps_script)
            .output()
            .ok()?;
        
        if output.status.success() {
            // 使用 UTF-8 转换并过滤空行
            let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !result.is_empty() {
                // 返回所有文件路径，以换行符分隔
                return Some(result);
            }
        }
    }
    None
}

// --- 辅助函数：图片转换 ---
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

// --- 监听线程 ---
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
                
                // 2. 探测文件复制 (CF_HDROP 格式)
                if !detected_new {
                    if let Some(file_paths) = get_clipboard_file_paths() {
                        if file_paths != last_content {
                            println!("Rust: 捕获到多文件复制行为");
                            last_content = file_paths.clone();
                            let _ = app_handle.emit("clipboard-update", ("file-link", file_paths));
                            detected_new = true;
                        }
                    }
                }

                // 3. 探测图片
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
            thread::sleep(Duration::from_millis(500));
        }
    });
}

// --- 命令：写入剪贴板 (修复多选回写) ---
#[tauri::command]
fn write_to_clipboard(kind: &str, content: &str) -> Result<(), String> {
    if kind == "file-link" {
        // 将换行符分隔的路径转为 PowerShell 数组格式
        let paths: Vec<String> = content.lines().map(|l| format!("'{}'", l.replace("'", "''"))).collect();
        let paths_arr = paths.join(",");
        
        let ps_cmd = format!(
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Path {}", 
            paths_arr
        );
        
        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(&ps_cmd)
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err("回写文件失败".into());
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

#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    // 如果是多个文件，打开第一个文件所在的文件夹并定位
    let first_path = path.lines().next().unwrap_or(&path);
    Command::new("explorer").arg("/select,").arg(first_path).spawn().map_err(|e| e.to_string())?;
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

            let initial_settings = init_settings(app.handle());
            app.manage(SettingsState(std::sync::Mutex::new(initial_settings)));

            let handle = app.handle().clone();
            start_clipboard_listener(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_to_clipboard, 
            open_in_explorer,
            get_settings,
            save_settings
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 根据设置决定是隐藏还是真正关闭
                let state = window.state::<SettingsState>();
                let settings = state.0.lock().unwrap();
                
                if settings.close_to_tray {
                    window.hide().unwrap();
                    api.prevent_close();
                }
                // 如果 close_to_tray 为 false，则不调用 prevent_close，应用正常退出
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}