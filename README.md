# Amalgam (汞齐)

> **"TypeScript 负责灵动，Rust 负责坚固。"**
> 
> *Amalgam* 是一个基于 Tauri 的跨平台效率工具，旨在融合 Web 前端的开发效率与 Rust 后端的极致性能。

## 🛠️ Tech Stack (技术栈)

- **Core**: [Tauri v2](https://tauri.app/)
- **Backend**: Rust (Performance & System API)
- **Frontend**: TypeScript + React (UI & Interaction)
- **Style**: CSS Modules / Plain CSS (Keep it simple)

## 🚀 Features (功能规划)

该项目由两个核心模块组成，打造“第二大脑”入口：

### Phase 1: Trace (剪贴板管理)
- [ ] **后台监听**: 使用 Rust 线程静默监控系统剪贴板。
- [ ] **历史回溯**: 记录最近 50 条文本/图片历史。
- [ ] **即时回写**: 点击历史记录，自动写回剪贴板并粘贴。

### Phase 2: Seek (文件极速查找)
- [ ] **全盘索引**: 利用 Rust 的 `walkdir` 进行飞速文件扫描。
- [ ] **模糊搜索**: 支持模糊匹配文件名 (Fuzzy Matching)。
- [ ] **操作**: 选中文件直接打开或定位。

## 📦 How to Run (如何运行)

确保已安装 Node.js 和 Rust 环境。

```bash
# 1. 安装前端依赖
npm install

# 2. 启动开发模式 (Hot Reload)
# 第一次运行需要编译 Rust 依赖，耗时较长，请耐心等待
npm run tauri dev

```

## 📝 Notes (开发笔记)

* Rust 后端逻辑位于 `src-tauri/src/lib.rs`。
* 前端 UI 位于 `src/App.tsx`。
* **Don't Panic**: 遇到 Rust 报错先看编译器提示，通常它已经给出了修复建议。