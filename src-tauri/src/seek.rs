use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use walkdir::WalkDir;
use rayon::prelude::*;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone)]
pub struct FileResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn search_files(
    query: String,
    search_path: String,
    is_regex: bool,
    match_case: bool,
) -> Result<Vec<FileResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let root = if search_path.is_empty() {
        #[cfg(target_os = "windows")]
        { PathBuf::from("C:\\") }
        #[cfg(not(target_os = "windows"))]
        { PathBuf::from("/") }
    } else {
        PathBuf::from(search_path)
    };

    // 动态构建搜索路径：直接搜索根目录或其常见子目录
    let priority_paths = if root.to_string_lossy().ends_with(":\\") || root.to_string_lossy() == "/" {
        // 如果是盘符根目录，尝试常见目录，但允许它们不存在
        vec![
            root.join("Program Files"),
            root.join("Program Files (x86)"),
            root.join("Users"),
            root.join("ProgramData"),
            root.clone(), // 添加根目录本身
        ]
    } else {
        // 如果是普通目录，直接搜索该目录
        vec![root.clone()]
    };

    let query_trimmed = query.trim();
    let regex_matcher = if is_regex {
        Some(
            RegexBuilder::new(query_trimmed)
                .case_insensitive(!match_case)
                .unicode(true)
                .build()
                .map_err(|e| format!("正则语法错误: {}", e))?
        )
    } else {
        None
    };

    let query_normalized = if !is_regex && !match_case {
        query_trimmed.to_lowercase()
    } else {
        query_trimmed.to_string()
    };

    let all_results = Mutex::new(Vec::new());
    let max_results = 100;

    // 并行搜索多个目录
    priority_paths
        .par_iter()
        .filter(|p| p.exists()) // 只搜索存在的目录
        .for_each(|path| {
            if all_results.lock().unwrap().len() >= max_results {
                return;
            }

            let mut local_results = Vec::new();

            // 根据是否为根目录调整搜索深度
            let is_root = path.to_string_lossy().ends_with(":\\") || path.to_string_lossy() == "/";
            let max_depth = if is_root { 3 } else { 6 };

            for entry in WalkDir::new(path)
                .max_depth(max_depth)
                .follow_links(false)
                .into_iter()
                .filter_entry(|e| {
                    let name = e.file_name().to_string_lossy();
                    !name.starts_with('$')
                        && !name.starts_with('.')
                        && name != "System Volume Information"
                        && name != "$RECYCLE.BIN"
                        && name != "WindowsApps"
                })
                .filter_map(|e| e.ok())
            {
                let name = entry.file_name().to_string_lossy();
                let is_match = if let Some(re) = &regex_matcher {
                    re.is_match(&name)
                } else {
                    if match_case {
                        name.contains(query_trimmed)
                    } else {
                        name.to_lowercase().contains(&query_normalized)
                    }
                };

                if is_match {
                    local_results.push(FileResult {
                        name: name.to_string(),
                        path: entry.path().to_string_lossy().to_string(),
                        is_dir: entry.path().is_dir(),
                    });
                }

                // 每个目录最多30个结果
                if local_results.len() >= 30 {
                    break;
                }
            }

            // 将本地结果合并到全局
            let mut global = all_results.lock().unwrap();
            if global.len() < max_results {
                let remaining = max_results - global.len();
                global.extend(local_results.into_iter().take(remaining));
            }
        });

    let mut final_results = all_results.into_inner().unwrap();

    // 排序：文件夹优先，然后按名称长度
    final_results.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.len().cmp(&b.name.len()))
    });

    Ok(final_results)
}

#[tauri::command]
pub fn get_available_drives() -> Vec<String> {
    let mut drives = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if std::path::Path::new(&path).exists() {
                drives.push(path);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        drives.push("/".into());
    }

    if drives.is_empty() {
        drives.push("C:\\".into());
    }

    drives
}