use std::path::Path;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};

// 引入模块
mod seek;
mod settings;
mod utils;
mod clipboard;

use settings::{SettingsState, get_settings, save_settings, init_settings};
use crate::utils::{SavedClipboardItem, save_history_to_disk, load_history_from_disk};

// 命令：在资源管理器中打开
#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() { return Err("文件不存在".into()); }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg("/select,")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// 保存历史
#[tauri::command]
fn save_history(app: tauri::AppHandle, history: Vec<SavedClipboardItem>) -> Result<(), String> {
    save_history_to_disk(&app, history)
}

// 加载历史
#[tauri::command]
fn load_history(app: tauri::AppHandle) -> Result<Vec<SavedClipboardItem>, String> {
    load_history_from_disk(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 托盘设置
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    // 检查点击的是否是我们定义的 "quit" ID
                    if event.id() == "quit" {
                        app.exit(0); // 直接退出程序 (不会触发 CloseRequested拦截，也不会再次询问)
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = if window.is_visible().unwrap_or(false) {
                                window.hide()
                            } else {
                                window.show().and_then(|_| window.set_focus())
                            };
                        }
                    }
                })
                .build(app)?;

            // 设置初始化
            let initial_settings = init_settings(app.handle());
            app.manage(SettingsState(std::sync::Mutex::new(initial_settings)));

            // 启动剪贴板监听
            let handle = app.handle().clone();
            clipboard::start_clipboard_listener(handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            clipboard::write_to_clipboard, // 引用 clipboard 模块的命令
            open_in_explorer,
            get_settings,
            save_settings,
            seek::search_files,
            seek::get_available_drives,
            save_history,
            load_history
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<SettingsState>();
                let settings = state.0.lock().unwrap();
                if settings.close_to_tray {
                    window.hide().unwrap();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}