import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

// 定义数据结构
interface ClipboardItem {
  id: string;
  type: "text" | "image" | "file-link"; // ✅ 确保这里有 file-link
  content: string;
}

function App() {
  const [history, setHistory] = useState<ClipboardItem[]>([]);

  // 1. 修改这里：参数类型必须包含 "file-link"
  const addHistoryItem = (type: "text" | "image" | "file-link", content: string) => {
    setHistory((prev) => {
      // 简单去重
      const filtered = prev.filter((item) => item.content !== content);
      return [{ 
        id: Date.now().toString(), 
        type, 
        content 
      }, ...filtered];
    });
  };

  useEffect(() => {
    // 监听 Rust 事件
    const unlistenPromise = listen<[string, string]>("clipboard-update", (event) => {
      const [type, content] = event.payload;
      
      // 2. 修改这里：放行 "file-link" 类型
      // 使用 includes 检查，并用 as any 绕过简单的类型推断限制
      if (["text", "image", "file-link"].includes(type)) {
        addHistoryItem(type as any, content);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function handleCopy(item: ClipboardItem) {
    try {
      document.body.style.cursor = "wait";
      // 如果是 file-link，告诉 Rust 把它当 text (路径字符串) 写入
      const writeType = item.type === "file-link" ? "text" : item.type;
      
      await invoke("write_to_clipboard", { kind: writeType, content: item.content });
      addHistoryItem(item.type, item.content);
    } catch (error) {
      console.error("Failed to copy:", error);
      alert("复制失败: " + error);
    } finally {
      document.body.style.cursor = "default";
    }
  }

  return (
    <div className="container">
      <div className="header">
        <span className="app-title">Trace</span>
        <span className="settings-btn">⚙️</span>
      </div>

      <div className="history-list">
        {history.length === 0 ? (
          <div className="empty-state"><p>Empty</p></div>
        ) : (
          history.map((item) => (
            <div 
              key={item.id} 
              className="history-item"
              onClick={() => handleCopy(item)}
            >
              <div className="item-content">
                {item.type === "text" ? (
                  <span>{item.content}</span>
                ) : item.type === "image" ? (
                  <img src={item.content} alt="Clipboard" className="preview-img" />
                ) : (
                  /* 3. 确保这里有 file-link 的渲染逻辑 */
                  <div className="file-tombstone">
                    <span className="file-icon">📁</span>
                    <div className="file-info">
                      <span className="file-name">
                        {item.content.split(/[\\/]/).pop()} 
                      </span>
                      <span className="file-path">{item.content}</span>
                    </div>
                    <span className="link-badge">LINK</span>
                  </div>
                )}
              </div>
              <span className="item-meta">{item.type}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;