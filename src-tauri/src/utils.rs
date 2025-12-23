use arboard::ImageData;
use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::borrow::Cow;
use std::io::Cursor;

// --- 辅助函数：图片转换 ---

pub fn image_to_base64(img: ImageData) -> Option<String> {
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

pub fn base64_to_image(b64: &str) -> Result<ImageData<'static>, String> {
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