import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface FileResult {
    name: string;
    path: string;
    is_dir: boolean;
}

export function useFileSearch() {
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
        invoke<string[]>("get_available_drives").then(drives => {
            setDrives(drives);
            if (drives.length > 0) setSelectedDrive(drives[0]);
        });
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

    return {
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
    };
}