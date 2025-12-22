// src-tauri/src/lib.rs

// 1. 必须引入 Manager，否则 app.handle() 无法使用
use tauri::{Manager, Emitter}; 
use std::thread;
use std::time::Duration;
use arboard::Clipboard;

// 监听线程逻辑（保持不变）
fn start_clipboard_listener(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let mut last_content = String::new();
        // 初始化剪贴板
        let mut clipboard = Clipboard::new();

        println!("Rust: 剪贴板监听线程已启动...");

        loop {
            // 这里为了容错，每次循环重新连接一次剪贴板实例（防止被其他程序锁死）
            // 如果觉得性能不够好，可以将 Clipboard::new() 移到 loop 外面，只在出错时重建
            if let Ok(mut clip) = Clipboard::new() {
                 if let Ok(text) = clip.get_text() {
                    // 如果内容不为空且发生了变化
                    if !text.is_empty() && text != last_content {
                        println!("Rust: 捕获到新复制内容 -> {}", text);
                        
                        // 更新内存记录
                        last_content = text.clone();

                        // 发送给前端
                        let _ = app_handle.emit("clipboard-update", text);
                    }
                }
            }
            
            // 休息 1 秒
            thread::sleep(Duration::from_millis(1000));
        }
    });
}

// 写入剪贴板的命令
#[tauri::command]
fn write_to_clipboard(content: &str) -> Result<(), String> {
    println!("Rust: 正在写入剪贴板 -> {}", content);
    
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(content).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 启动监听线程
            let handle = app.handle().clone();
            start_clipboard_listener(handle);
            Ok(())
        })
        // 2. 关键！在这里注册你的命令，否则前端找不到 write_to_clipboard
        .invoke_handler(tauri::generate_handler![write_to_clipboard])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}