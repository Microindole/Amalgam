import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface ClipboardItem {
  id: string;
  type: "text" | "image" | "file-link";
  content: string;
}

function App() {
  const [history, setHistory] = useState<ClipboardItem[]>([]);
  // 新增：记录哪些多文件项目被展开了
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unlistenPromise = listen<[string, string]>("clipboard-update", (event) => {
      const [type, content] = event.payload;
      setHistory((prev) => {
        const filtered = prev.filter((item) => item.content !== content);
        return [{ id: Date.now().toString(), type: type as any, content }, ...filtered];
      });
    });
    return () => { unlistenPromise.then((f) => f()); };
  }, []);

  // 切换展开/收起状态
  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发底层的复制逻辑
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
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
      <div className="header"><span className="app-title">Amalgam Trace</span></div>
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
                    {/* 主显示区域 */}
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

                    {/* 展开的详细列表 */}
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
    </div>
  );
}

export default App;