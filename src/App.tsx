import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsPanel, AppSettings } from "./Settings";
import { ask } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import "./App.css";

interface SerializedItem {
    id: string;
    kind: string;
    content: string;
}

interface ClipboardItem {
    id: string;
    type: "text" | "image" | "file-link" | "folder";
    content: string;
}

interface FileResult {
    name: string;
    path: string;
    is_dir: boolean;
}

const appWindow = getCurrentWindow();

export const applyTheme = async (theme: "light" | "dark" | "system") => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
        if (theme === "system") {
            await appWindow.setTheme(null);
        } else {
            await appWindow.setTheme(theme as "light" | "dark");
        }
    } catch (e) {
        console.error("无法设置原生主题:", e);
    }
};

function App() {
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
    const [isRegex, setIsRegex] = useState(false);
    const [matchCase, setMatchCase] = useState(false);

    const timerRef = useRef<number | null>(null);
    const searchVersionRef = useRef<number>(0);

    useEffect(() => {

        // --- A. 加载历史 ---
        invoke<SerializedItem[]>("load_history").then(saved => {
            if (saved && saved.length > 0) {
                // 将后端返回的 'kind' 映射回前端的 'type'
                const restored: ClipboardItem[] = saved.map(s => ({
                    id: s.id,
                    type: s.kind as any,
                    content: s.content
                }));
                setHistory(restored);
            }
        });

        // --- B. 拦截关闭事件 ---
        const initCloseListener = async () => {
            // 监听窗口关闭请求
            const unlisten = await appWindow.onCloseRequested(async (event) => {
                // 获取当前设置（判断是否最小化到托盘）
                const settings = await invoke<AppSettings>("get_settings");

                // 如果设置了"关闭时最小化到托盘"，则不拦截，交给 Rust 处理隐藏
                if (settings.close_to_tray) {
                    return;
                }

                // 否则，这是真正的退出操作，我们需要拦截
                event.preventDefault(); // 阻止默认关闭

                // 弹出询问框
                const yes = await ask('想要保存当前的剪贴板历史以便下次使用吗？', {
                    title: 'Amalgam - 保存历史',
                    kind: 'info',
                    okLabel: '保存并退出',
                    cancelLabel: '直接退出'
                });

                if (yes) {
                    try {
                        await saveCurrentHistory();
                    } catch (e) {
                        console.error("保存历史失败:", e);
                    }
                }

                // 无论保存与否，最后都要关闭窗口
                await appWindow.destroy(); // 强制销毁窗口
            });
            return unlisten;
        };

        const unlistenPromise = initCloseListener();

        invoke<AppSettings>("get_settings").then(s => {
            applyTheme(s.theme as any);
        });

        invoke<string[]>("get_available_drives").then(drives => {
            setDrives(drives);
            if (drives.length > 0) setSelectedDrive(drives[0]);
        });

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
            unlistenPromise.then(f => f());
            unlisten.then(f => f());
        };
    }, []);

    const executeSearch = (query: string, drive: string, reg: boolean, mc: boolean) => {
        setSearchQuery(query);
        if (timerRef.current) clearTimeout(timerRef.current);
        searchVersionRef.current += 1;
        const currentVersion = searchVersionRef.current;

        if (query.trim().length < 1) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        timerRef.current = window.setTimeout(async () => {
            if (currentVersion !== searchVersionRef.current) return;
            setIsSearching(true);
            try {
                const res = await invoke<FileResult[]>("search_files", {
                    query: query.trim(),
                    searchPath: drive,
                    isRegex: reg,
                    matchCase: mc
                });
                if (currentVersion === searchVersionRef.current) setSearchResults(res);
            } catch (err) {
                console.error("搜索失败:", err);
                if (currentVersion === searchVersionRef.current) setSearchResults([]);
            } finally {
                if (currentVersion === searchVersionRef.current) setIsSearching(false);
            }
        }, 300);
    };

    const handleLocate = (path: string) => {
        invoke("open_in_explorer", { path }).catch(err => {
            console.error("打开失败:", err);
        });
    };

    const handleCopy = (item: ClipboardItem) => {
        invoke("write_to_clipboard", {
            kind: item.type === "folder" ? "file-link" : item.type,
            content: item.content
        }).catch(err => {
            console.error("复制失败:", err);
        });
    };

    const toggleExpand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // 阻止冒泡，避免触发复制
        const next = new Set(expandedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setExpandedIds(next);
    };

    const historyRef = useRef(history);
    useEffect(() => {
        historyRef.current = history;
    }, [history]);

    const saveCurrentHistory = async () => {
        const itemsToSave = historyRef.current.map(item => ({
            id: item.id,
            kind: item.type, // 转换字段名
            content: item.content
        }));
        await invoke("save_history", { history: itemsToSave });
    };

    return (
        <div className="container">
            <header className="header">
                <div className="tab-group">
                    <button
                        className={activeTab === 'trace' ? 'tab-btn active' : 'tab-btn'}
                        onClick={() => setActiveTab('trace')}
                    >
                        Trace
                    </button>
                    <button
                        className={activeTab === 'seek' ? 'tab-btn active' : 'tab-btn'}
                        onClick={() => setActiveTab('seek')}
                    >
                        Seek
                    </button>
                </div>
                <button className="settings-btn" onClick={() => setShowSettings(true)}>
                    ⚙
                </button>
            </header>

            <main className="content">
                {activeTab === "trace" && (
                    <div className="list">
                        {history.length === 0 && (
                            <div className="empty-state">暂无剪贴板历史</div>
                        )}
                        {history.map(item => {
                            const paths = item.content.split('\n').filter(p => p.trim());
                            const isMulti = paths.length > 1;
                            const isExpanded = expandedIds.has(item.id);

                            // 核心修改：判断文本是否“过长”
                            // 规则：超过300字符 OR 超过5行
                            const isLongText = item.type === "text" && (
                                item.content.length > 300 ||
                                item.content.split('\n').length > 5
                            );

                            const displayName = isMulti
                                ? `${paths[0].split(/[\\/]/).pop()} 等 ${paths.length} 个文件`
                                : paths[0].split(/[\\/]/).pop();

                            return (
                                <div key={item.id} className="card" onClick={() => handleCopy(item)}>
                                    {item.type === "text" && (
                                        <>
                                            {/* 如果是长文本且未展开，添加 text-clamped 类 */}
                                            <div className={`text-content ${isLongText && !isExpanded ? 'text-clamped' : ''}`}>
                                                {item.content}
                                            </div>
                                            {/* 仅在需要折叠时显示按钮 */}
                                            {isLongText && (
                                                <button
                                                    className="text-expand-btn"
                                                    onClick={(e) => toggleExpand(item.id, e)}
                                                >
                                                    {isExpanded ? "收起" : "展开"}
                                                </button>
                                            )}
                                        </>
                                    )}
                                    {item.type === "image" && (
                                        <img src={item.content} className="image-preview" alt="clip" />
                                    )}
                                    {item.type === "folder" && (
                                        <div className="file-content">
                                            <span className="icon">📁</span>
                                            <div className="file-info">
                                                <div className="file-name">{displayName}</div>
                                                <div className="file-path">{paths[0]}</div>
                                            </div>
                                            <button
                                                className="action-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleLocate(paths[0]);
                                                }}
                                            >
                                                定位
                                            </button>
                                        </div>
                                    )}
                                    {item.type === "file-link" && (
                                        <div className="file-content">
                                            <span
                                                className="icon"
                                                onClick={(e) => isMulti && toggleExpand(item.id, e)}
                                            >
                                                {isMulti ? (isExpanded ? "📖" : "📚") : "📄"}
                                            </span>
                                            <div className="file-info">
                                                <div className="file-name">{displayName}</div>
                                                <div className="file-path">{paths[0]}</div>
                                            </div>
                                            <button
                                                className="action-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleLocate(paths[0]);
                                                }}
                                            >
                                                定位
                                            </button>
                                        </div>
                                    )}
                                    {isExpanded && isMulti && (
                                        <div className="sub-files">
                                            {paths.map((p, i) => (
                                                <div
                                                    key={i}
                                                    className="sub-file"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleLocate(p);
                                                    }}
                                                >
                                                    {p}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {activeTab === "seek" && (
                    <div className="seek-container">
                        <div className="search-bar">
                            <select
                                className="drive-selector"
                                value={selectedDrive}
                                onChange={e => {
                                    const newDrive = e.target.value;
                                    setSelectedDrive(newDrive);
                                    executeSearch(searchQuery, newDrive, isRegex, matchCase);
                                }}
                            >
                                {drives.map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                            <input
                                className="search-input"
                                placeholder="搜索文件..."
                                value={searchQuery}
                                onChange={e => executeSearch(
                                    e.target.value,
                                    selectedDrive,
                                    isRegex,
                                    matchCase
                                )}
                            />
                            <button
                                className={matchCase ? 'filter-btn active' : 'filter-btn'}
                                onClick={() => {
                                    setMatchCase(!matchCase);
                                    executeSearch(searchQuery, selectedDrive, isRegex, !matchCase);
                                }}
                                title="区分大小写"
                            >
                                Aa
                            </button>
                            <button
                                className={isRegex ? 'filter-btn active' : 'filter-btn'}
                                onClick={() => {
                                    setIsRegex(!isRegex);
                                    executeSearch(searchQuery, selectedDrive, !isRegex, matchCase);
                                }}
                                title="正则表达式"
                            >
                                .*
                            </button>
                        </div>
                        {isSearching && <div className="progress-bar" />}
                        <div className="list">
                            {searchResults.length === 0 && searchQuery && !isSearching && (
                                <div className="empty-state">未找到匹配文件</div>
                            )}
                            {searchResults.map((file, i) => (
                                <div
                                    key={i}
                                    className="card"
                                    onClick={() => handleLocate(file.path)}
                                >
                                    <span className="icon">{file.is_dir ? "📁" : "📄"}</span>
                                    <div className="file-info">
                                        <div className="file-name">{file.name}</div>
                                        <div className="file-path">{file.path}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>

            <SettingsPanel
                visible={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
}

export default App;