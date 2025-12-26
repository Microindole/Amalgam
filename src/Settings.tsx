import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { applyTheme } from "./App";

export interface AppSettings {
  theme: "light" | "dark" | "system";
  close_to_tray: boolean;
}

export function SettingsPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  // 使用定义好的接口替代 any
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (visible) {
      invoke<AppSettings>("get_settings").then(setSettings);
    }
  }, [visible]);

  const update = async (key: keyof AppSettings, value: any) => {
    if (!settings) return;

    const next = { ...settings, [key]: value };
    setSettings(next);

    // 保存到后端
    await invoke("save_settings", { settings: next });

    if (key === "theme") {
      await applyTheme(value);
    }
  };

  if (!visible || !settings) return null;

  return (
    <div className="settings-overlay mica-container" onClick={onClose} style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div className="settings-window win-card" onClick={e => e.stopPropagation()} style={{
        width: '400px', flexDirection: 'column', padding: '24px', gap: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <b style={{fontSize: '18px'}}>设置</b>
          <button className="win-badge" onClick={onClose}>关闭</button>
        </div>

        {/* 共享 App.css 中的 win-card 样式，保持 WinUI 一致性 */}
        <div className="win-card" style={{width: '100%', boxSizing: 'border-box', justifyContent: 'space-between'}}>
          <div>外观主题</div>
          <select className="win-select" value={settings.theme} onChange={e => update("theme", e.target.value)}>
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>

        <div className="win-card" style={{width: '100%', boxSizing: 'border-box', justifyContent: 'space-between'}}>
          <div>关闭行为 (最小化到托盘)</div>
          <input 
            type="checkbox" 
            checked={settings.close_to_tray} 
            onChange={e => update("close_to_tray", e.target.checked)} 
          />
        </div>
      </div>
    </div>
  );
}