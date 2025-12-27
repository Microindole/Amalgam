import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ClipboardItem {
    id: string;
    type: "text" | "image" | "file-link" | "folder";
    content: string;
}

interface SerializedItem {
    id: string;
    kind: string;
    content: string;
}

export function useClipboardHistory() {
    const [history, setHistory] = useState<ClipboardItem[]>([]);
    const historyRef = useRef(history);

    useEffect(() => {
        historyRef.current = history;
    }, [history]);

    useEffect(() => {
        // 加载历史记录
        invoke<SerializedItem[]>("load_history").then(saved => {
            if (saved && saved.length > 0) {
                const restored: ClipboardItem[] = saved.map(s => ({
                    id: s.id,
                    type: s.kind as any,
                    content: s.content
                }));
                setHistory(restored);
            }
        });

        // 监听剪贴板更新
        const unlisten = listen<[string, string]>("clipboard-update", (event) => {
            const [type, content] = event.payload;
            setHistory(prev => {
                const filtered = prev.filter(item => item.content !== content);
                return [
                    { id: Date.now().toString(), type: type as any, content },
                    ...filtered
                ].slice(0, 50);
            });
        });

        return () => {
            unlisten.then(f => f());
        };
    }, []);

    const saveHistory = async () => {
        const itemsToSave = historyRef.current.map(item => ({
            id: item.id,
            kind: item.type,
            content: item.content
        }));
        await invoke("save_history", { history: itemsToSave });
    };

    const copyItem = (item: ClipboardItem) => {
        invoke("write_to_clipboard", {
            kind: item.type === "folder" ? "file-link" : item.type,
            content: item.content
        }).catch(err => {
            console.error("复制失败:", err);
        });
    };

    const locateFile = (path: string) => {
        invoke("open_in_explorer", { path }).catch(err => {
            console.error("打开失败:", err);
        });
    };

    return {
        history,
        saveHistory,
        copyItem,
        locateFile
    };
}