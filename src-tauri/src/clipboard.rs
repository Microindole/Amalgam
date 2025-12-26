use arboard::Clipboard;
use std::path::Path;
use std::thread;
use tauri::{Emitter};
use crate::utils::{base64_to_image, image_to_base64};

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

    let size = size_of::<DROPFILES>() + (buffer.len() * 2);
    let h_global = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size)
        .map_err(|e| e.to_string())?;
    let ptr = GlobalLock(h_global);

    if ptr.is_null() {
        let _ = CloseClipboard();
        return Err("内存分配失败".into());
    }

    let df = ptr as *mut DROPFILES;
    (*df).pFiles = size_of::<DROPFILES>() as u32;
    (*df).fWide = true.into();

    let target_ptr = (ptr as *mut u8).add(size_of::<DROPFILES>()) as *mut u16;
    std::ptr::copy_nonoverlapping(buffer.as_ptr(), target_ptr, buffer.len());

    let _ = GlobalUnlock(h_global);
    SetClipboardData(15, Some(windows::Win32::Foundation::HANDLE(h_global.0)))
        .map_err(|e| e.to_string())?;

    let _ = CloseClipboard();
    Ok(())
}

// --- 监听线程：Win32 消息循环 ---
pub fn start_clipboard_listener(app_handle: tauri::AppHandle) {
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
        // 1. 获取文件 (Native CF_HDROP)
        // 只有这里检测到的才会被视为 folder/file-link
        #[cfg(target_os = "windows")]
        unsafe {
            if let Some(file_paths) = get_clipboard_file_paths_native() {
                // 判断是文件还是文件夹
                let paths: Vec<&str> = file_paths.lines().collect();
                let msg_type = if paths.len() == 1 {
                    let path_str = paths[0].trim();
                    let path = Path::new(path_str);
                    if path.exists() && path.is_dir() {
                        "folder"
                    } else {
                        "file-link"
                    }
                } else {
                    "file-link"
                };
                let _ = app_handle.emit("clipboard-update", (msg_type, file_paths));
                detected_new = true;
            }
        }

        // 2. 获取文本
        // 修改点：直接作为 "text" 处理，不再尝试解析为路径
        if !detected_new {
            if let Ok(text) = clip.get_text() {
                if !text.is_empty() {
                    let _ = app_handle.emit("clipboard-update", ("text", text.clone()));
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
pub fn write_to_clipboard(kind: &str, content: &str) -> Result<(), String> {
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