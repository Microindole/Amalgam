import { useFileSearch } from "../hooks/useFileSearch";

export function SeekView() {
    const {
        searchQuery,
        searchResults,
        isSearching,
        drives,
        selectedDrive,
        isRegex,
        matchCase,
        setSelectedDrive,
        setIsRegex,
        setMatchCase,
        executeSearch,
        handleLocate
    } = useFileSearch();

    return (
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
    );
}