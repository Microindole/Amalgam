use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::borrow::Cow;
use std::io::Cursor;
use std::thread;
use std::time::Duration;
use std::path::Path;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

// --- 辅助函数：把 Arboard 的图片转换成 Base64 字符串 ---
fn image_to_base64(img: ImageData) -> Option<String> {
    // 1. 利用 image 库创建一个内存中的图片缓冲
    let img_buffer = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(
        img.width as u32,
        img.height as u32,
        img.bytes.into_owned(),
    )?;

    // 2. 把图片编码成 PNG 格式的字节流
    let mut bytes: Vec<u8> = Vec::new();
    img_buffer
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .ok()?;

    // 3. 转成 Base64 字符串，并在前面加上 HTML img 标签需要的头
    let b64 = general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

// --- 辅助函数：把 Base64 字符串转回 Arboard 图片 ---
fn base64_to_image(b64: &str) -> Result<ImageData<'static>, String> {
    // 1. 尝试去掉头部 "data:image/png;base64,"
    let clean_b64 = b64
        .split(',')
        .nth(1)
        .ok_or("错误: 图片数据缺少头部(data:...)")?;

    // 2. 尝试 Base64 解码
    let bytes = general_purpose::STANDARD
        .decode(clean_b64)
        .map_err(|e| format!("错误: Base64解码失败 -> {}", e))?;

    // 3. 尝试识别 PNG 并加载
    // ⚠️ 如果这里报错，说明 image 库没有开启 png feature，或者数据损坏
    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("错误: 图片加载失败(可能是格式不支持) -> {}", e))?
        .to_rgba8();

    let (width, height) = img.dimensions();
    println!("Rust Debug: 图片解析成功! 大小: {}x{}", width, height);

    Ok(ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(img.into_raw()),
    })
}

// --- 监听线程 ---
fn start_clipboard_listener(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let mut last_text = String::new();
        let mut last_img_len = 0; // 这个变量现在会被用到了

        loop {
            if let Ok(mut clip) = Clipboard::new() {
                // A. 文本/文件路径 探测
                if let Ok(text) = clip.get_text() {
                    if !text.is_empty() && text != last_text {
                        // --- 🌟 墓碑机制的核心逻辑 ---
                        let path_obj = Path::new(&text);

                        // 判断：是绝对路径 且 文件/文件夹真实存在？
                        let (msg_type, content) = if path_obj.is_absolute() && path_obj.exists() {
                            println!("Rust: 发现文件墓碑 -> {}", text);
                            ("file-link", text) // 标记为文件链接
                        } else {
                            println!("Rust: 发现普通文本 -> {}", text);
                            ("text", text) // 标记为普通文本
                        };

                        last_text = content.clone();
                        let _ = app_handle.emit("clipboard-update", (msg_type, content));
                    }
                }

                // B. 图片探测 (修复：把逻辑加回来了！)
                if let Ok(img) = clip.get_image() {
                    // 简单的去重逻辑：如果图片字节长度变了，就认为是新图片
                    if img.bytes.len() != last_img_len {
                        println!("Rust: 捕获图片, 大小: {}", img.bytes.len());
                        last_img_len = img.bytes.len();
                        
                        // 转 Base64 发给前端
                        if let Some(b64_str) = image_to_base64(img) {
                            // 发送事件：类型是 "image"
                            let _ = app_handle.emit("clipboard-update", ("image", b64_str));
                        }
                    }
                }
            }
            // 休息 1 秒
            thread::sleep(Duration::from_millis(1000));
        }
    });
}

// --- 命令：写入 ---
#[tauri::command]
fn write_to_clipboard(kind: &str, content: &str) -> Result<(), String> {
    println!("Rust: 收到写入请求 -> 类型: {}", kind);

    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;

    if kind == "text" {
        clipboard.set_text(content).map_err(|e| e.to_string())?;
    } else if kind == "image" {
        // 调用上面的函数，如果有错误直接抛出
        let img_data = base64_to_image(content)?;

        println!("Rust: 正在把图片写入系统剪贴板...");
        clipboard
            .set_image(img_data)
            .map_err(|e| format!("错误: 系统剪贴板拒绝写入图片 -> {}", e))?;
    }

    println!("Rust: 写入完成!");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // --- 初始化托盘图标 ---
        .setup(|app| {
            // 设置托盘菜单：退出
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone()) // 使用默认图标
                .menu(&menu)
                .show_menu_on_left_click(false) // 左键不显示菜单，而是触发事件
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        // 左键点击托盘：切换窗口显示/隐藏
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // 启动监听线程
            let handle = app.handle().clone();
            start_clipboard_listener(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![write_to_clipboard])
        // 这里的配置很重要：让应用保持后台运行
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 拦截“关闭”按钮：不要真的退出，而是隐藏窗口
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
