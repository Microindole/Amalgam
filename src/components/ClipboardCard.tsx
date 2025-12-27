import { useState } from "react";
import { ClipboardItem } from "../hooks/useClipboardHistory";

interface ClipboardCardProps {
    item: ClipboardItem;
    onCopy: (item: ClipboardItem) => void;
    onLocate: (path: string) => void;
}

export function ClipboardCard({ item, onCopy, onLocate }: ClipboardCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    const toggleExpand = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExpanded(!isExpanded);
    };

    if (item.type === "text") {
        const isLongText = item.content.length > 300 || item.content.split('\n').length > 5;

        return (
            <div className="card" onClick={() => onCopy(item)}>
                <div className={`text-content ${isLongText && !isExpanded ? 'text-clamped' : ''}`}>
                    {item.content}
                </div>
                {isLongText && (
                    <button className="text-expand-btn" onClick={toggleExpand}>
                        {isExpanded ? "收起" : "展开"}
                    </button>
                )}
            </div>
        );
    }

    if (item.type === "image") {
        return (
            <div className="card" onClick={() => onCopy(item)}>
                <img src={item.content} className="image-preview" alt="clip" />
            </div>
        );
    }

    // file-link 或 folder
    const paths = item.content.split('\n').filter(p => p.trim());
    const isMulti = paths.length > 1;
    const displayName = isMulti
        ? `${paths[0].split(/[\\/]/).pop()} 等 ${paths.length} 个文件`
        : paths[0].split(/[\\/]/).pop();

    const icon = item.type === "folder"
        ? "📁"
        : isMulti
            ? (isExpanded ? "📖" : "📚")
            : "📄";

    return (
        <div className="card" onClick={() => onCopy(item)}>
            <div className="file-content">
                <span
                    className="icon"
                    onClick={(e) => isMulti && toggleExpand(e)}
                >
                    {icon}
                </span>
                <div className="file-info">
                    <div className="file-name">{displayName}</div>
                    <div className="file-path">{paths[0]}</div>
                </div>
                <button
                    className="action-btn"
                    onClick={(e) => {
                        e.stopPropagation();
                        onLocate(paths[0]);
                    }}
                >
                    定位
                </button>
            </div>
            {isExpanded && isMulti && (
                <div className="sub-files">
                    {paths.map((p, i) => (
                        <div
                            key={i}
                            className="sub-file"
                            onClick={(e) => {
                                e.stopPropagation();
                                onLocate(p);
                            }}
                        >
                            {p}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}