# Amalgam (汞齐)

> **"TypeScript 负责灵动，Rust 负责坚固。"**
> 
> *Amalgam* 是一个基于 Tauri 的跨平台效率工具，旨在融合 Web 前端的开发效率与 Rust 后端的极致性能。

## 🛠️ Tech Stack

- **Core**: [Tauri v2](https://tauri.app/)
- **Backend**: Rust (Performance & System API)
- **Frontend**: TypeScript + React (UI & Interaction)
- **Style**: CSS Modules / Plain CSS (Keep it simple)

## 🚀 Features

- [ ] **后台监听**: 使用 Rust 线程静默监控系统剪贴板。
- [ ] **历史回溯**: 记录最近 50 条文本/图片历史。
- [ ] **即时回写**: 点击历史记录，自动写回剪贴板并粘贴。

## 📦 How to Run

确保已安装 Node.js 和 Rust 环境。

```bash
# 1. 安装前端依赖
npm install

# 2. 生成对应图标
npm run tauri icon ./logo.svg

# 3. 启动开发模式 (Hot Reload)
# 第一次运行需要编译 Rust 依赖，耗时较长，请耐心等待
npm run tauri dev

```

## 📝 Notes

* Rust 后端逻辑位于 `src-tauri/src/lib.rs`。
* 前端 UI 位于 `src/App.tsx`。
* **Don't Panic**: 遇到 Rust 报错先看编译器提示，通常它已经给出了修复建议。