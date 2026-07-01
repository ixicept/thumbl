import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchPanel } from "./SearchPanel";
import "./BrowserPanel.css";

interface BrowserPanelProps {
  onImport: (path: string) => void;
}

const DEFAULT_URL = "http://localhost:8080";
const URL_KEY = "thumbl_browser_url";

function IframeBrowser({ onImport }: { onImport: (path: string) => void }) {
  const [src, setSrc] = useState(() => localStorage.getItem(URL_KEY) ?? DEFAULT_URL);
  const [bar, setBar] = useState(src);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  function navigate(url: string) {
    const full = url.startsWith("http") ? url : `http://${url}`;
    setSrc(full);
    setBar(full);
    localStorage.setItem(URL_KEY, full);
  }

  function refresh() {
    if (iframeRef.current) iframeRef.current.src = src;
  }

  async function importUrl() {
    const url = bar.trim();
    if (!url) return;
    try {
      const path = await invoke<string>("download_image_to_temp", { url });
      onImport(path);
    } catch (e) {
      console.error("Import failed:", e);
    }
  }

  return (
    <>
      <div className="browser-toolbar">
        <button className="browser-btn" title="Refresh" onClick={refresh}>↺</button>
        <input
          className="browser-address"
          type="text"
          value={bar}
          onChange={(e) => setBar(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate(bar)}
          spellCheck={false}
        />
        <button className="browser-btn" onClick={() => navigate(bar)}>Go</button>
        <button
          className="browser-btn browser-import-btn"
          title="Download URL as image layer"
          onClick={() => void importUrl()}
        >
          + Layer
        </button>
      </div>
      <iframe
        ref={iframeRef}
        className="browser-iframe"
        src={src}
        title="Browser"
        allow="*"
      />
    </>
  );
}

export function BrowserPanel({ onImport }: BrowserPanelProps) {
  const [tab, setTab] = useState<"search" | "browser">("search");

  return (
    <div className="browser-panel">
      <div className="browser-panel-tabs">
        <button
          className={`browser-panel-tab${tab === "search" ? " browser-panel-tab-active" : ""}`}
          onClick={() => setTab("search")}
        >
          Search
        </button>
        <button
          className={`browser-panel-tab${tab === "browser" ? " browser-panel-tab-active" : ""}`}
          onClick={() => setTab("browser")}
        >
          Browser
        </button>
      </div>

      {tab === "search" ? (
        <SearchPanel onImport={onImport} />
      ) : (
        <IframeBrowser onImport={onImport} />
      )}
    </div>
  );
}
