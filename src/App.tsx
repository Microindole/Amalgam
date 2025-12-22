import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

function App() {
  const [history, setHistory] = useState<string[]>([]);

  // 处理新内容的逻辑（抽离出来复用）
  const addHistoryItem = (newText: string) => {
    setHistory((prev) => {
      // 1. 先把数组里已有的这个内容删掉 (去重)
      const filtered = prev.filter((item) => item !== newText);
      // 2. 把新的加到最前面
      return [newText, ...filtered];
    });
  };

  useEffect(() => {
    // 监听 Rust 的剪贴板更新
    const unlistenPromise = listen<string>("clipboard-update", (event) => {
      addHistoryItem(event.payload);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function handleCopy(text: string) {
    try {
      await invoke("write_to_clipboard", { content: text });
      // 点击后，手动把这一项“顶”到最前面，给用户即时反馈
      addHistoryItem(text);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }

  return (
    <div className="container">
      {/* 顶部搜索栏/状态栏 (伪装成 Win11 标题栏风格) */}
      <div className="header">
        <span className="app-title">Trace</span>
        <span className="status-badge">Running</span>
      </div>

      <div className="history-list">
        {history.length === 0 ? (
          <div className="empty-state">
            <p>Clipboard history is empty</p>
          </div>
        ) : (
          history.map((item, index) => (
            <div 
              key={item} // 既然去重了，用 content 做 key 会更稳定
              className="history-item"
              onClick={() => handleCopy(item)}
            >
              <div className="item-content">
                {item.length > 100 ? item.substring(0, 100) + "..." : item}
              </div>
              {/* 只是装饰用的时间戳/类型图标位，以后可以加 */}
              <span className="item-meta">Text</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;