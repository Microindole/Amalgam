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

  useEffect(() => {
    const unlistenPromise = listen<[string, string]>("clipboard-update", (event) => {
      const [type, content] = event.payload;
      // 捕获到新内容时去重并添加
      setHistory((prev) => {
        const filtered = prev.filter((item) => item.content !== content);
        return [{ id: Date.now().toString(), type: type as any, content }, ...filtered];
      });
    });
    return () => { unlistenPromise.then((f) => f()); };
  }, []);

  async function handleCopy(item: ClipboardItem) {
    try {
      // 关键：这里直接透传 item.type，如果是 file-link，Rust 会执行 PS 命令进行文件复制
      await invoke("write_to_clipboard", { kind: item.type, content: item.content });
      console.log("已成功复制:", item.type);
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
          // 处理多文件路径显示
          const paths = item.content.split('\n');
          const isMulti = paths.length > 1;
          const displayName = isMulti 
            ? `${paths[0].split(/[\\/]/).pop()} 等 ${paths.length} 个文件`
            : paths[0].split(/[\\/]/).pop();

          return (
            <div key={item.id} className={`history-item ${item.type}`} onClick={() => handleCopy(item)}>
              <div className="item-content">
                {item.type === "text" && <span>{item.content}</span>}
                {item.type === "image" && <img src={item.content} alt="preview" className="preview-img" />}
                {item.type === "file-link" && (
                  <div className="file-tombstone">
                    <span className="file-icon">{isMulti ? "📚" : "📄"}</span>
                    <div className="file-info">
                      <span className="file-name">{displayName}</span>
                      <span className="file-path">{paths[0]}{isMulti && " ..."}</span>
                    </div>
                    <button className="locate-badge" onClick={(e) => { e.stopPropagation(); handleLocate(item.content); }}>
                      定位
                    </button>
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