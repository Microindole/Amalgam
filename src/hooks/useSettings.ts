import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { listen } from "@tauri-apps/api/event";
import { AppSettings } from "../Settings";

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

export function useSettings(onSaveHistory: () => Promise<void>) {
    useEffect(() => {
        // 加载初始主题
        invoke<AppSettings>("get_settings").then(s => {
            applyTheme(s.theme as any);
        });

        // 监听后端发来的关闭确认请求
        const unlistenPromise = listen("request-close-confirmation", async () => {
            const yes = await ask('想要保存当前的剪贴板历史以便下次使用吗？', {
                title: 'Amalgam - 保存历史',
                kind: 'info',
                okLabel: '保存并退出',
                cancelLabel: '直接退出'
            });

            if (yes) {
                try {
                    await onSaveHistory();
                } catch (e) {
                    console.error("保存历史失败:", e);
                }
            }

            // 调用后端命令真正退出
            await invoke("quit_app");
        });

        return () => {
            unlistenPromise.then(f => f());
        };
    }, [onSaveHistory]);
}