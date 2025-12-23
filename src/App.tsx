import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsPanel, AppSettings } from "./Settings";
import "./App.css";

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
        invoke<AppSettings>("get_settings").then(s =>
            document.documentElement.setAttribute("data-theme", s.theme)
        );

        invoke<string[]>("get_available_drives").then(drives => {
            setDrives(drives);
            if (drives.length > 0) {
                setSelectedDrive(drives[0]);
            }
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

        return () => { unlisten.then(f => f()); };
    }, []);

    const executeSearch = (query: string, drive: string, reg: boolean, mc: boolean) => {
        // 立即更新搜索框内容
        setSearchQuery(query);

        // 取消之前的搜索
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }

        // 增加版本号，使旧的搜索结果无效
        searchVersionRef.current += 1;
        const currentVersion = searchVersionRef.current;

        // 如果查询为空，立即清空结果
        if (query.trim().length < 1) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        timerRef.current = window.setTimeout(async () => {
            // 再次检查版本，如果不匹配说明有新的搜索，放弃此次搜索
            if (currentVersion !== searchVersionRef.current) {
                return;
            }

            setIsSearching(true);
            try {
                const res = await invoke<FileResult[]>("search_files", {
                    query: query.trim(),
                    searchPath: drive,
                    isRegex: reg,
                    matchCase: mc
                });

                // 搜索完成后再次检查版本
                if (currentVersion === searchVersionRef.current) {
                    setSearchResults(res);
                }
            } catch (err) {
                console.error("搜索失败:", err);
                if (currentVersion === searchVersionRef.current) {
                    setSearchResults([]);
                }
            } finally {
                if (currentVersion === searchVersionRef.current) {
                    setIsSearching(false);
                }
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
            kind: item.type,
            content: item.content
        }).catch(err => {
            console.error("复制失败:", err);
        });
    };

    const toggleExpand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(expandedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setExpandedIds(next);
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
                            const displayName = isMulti
                                ? `${paths[0].split(/[\\/]/).pop()} 等 ${paths.length} 个文件`
                                : paths[0].split(/[\\/]/).pop();

                            return (
                                <div key={item.id} className="card" onClick={() => handleCopy(item)}>
                                    {item.type === "text" && (
                                        <div className="text-content">{item.content}</div>
                                    )}
                                    {item.type === "image" && (
                                        <img src={item.content} className="image-preview" alt="clip" />
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
                                    // 重要：传递新的盘符路径
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