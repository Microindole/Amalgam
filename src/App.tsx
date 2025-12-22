import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsPanel, AppSettings } from "./Settings"; // 导入新组件和接口
import "./App.css";

interface ClipboardItem {
  id: string;
  type: "text" | "image" | "file-link";
  content: string;
}

function App() {
  const [history, setHistory] = useState<ClipboardItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  
  // --- 新增：设置相关的状态 ---
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    // 1. 初始化时加载并应用主题设置
    invoke<AppSettings>("get_settings").then((settings) => {
      applyTheme(settings.theme);
    });

    // 2. 监听剪贴板更新事件
    const unlistenPromise = listen<[string, string]>("clipboard-update", (event) => {
      const [type, content] = event.payload;
      setHistory((prev) => {
        const filtered = prev.filter((item) => item.content !== content);
        return [{ id: Date.now().toString(), type: type as any, content }, ...filtered];
      });
    });

    return () => {
      unlistenPromise.then((f) => f());
    };
  }, []);

  // 应用主题逻辑
  const applyTheme = (theme: string) => {
    document.documentElement.setAttribute("data-theme", theme);
  };

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function handleCopy(item: ClipboardItem) {
    try {
      await invoke("write_to_clipboard", { kind: item.type, content: item.content });
      console.log("已复制:", item.type);
    } catch (error) {
      alert("复制失败: " + error);
    }
  }

  async function handleLocate(path: string) {
    try {
      await invoke("open_in_explorer", { path });
    } catch (error) {
      alert("定位失败: " + error);
    }
  }

  return (
    <div className="container">
      {/* 修改：Header 添加设置图标按钮 */}
      <div className="header">
        <span className="app-title">Amalgam Trace</span>
        <button className="settings-btn" onClick={() => setShowSettings(true)}>
          ⚙️
        </button>
      </div>
      <SettingsPanel visible={showSettings} onClose={() => setShowSettings(false)} />

      <div className="history-list">
        {history.map((item) => {
          const paths = item.content.split('\n');
          const isMulti = paths.length > 1;
          const isExpanded = expandedIds.has(item.id);
          
          const displayName = isMulti 
            ? `${paths[0].split(/[\\/]/).pop()} 等 ${paths.length} 个文件`
            : paths[0].split(/[\\/]/).pop();

          return (
            <div key={item.id} className={`history-item ${item.type}`} onClick={() => handleCopy(item)}>
              <div className="item-content">
                {item.type === "text" && <span>{item.content}</span>}
                {item.type === "image" && <img src={item.content} alt="preview" className="preview-img" />}
                {item.type === "file-link" && (
                  <div className="file-container">
                    <div className="file-tombstone">
                      <span 
                        className="file-icon" 
                        onClick={(e) => isMulti && toggleExpand(item.id, e)}
                        style={{ cursor: isMulti ? 'pointer' : 'default' }}
                      >
                        {isMulti ? (isExpanded ? "📖" : "📚") : "📄"}
                      </span>
                      <div className="file-info">
                        <span className="file-name">{displayName}</span>
                        <span className="file-path">{paths[0]}{isMulti && " ..."}</span>
                      </div>
                      <button className="locate-badge" onClick={(e) => { e.stopPropagation(); handleLocate(item.content); }}>
                        定位全部
                      </button>
                    </div>

                    {isMulti && isExpanded && (
                      <div className="file-sub-list">
                        {paths.map((p, idx) => (
                          <div key={idx} className="file-sub-item">
                            <span className="sub-path">{p}</span>
                            <button 
                              className="sub-locate-btn" 
                              onClick={(e) => { e.stopPropagation(); handleLocate(p); }}
                            >
                              定位
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <span className="item-meta">{item.type}</span>
            </div>
          );
        })}
      </div>

      {/* --- 新增：设置面板组件 --- */}
      <SettingsPanel 
        visible={showSettings} 
        onClose={() => setShowSettings(false)} 
      />
    </div>
  );
}

export default App;