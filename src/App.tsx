import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsPanel, AppSettings } from "./Settings";
import "./App.css";

// --- 数据接口定义 ---
interface ClipboardItem {
  id: string;
  type: "text" | "image" | "file-link";
  content: string;
}

interface FileResult {
  name: string;
  path: string;
  is_dir: boolean;
}

function App() {
  // --- 状态管理 ---
  const [history, setHistory] = useState<ClipboardItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<"trace" | "seek">("trace");

  // Seek 状态
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [drives, setDrives] = useState<string[]>([]);
  const [selectedDrive, setSelectedDrive] = useState("C:\\");

  // --- 初始化与监听 ---
  useEffect(() => {
    // 1. 初始化应用主题
    invoke<AppSettings>("get_settings").then((settings) => {
      document.documentElement.setAttribute("data-theme", settings.theme);
    });

    // 2. 监听剪贴板更新
    const unlistenPromise = listen<[string, string]>("clipboard-update", (event) => {
      const [type, content] = event.payload;
      setHistory((prev) => {
        const filtered = prev.filter((item) => item.content !== content);
        return [{ id: Date.now().toString(), type: type as any, content }, ...filtered];
      });
    });

    return () => { unlistenPromise.then((f) => f()); };
  }, []);

  // 切换 Seek 视图时获取盘符
  useEffect(() => {
    if (activeTab === "seek") {
      invoke<string[]>("get_available_drives").then(setDrives);
    }
  }, [activeTab]);

  // --- 逻辑函数 ---
  const handleLocate = async (path: string) => {
    try {
      await invoke("open_in_explorer", { path });
    } catch (err) {
      alert("定位失败: " + err);
    }
  };

  const handleCopy = async (item: ClipboardItem) => {
    try {
      await invoke("write_to_clipboard", { kind: item.type, content: item.content });
    } catch (err) {
      alert("复制失败: " + err);
    }
  };

  const executeSearch = async (query: string, drive: string) => {
    if (query.trim().length < 2) return setSearchResults([]);
    setIsSearching(true);
    try {
      const res = await invoke<FileResult[]>("search_files", { query, searchPath: drive });
      setSearchResults(res);
    } finally {
      setIsSearching(false);
    }
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

  return (
    <div className="container">
      {/* Header: 采用 Mica 效果类 */}
      <header className="header mica-container">
        <div className="nav-group">
          <span className="app-title">Amalgam</span>
          <div className="tab-switcher">
            <div 
              className={`tab-item ${activeTab === 'trace' ? 'active' : ''}`} 
              onClick={() => setActiveTab('trace')}
            >Trace</div>
            <div 
              className={`tab-item ${activeTab === 'seek' ? 'active' : ''}`} 
              onClick={() => setActiveTab('seek')}
            >Seek</div>
          </div>
        </div>
        <button className="win-badge" onClick={() => setShowSettings(true)}>⚙️ 设置</button>
      </header>

      <main className="main-content">
        {/* --- Trace 视图 --- */}
        {activeTab === "trace" && (
          <div className="trace-list">
            {history.map((item) => {
              const paths = item.content.split('\n');
              const isMulti = paths.length > 1;
              const isExpanded = expandedIds.has(item.id);
              const displayName = isMulti 
                ? `${paths[0].split(/[\\/]/).pop()} 等 ${paths.length} 个文件`
                : paths[0].split(/[\\/]/).pop();

              return (
                <div key={item.id} className="win-card trace-card" onClick={() => handleCopy(item)}>
                  <div className="item-body">
                    {item.type === "text" && <div className="text-content">{item.content}</div>}
                    {item.type === "image" && <img src={item.content} className="preview-img" alt="clip" />}
                    {item.type === "file-link" && (
                      <div className="file-container">
                        <div className="file-main">
                          <span 
                            className="file-icon" 
                            onClick={(e) => isMulti && toggleExpand(item.id, e)}
                          >
                            {isMulti ? (isExpanded ? "📖" : "📚") : "📄"}
                          </span>
                          <div className="file-info">
                            <div className="file-name">{displayName}</div>
                            <div className="file-path">{paths[0]}</div>
                          </div>
                          <button className="win-badge" onClick={(e) => { e.stopPropagation(); handleLocate(item.content); }}>
                            定位
                          </button>
                        </div>
                        {isMulti && isExpanded && (
                          <div className="file-sub-list">
                            {paths.map((p, idx) => (
                              <div key={idx} className="file-sub-item">
                                <span className="sub-path">{p}</span>
                                <button className="sub-locate-btn" onClick={(e) => { e.stopPropagation(); handleLocate(p); }}>
                                  定位
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="item-meta">{item.type}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* --- Seek 视图 --- */}
        {activeTab === "seek" && (
          <div className="seek-view">
            <div className="search-bar mica-container">
              <select 
                className="win-select" 
                value={selectedDrive} 
                onChange={e => {
                  setSelectedDrive(e.target.value);
                  executeSearch(searchQuery, e.target.value);
                }}
              >
                {drives.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input 
                className="win-input search-input"
                placeholder="搜索文件名..." 
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  executeSearch(e.target.value, selectedDrive);
                }}
              />
            </div>

            <div className="results-list">
              {searchResults.map((file, idx) => (
                <div key={idx} className="win-card search-card" onClick={() => handleLocate(file.path)}>
                  <span className="file-type-icon">{file.is_dir ? "📁" : "📄"}</span>
                  <div className="file-details">
                    <div className="file-name">{file.name}</div>
                    <div className="file-path">{file.path}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <SettingsPanel visible={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

export default App;