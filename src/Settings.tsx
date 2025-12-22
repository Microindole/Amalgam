// Settings.tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  theme: "light" | "dark" | "system";
  close_to_tray: boolean;
}

export function SettingsPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (visible) {
      invoke<AppSettings>("get_settings").then(setSettings);
    }
  }, [visible]);

  const updateSetting = async (key: keyof AppSettings, value: any) => {
    if (!settings) return;
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await invoke("save_settings", { settings: newSettings });
    if (key === "theme") document.documentElement.setAttribute("data-theme", value);
  };

  if (!visible || !settings) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-window" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">设置</span>
          <button className="close-title-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-content">
          {/* 设置卡片 1：主题 */}
          <div className="setting-card">
            <div className="setting-icon">🎨</div>
            <div className="setting-info">
              <div className="setting-label">外观主题</div>
              <div className="setting-description">选择应用的主题颜色</div>
            </div>
            <select 
              className="win-select"
              value={settings.theme} 
              onChange={(e) => updateSetting("theme", e.target.value)}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色模式</option>
              <option value="dark">深色模式</option>
            </select>
          </div>

          {/* 设置卡片 2：关闭行为 */}
          <div className="setting-card">
            <div className="setting-icon">📥</div>
            <div className="setting-info">
              <div className="setting-label">退出行为</div>
              <div className="setting-description">点击关闭按钮时最小化到系统托盘</div>
            </div>
            {/* 模拟 WinUI Toggle Switch */}
            <label className="win-switch">
              <input 
                type="checkbox" 
                checked={settings.close_to_tray} 
                onChange={(e) => updateSetting("close_to_tray", e.target.checked)}
              />
              <span className="win-slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}