// src-tauri/src/lib.rs

// 注意这个宏，它把 Rust 函数暴露给前端
#[tauri::command]
fn greet(name: &str) -> String {
    // format! 是 Rust 里的字符串拼接，类似 JS 的 `Template string`
    format!("Hello, {}! This message comes from Rust.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet]) // 注册你的函数
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}