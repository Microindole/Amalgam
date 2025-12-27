import { useState } from "react";
import { SettingsPanel } from "./Settings";
import { TraceView } from "./components/TraceView";
import { SeekView } from "./components/SeekView";
import { useClipboardHistory } from "./hooks/useClipboardHistory";
import { useSettings, applyTheme } from "./hooks/useSettings";
import "./App.css";

// 导出 applyTheme 供 Settings.tsx 使用
export { applyTheme };

function App() {
    const [showSettings, setShowSettings] = useState(false);
    const [activeTab, setActiveTab] = useState<"trace" | "seek">("trace");

    const { saveHistory } = useClipboardHistory();
    useSettings(saveHistory);

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
                {activeTab === "trace" && <TraceView />}
                {activeTab === "seek" && <SeekView />}
            </main>

            <SettingsPanel
                visible={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
}

export default App;