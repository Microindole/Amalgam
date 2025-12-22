import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

// 定义数据结构
interface ClipboardItem {
  id: string; // 用时间戳做ID
  type: "text" | "image";
  content: string; // 文本内容 或 Base64图片
}

function App() {
  const [history, setHistory] = useState<ClipboardItem[]>([]);

  const addHistoryItem = (type: "text" | "image", content: string) => {
    setHistory((prev) => {
      // 简单去重 (如果是图片，对比 Base64 字符串会有点慢，MVP先这样)
      const filtered = prev.filter((item) => item.content !== content);
      return [{ 
        id: Date.now().toString(), 
        type, 
        content 
      }, ...filtered];
    });
  };

  useEffect(() => {
    // 注意：Rust 发送的 payload 现在是一个元组 ["text", "内容"]
    const unlistenPromise = listen<[string, string]>("clipboard-update", (event) => {
      const [type, content] = event.payload;
      // 类型断言安全转换
      if (type === "text" || type === "image") {
        addHistoryItem(type, content);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function handleCopy(item: ClipboardItem) {
    try {
      // 临时给个用户反馈（比如把鼠标变漏斗，或者 toast）
      document.body.style.cursor = "wait"; 
      
      console.log("TS: Requesting copy for", item.type);
      await invoke("write_to_clipboard", { kind: item.type, content: item.content });
      
      // 成功后把这一项置顶
      addHistoryItem(item.type, item.content);
      console.log("TS: Copy success");
    } catch (error) {
      // ⚠️ 这里现在会把 Rust 的具体错误打印出来
      console.error("Failed to copy:", error);
      alert("复制失败: " + error); // 简单弹窗告知错误
    } finally {
      document.body.style.cursor = "default";
    }
  }

  return (
    <div className="container">
      <div className="header">
        <span className="app-title">Trace</span>
        {/* 设置按钮占位符 */}
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
                ) : (
                  // 显示图片预览
                  <img src={item.content} alt="Clipboard" className="preview-img" />
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