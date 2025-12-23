import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FileResult {
  name: string;
  path: string;
  is_dir: boolean;
}

export function SeekView() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (val: string) => {
    setQuery(val);
    if (val.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await invoke<FileResult[]>("search_files", { query: val, searchPath: "" });
      setResults(res);
    } finally {
      setLoading(false);
    }
  };

  const openFile = (path: string) => {
    invoke("open_in_explorer", { path });
  };

  return (
    <div className="seek-container">
      <div className="search-box">
        <input 
          type="text" 
          placeholder="输入文件名进行搜索..." 
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          autoFocus
        />
        {loading && <div className="spinner"></div>}
      </div>

      <div className="search-results">
        {results.map((file, idx) => (
          <div key={idx} className="search-item" onClick={() => openFile(file.path)}>
            <span className="file-icon">{file.is_dir ? "📁" : "📄"}</span>
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