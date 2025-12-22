use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager}; // 修复：必须导入 Manager 才能使用 .path()

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    pub theme: String,         // "light", "dark", "system"
    pub close_to_tray: bool,   // true: 最小化到托盘, false: 彻底退出
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            close_to_tray: true,
        }
    }
}

pub struct SettingsState(pub Mutex<AppSettings>);

// 获取配置文件路径 (使用 Manager 提供的 path 方法)
fn get_settings_path(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_config_dir()
        .unwrap()
        .join("settings.json")
}

// 初始化设置
pub fn init_settings(app_handle: &AppHandle) -> AppSettings {
    let path = get_settings_path(app_handle);
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(settings) = serde_json::from_str(&content) {
            return settings;
        }
    }
    AppSettings::default()
}

// 命令：保存设置
#[tauri::command]
pub fn save_settings(
    app_handle: AppHandle,
    settings: AppSettings,
    state: tauri::State<SettingsState>,
) -> Result<(), String> {
    // 1. 更新内存状态
    let mut current_settings = state.0.lock().unwrap();
    *current_settings = settings.clone();

    // 2. 写入文件
    let path = get_settings_path(&app_handle);
    let config_dir = path.parent().unwrap();
    if !config_dir.exists() {
        fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;

    Ok(())
}

// 命令：获取设置
#[tauri::command]
pub fn get_settings(state: tauri::State<SettingsState>) -> AppSettings {
    state.0.lock().unwrap().clone()
}