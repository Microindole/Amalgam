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
  // --- 核心状态 ---
  const [history, setHistory] = useState<ClipboardItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);

  // 新增：用于切换 Trace 和 Seek 视图的状态
  const [activeTab, setActiveTab] = useState<"trace" | "seek">("trace");

  // --- Seek 相关状态 ---
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [drives, setDrives] = useState<string[]>([]);
  const [selectedDrive, setSelectedDrive] = useState("C:\\");

  useEffect(() => {
    // 1. 初始化应用主题
    invoke<AppSettings>("get_settings").then((settings) => {
      document.documentElement.setAttribute("data-theme", settings.theme);
    });

    // 2. 监听剪贴板更新 (Trace 模块核心)
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

  useEffect(() => {
    if (activeTab === "seek") {
      invoke<string[]>("get_available_drives").then(setDrives);
    }
  }, [activeTab]);

  // --- 通用逻辑 ---
  async function handleLocate(path: string) {
    try {
      await invoke("open_in_explorer", { path });
    } catch (error) {
      alert("定位失败: " + error);
    }
  }

  // --- Trace 逻辑 ---
  async function handleCopy(item: ClipboardItem) {
    try {
      await invoke("write_to_clipboard", { kind: item.type, content: item.content });
    } catch (error) {
      alert("复制失败: " + error);
    }
  }

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // --- Seek 搜索逻辑 ---
  const handleFileSearch = async (val: string) => {
    setSearchQuery(val);
    if (val.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      // 调用 Rust 后端搜索命令
      const results = await invoke<FileResult[]>("search_files", {
        query: val,
        searchPath: "" // 传空则后端默认使用文档目录或 C 盘
      });
      setSearchResults(results);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const executeSearch = async (query: string, drive: string) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      // 关键修复：将 selectedDrive 传递给后端
      const results = await invoke<FileResult[]>("search_files", {
        query: query,
        searchPath: drive
      });
      setSearchResults(results);
    } catch (err) {
      console.error("搜索失败:", err);
    } finally {
      setIsSearching(false);
    }
  };

  // 处理输入变更
  const handleInputChange = (val: string) => {
    setSearchQuery(val);
    executeSearch(val, selectedDrive);
  };

  // 修复：处理盘符变更，变更后立即重新搜索
  const handleDriveChange = (drive: string) => {
    setSelectedDrive(drive);
    if (searchQuery.length >= 2) {
      executeSearch(searchQuery, drive);
    }
  };

  return (
    <div className="container">
      {/* 顶部栏：包含标题、导航 Tab 和设置按钮 */}
      <div className="header">
        <div className="nav-group">
          <span className="app-title">Amalgam</span>
          <div className="tab-switcher">
            <button
              className={activeTab === "trace" ? "tab active" : "tab"}
              onClick={() => setActiveTab("trace")}
            >
              Trace
            </button>
            <button
              className={activeTab === "seek" ? "tab active" : "tab"}
              onClick={() => setActiveTab("seek")}
            >
              Seek
            </button>
          </div>
        </div>
        <button className="settings-btn" onClick={() => setShowSettings(true)}>⚙️</button>
      </div>

      <div className="main-content">
        {/* --- 视图 1: Trace (剪贴板历史) --- */}
        {activeTab === "trace" && (
          <div className="history-list">
            {history.length === 0 ? (
              <div className="empty-state">剪贴板空空如也</div>
            ) : (
              history.map((item) => {
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
                                  <button className="sub-locate-btn" onClick={(e) => { e.stopPropagation(); handleLocate(p); }}>定位</button>
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
              })
            )}
          </div>
        )}

        {/* --- 视图 2: Seek (文件极速查找) --- */}
        {activeTab === "seek" && (
          <div className="seek-view">
            <div className="search-bar">
              <select
                className="win-select drive-select"
                value={selectedDrive}
                onChange={(e) => handleDriveChange(e.target.value)}
              >
                {drives.map(d => <option key={d} value={d}>{d}</option>)}
              </select>

              <input
                type="text"
                className="win-input"
                placeholder="搜索文件名..."
                value={searchQuery}
                onChange={(e) => handleInputChange(e.target.value)}
              />
            </div>

            <div className="results-list">
              {searchResults.length === 0 && searchQuery.length >= 2 && !isSearching && (
                <div className="empty-state">未找到相关文件</div>
              )}
              {searchResults.map((file, idx) => (
                <div key={idx} className="search-item" onClick={() => handleLocate(file.path)}>
                  <span className="file-icon">{file.is_dir ? "📁" : "📄"}</span>
                  <div className="file-info">
                    <div className="file-name">{file.name}</div>
                    <div className="file-path">{file.path}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <SettingsPanel visible={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

export default App;