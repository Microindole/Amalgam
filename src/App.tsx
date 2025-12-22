// src/App.tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");

  async function greet() {
    // 这里调用 Rust 的 "greet" 函数
    // 这就是 TS 和 Rust 唯一的"接口"
    setGreetMsg(await invoke("greet", { name: "Amalgam User" }));
  }

  return (
    <div className="container">
      <h1>Amalgam</h1>
      
      <input 
        placeholder="Type specific command..." 
        onKeyDown={(e) => {
           if (e.key === 'Enter') greet();
        }}
      />
      
      <p>{greetMsg}</p>
    </div>
  );
}

export default App;