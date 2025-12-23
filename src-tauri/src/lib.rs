use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::borrow::Cow;
use std::io::Cursor;
use std::path::Path;
use std::thread;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

// Windows 特有引用
#[cfg(target_os = "windows")]
use windows::{
    core::w,
    Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    Win32::System::DataExchange::{
        AddClipboardFormatListener, CloseClipboard, GetClipboardData, OpenClipboard,
        RemoveClipboardFormatListener, SetClipboardData, EmptyClipboard,
    },
    Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT},
    Win32::System::LibraryLoader::GetModuleHandleW,
    Win32::UI::Shell::{DragQueryFileW, HDROP, DROPFILES},
    Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
        HWND_MESSAGE, MSG, WNDCLASSW, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_CLIPBOARDUPDATE, GWLP_USERDATA, SetWindowLongPtrW, GetWindowLongPtrW,
    },
};

mod seek;
mod settings;
use settings::{SettingsState, get_settings, save_settings, init_settings};

// --- 原生 Win32 获取剪贴板文件路径 (CF_HDROP) ---
#[cfg(target_os = "windows")]
unsafe fn get_clipboard_file_paths_native() -> Option<String> {
    if !OpenClipboard(None).is_ok() { return None; }

    // CF_HDROP = 15
    let h_data = GetClipboardData(15).ok();
    let result = if let Some(handle) = h_data {
        let h_drop = HDROP(handle.0 as *mut _);
        let count = DragQueryFileW(h_drop, 0xFFFFFFFF, None);
        let mut paths = Vec::new();

        for i in 0..count {
            let len = DragQueryFileW(h_drop, i, None);
            let mut buffer = vec![0u16; len as usize + 1];
            DragQueryFileW(h_drop, i, Some(&mut buffer));
            paths.push(String::from_utf16_lossy(&buffer[..len as usize]));
        }
        Some(paths.join("\n"))
    } else {
        None
    };

    let _ = CloseClipboard();
    result
}

// --- 原生 Win32 写入剪贴板文件路径 ---
#[cfg(target_os = "windows")]
unsafe fn set_clipboard_file_paths_native(content: &str) -> Result<(), String> {
    let paths: Vec<Vec<u16>> = content.lines()
        .map(|line| line.encode_utf16().chain(std::iter::once(0)).collect())
        .collect();

    let mut buffer = Vec::new();
    for path in paths {
        buffer.extend_from_slice(&path);
    }
    buffer.push(0); // 结束标志

    if !OpenClipboard(None).is_ok() { return Err("无法打开剪贴板".into()); }
    let _ = EmptyClipboard();

    let size = std::mem::size_of::<DROPFILES>() + (buffer.len() * 2);
    let h_global = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size)
        .map_err(|e| e.to_string())?;
    let ptr = GlobalLock(h_global);

    if ptr.is_null() {
        let _ = CloseClipboard();
        return Err("内存分配失败".into());
    }

    let df = ptr as *mut DROPFILES;
    (*df).pFiles = std::mem::size_of::<DROPFILES>() as u32;
    (*df).fWide = true.into();

    let target_ptr = (ptr as *mut u8).add(std::mem::size_of::<DROPFILES>()) as *mut u16;
    std::ptr::copy_nonoverlapping(buffer.as_ptr(), target_ptr, buffer.len());

    let _ = GlobalUnlock(h_global);
    SetClipboardData(15, Some(windows::Win32::Foundation::HANDLE(h_global.0)))
        .map_err(|e| e.to_string())?;

    let _ = CloseClipboard();
    Ok(())
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

// --- 监听线程：Win32 消息循环 ---
fn start_clipboard_listener(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            let window_class = w!("AmalgamClipboardListener");
            let instance = GetModuleHandleW(None).unwrap();

            let wc = WNDCLASSW {
                hInstance: instance.into(),
                lpszClassName: window_class,
                lpfnWndProc: Some(clipboard_wndproc),
                ..Default::default()
            };

            let _ = RegisterClassW(&wc);

            let hwnd = match CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                window_class,
                w!("Clipboard Window"),
                WINDOW_STYLE::default(),
                0, 0, 0, 0,
                Some(HWND_MESSAGE),
                None,
                Some(instance.into()),
                None,
            ) {
                Ok(h) => h,
                Err(_) => return,
            };

            let _ = AddClipboardFormatListener(hwnd);

            let box_handle = Box::new(app_handle);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, Box::into_raw(box_handle) as isize);

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = DispatchMessageW(&msg);
            }

            let _ = RemoveClipboardFormatListener(hwnd);
        }
    });
}

#[cfg(target_os = "windows")]
extern "system" fn clipboard_wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        if msg == WM_CLIPBOARDUPDATE {
            let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
            if ptr != 0 {
                let app_handle = &*(ptr as *const tauri::AppHandle);
                check_clipboard_and_emit(app_handle);
            }
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

fn check_clipboard_and_emit(app_handle: &tauri::AppHandle) {
    let mut detected_new = false;

    if let Ok(mut clip) = Clipboard::new() {
        // 1. 获取文件 (Native)
        #[cfg(target_os = "windows")]
        unsafe {
            if let Some(file_paths) = get_clipboard_file_paths_native() {
                eprintln!("原始路径: {:?}", file_paths);
                // 判断是文件还是文件夹
                let paths: Vec<&str> = file_paths.lines().collect();
                eprintln!("路径数量: {}", paths.len());
                let msg_type = if paths.len() == 1 {
                    let path_str = paths[0].trim();
                    eprintln!("检查路径: {:?}", path_str);
                    let path = Path::new(path_str);
                    eprintln!("路径存在: {}", path.exists());
                    eprintln!("是文件夹: {}", path.is_dir());
                    if path.exists() && path.is_dir() {
                        "folder"
                    } else {
                        "file-link"
                    }
                } else {
                    "file-link"
                };
                eprintln!("消息类型: {}", msg_type);
                let _ = app_handle.emit("clipboard-update", (msg_type, file_paths));
                detected_new = true;
            }
        }

        // 2. 获取文本
        if !detected_new {
            if let Ok(text) = clip.get_text() {
                if !text.is_empty() {
                    let path_obj = Path::new(text.trim());
                    let msg_type = if path_obj.is_absolute() && path_obj.exists() {
                        if path_obj.is_dir() {
                            "folder"
                        } else {
                            "file-link"
                        }
                    } else {
                        "text"
                    };
                    let _ = app_handle.emit("clipboard-update", (msg_type, text.clone()));
                    detected_new = true;
                }
            }
        }

        // 3. 获取图片
        if !detected_new {
            if let Ok(img) = clip.get_image() {
                if let Some(b64_str) = image_to_base64(img) {
                    let _ = app_handle.emit("clipboard-update", ("image", b64_str));
                }
            }
        }
    }
}

// --- 命令：写入剪贴板 ---
#[tauri::command]
fn write_to_clipboard(kind: &str, content: &str) -> Result<(), String> {
    if kind == "file-link" {
        #[cfg(target_os = "windows")]
        unsafe { return set_clipboard_file_paths_native(content); }
        #[cfg(not(target_os = "windows"))]
        return Err("不支持该平台的路径写入".into());
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
                            let _ = if window.is_visible().unwrap_or(false) { 
                                window.hide() 
                            } else { 
                                window.show().and_then(|_| window.set_focus()) 
                            };
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
            save_settings,
            seek::search_files,
            seek::get_available_drives
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