import { useClipboardHistory } from "../hooks/useClipboardHistory";
import { ClipboardCard } from "./ClipboardCard";

export function TraceView() {
    const { history, copyItem, locateFile } = useClipboardHistory();

    return (
        <div className="list">
            {history.length === 0 && (
                <div className="empty-state">暂无剪贴板历史</div>
            )}
            {history.map(item => (
                <ClipboardCard
                    key={item.id}
                    item={item}
                    onCopy={copyItem}
                    onLocate={locateFile}
                />
            ))}
        </div>
    );
}