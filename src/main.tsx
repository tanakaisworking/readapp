import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { Companion } from "@/views/companion";
import { startAppearanceSync } from "@/lib/appearance";
import "./index.css";

// 描く前に見た目を当てる (保存した色が一瞬だけ元に戻って見えないように)
startAppearanceSync();

// 同じ画面一式を2つのウィンドウで使い、ウィンドウ名で中身を切り替える (小窓 / 設定)。
const isCompanion = getCurrentWindow().label === "companion";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isCompanion ? <Companion /> : <App />}</React.StrictMode>,
);
