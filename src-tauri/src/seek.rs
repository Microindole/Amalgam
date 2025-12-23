use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use walkdir::WalkDir;
use rayon::prelude::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;

#[derive(Serialize, Deserialize, Clone)]
pub struct FileResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

// 需要跳过的目录（性能优化）
const SKIP_DIRS: &[&str] = &[
    "$RECYCLE.BIN",
    "System Volume Information",
    "WindowsApps",
    "$Windows.~BT",
    "Windows",
    "ProgramData",
    "node_modules",
    ".git",
    ".idea",
    ".vscode",
    "__pycache__",
    "target",
    "build",
    "dist",
    ".cache",
    "cache",
];

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
        PathBuf::from(&search_path)
    };

    if !root.exists() {
        return Err(format!("路径不存在: {}", search_path));
    }

    let query_trimmed = query.trim();

    // 编译正则表达式
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

    let max_results = 300;
    let results = Arc::new(Mutex::new(Vec::new()));
    let should_stop = Arc::new(AtomicBool::new(false));

    // 判断搜索策略
    let is_root_drive = root.to_string_lossy().ends_with(":\\") || root.to_string_lossy() == "/";

    if is_root_drive {
        // 根目录：并行搜索多个一级子目录
        search_root_parallel(
            root,
            query_normalized,
            regex_matcher,
            match_case,
            results.clone(),
            should_stop.clone(),
            max_results,
        )?;
    } else {
        // 普通目录：分层并行搜索
        search_directory_layered(
            root,
            query_normalized,
            regex_matcher,
            match_case,
            results.clone(),
            should_stop.clone(),
            max_results,
        )?;
    }

    let final_results = results.lock().clone();

    let mut final_results = final_results;

    // 排序：目录优先，然后按路径深度，最后按名称长度
    final_results.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| {
                let depth_a = a.path.matches(std::path::MAIN_SEPARATOR).count();
                let depth_b = b.path.matches(std::path::MAIN_SEPARATOR).count();
                depth_a.cmp(&depth_b)
            })
            .then_with(|| a.name.len().cmp(&b.name.len()))
    });

    Ok(final_results)
}

// 根目录并行搜索策略 - 只搜索常见用户目录
fn search_root_parallel(
    root: PathBuf,
    query: String,
    regex: Option<regex::Regex>,
    match_case: bool,
    results: Arc<Mutex<Vec<FileResult>>>,
    should_stop: Arc<AtomicBool>,
    max_results: usize,
) -> Result<(), String> {
    // 只搜索常见的用户目录，跳过系统目录
    let subdirs: Vec<PathBuf> = std::fs::read_dir(&root)
        .map_err(|e| format!("无法读取目录: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return false;
            }
            let name = path.file_name().unwrap_or_default().to_string_lossy();

            // 跳过系统目录和隐藏目录
            !name.starts_with('$')
                && !name.starts_with('.')
                && !SKIP_DIRS.contains(&name.as_ref())
                && name != "Windows"
                && name != "Program Files"
                && name != "Program Files (x86)"
        })
        .map(|entry| entry.path())
        .collect();

    // 并行搜索，但限制深度
    subdirs.par_iter().for_each(|subdir| {
        if should_stop.load(Ordering::Relaxed) {
            return;
        }

        search_single_tree(
            subdir,
            &query,
            &regex,
            match_case,
            &results,
            &should_stop,
            max_results,
            6, // 根目录的子目录只搜索6层
        );
    });

    Ok(())
}

// 普通目录分层并行搜索
fn search_directory_layered(
    root: PathBuf,
    query: String,
    regex: Option<regex::Regex>,
    match_case: bool,
    results: Arc<Mutex<Vec<FileResult>>>,
    should_stop: Arc<AtomicBool>,
    max_results: usize,
) -> Result<(), String> {
    // 先快速扫描前几层
    search_single_tree(
        &root,
        &query,
        &regex,
        match_case,
        &results,
        &should_stop,
        max_results,
        4, // 先快速扫描4层
    );

    // 如果没找到足够的结果，再深入搜索
    if results.lock().len() < max_results / 2 && !should_stop.load(Ordering::Relaxed) {
        // 获取第2-3层的所有目录
        let deeper_dirs: Vec<PathBuf> = WalkDir::new(&root)
            .min_depth(2)
            .max_depth(3)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| should_visit_entry(e))
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .map(|e| e.path().to_path_buf())
            .collect();

        // 并行深入搜索这些目录
        deeper_dirs.par_iter().for_each(|dir| {
            if should_stop.load(Ordering::Relaxed) {
                return;
            }
            search_single_tree(
                dir,
                &query,
                &regex,
                match_case,
                &results,
                &should_stop,
                max_results,
                8, // 深入搜索8层
            );
        });
    }

    Ok(())
}

// 搜索单个目录树
fn search_single_tree(
    root: &PathBuf,
    query: &str,
    regex: &Option<regex::Regex>,
    match_case: bool,
    results: &Arc<Mutex<Vec<FileResult>>>,
    should_stop: &Arc<AtomicBool>,
    max_results: usize,
    max_depth: usize,
) {
    let walker = WalkDir::new(root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| should_visit_entry(e));

    for entry in walker {
        if should_stop.load(Ordering::Relaxed) {
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy();

        // 匹配逻辑
        let is_match = if let Some(re) = regex {
            re.is_match(&name)
        } else {
            if match_case {
                name.contains(query)
            } else {
                name.to_lowercase().contains(query)
            }
        };

        if is_match {
            let mut res = results.lock();
            if res.len() < max_results {
                res.push(FileResult {
                    name: name.to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    is_dir: entry.path().is_dir(),
                });
            } else {
                should_stop.store(true, Ordering::Relaxed);
                break;
            }
        }
    }
}

// 判断是否应该访问该目录项
fn should_visit_entry(entry: &walkdir::DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();

    // 跳过隐藏文件和系统目录
    if name.starts_with('.') || name.starts_with('$') {
        return false;
    }

    // 跳过已知的大型无用目录
    if SKIP_DIRS.contains(&name.as_ref()) {
        return false;
    }

    true
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