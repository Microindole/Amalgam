// src-tauri/src/seek.rs
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Clone)]
pub struct FileResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

// --- 新增：获取系统盘符 (Windows 专有) ---
#[tauri::command]
pub fn get_available_drives() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        // 调用 fsutil 或简单的逻辑获取 A-Z 盘符
        let mut drives = Vec::new();
        for letter in b'C'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if std::path::Path::new(&path).exists() {
                drives.push(path);
            }
        }
        drives
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec!["/".to_string()]
    }
}

#[tauri::command]
pub async fn search_files(query: String, search_path: String) -> Result<Vec<FileResult>, String> {
    if query.is_empty() {
        return Ok(vec![]);
    }

    // 修复：如果没有传入路径，默认使用 C 盘根目录
    let root = if search_path.is_empty() {
        PathBuf::from("C:\\")
    } else {
        PathBuf::from(search_path)
    };

    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    // 优化：适当增加深度，但为了性能依然建议限制
    // 注意：walkdir 在全盘扫描时会较慢，建议深度控制在 5-10 之间
    for entry in WalkDir::new(root)
        .max_depth(7) // 增加到 7 层
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let name = entry.file_name().to_string_lossy().to_string();

        // 核心：Rust 的 contains 和 to_lowercase 原生支持 Unicode (中文)
        if name.to_lowercase().contains(&query_lower) {
            results.push(FileResult {
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir: entry.file_type().is_dir(),
            });
        }

        if results.len() >= 50 {
            break;
        } // 增加结果显示上限
    }

    Ok(results)
}
