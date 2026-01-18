import { useState } from "react";
import { SettingsPanel } from "./Settings";
import { TraceView } from "./components/TraceView";
import { useClipboardHistory } from "./hooks/useClipboardHistory";
import { useSettings, applyTheme } from "./hooks/useSettings";
import "./App.css";

// 导出 applyTheme 供 Settings.tsx 使用
export { applyTheme };

function App() {
    const [showSettings, setShowSettings] = useState(false);

    const { saveHistory } = useClipboardHistory();
    useSettings(saveHistory);

    return (
        <div className="container">
            <header className="header" style={{ justifyContent: 'space-between' }}>
                {/* 左侧可以直接放标题，或者未来的搜索框 */}
                <div className="app-title">
                    Trace
                </div>

                <button className="settings-btn" onClick={() => setShowSettings(true)}>
                    ⚙
                </button>
            </header>

            <main className="content">
                <TraceView />
            </main>

            <SettingsPanel
                visible={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
}

export default App;