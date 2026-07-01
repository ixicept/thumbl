import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./SearchPanel.css";

interface ImageResult {
  img_src: string;
  thumbnail_src?: string;
  title: string;
}

interface SearchPanelProps {
  onImport: (path: string) => void;
}

const DEFAULT_URL = "http://localhost:8080";

function SearchThumb({
  result,
  busy,
  disabled,
  onClick,
}: {
  result: ImageResult;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const triedFallback = useRef(false);

  useEffect(() => {
    setSrc(null);
    setFailed(false);
    triedFallback.current = false;
    const thumbUrl = result.thumbnail_src ?? result.img_src;
    invoke<string>("proxy_image", { url: thumbUrl })
      .then(setSrc)
      .catch(() => tryFull());
  }, [result.thumbnail_src, result.img_src]); // eslint-disable-line react-hooks/exhaustive-deps

  function tryFull() {
    if (triedFallback.current || !result.thumbnail_src) {
      setFailed(true);
      return;
    }
    triedFallback.current = true;
    setSrc(null);
    invoke<string>("proxy_image", { url: result.img_src })
      .then(setSrc)
      .catch(() => setFailed(true));
  }

  return (
    <button
      className={`search-thumb${busy ? " search-thumb-busy" : ""}`}
      title={result.title || result.img_src}
      onClick={onClick}
      disabled={disabled}
    >
      {src ? (
        <img src={src} alt="" onError={tryFull} />
      ) : failed ? (
        <div className="search-thumb-failed">
          <span>{result.title}</span>
        </div>
      ) : (
        <div className="search-thumb-loading" />
      )}
      {busy && <span className="search-thumb-spinner">↓</span>}
    </button>
  );
}

export function SearchPanel({ onImport }: SearchPanelProps) {
  const [searxUrl, setSearxUrl] = useState(
    () => localStorage.getItem("thumbl_searxng_url") ?? DEFAULT_URL
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ImageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  function saveUrl(url: string) {
    setSearxUrl(url);
    localStorage.setItem("thumbl_searxng_url", url);
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const res = await invoke<ImageResult[]>("search_images", {
        baseUrl: searxUrl,
        query: q,
      });
      setResults(res);
      if (res.length === 0) setError("No image results found.");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function importResult(r: ImageResult) {
    if (importing) return;
    setImporting(r.img_src);
    try {
      const path = await invoke<string>("download_image_to_temp", { url: r.img_src });
      onImport(path);
    } catch (e) {
      setError(`Import failed: ${String(e)}`);
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="search-panel">
      <div className="search-url-row">
        <input
          type="text"
          className="search-url-input"
          value={searxUrl}
          onChange={(e) => saveUrl(e.target.value)}
          placeholder="SearXNG URL (e.g. http://localhost:8080)"
          spellCheck={false}
        />
      </div>

      <div className="search-query-row">
        <input
          type="text"
          className="search-query-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="Search images..."
        />
        <button
          className="search-go-btn"
          onClick={() => void search()}
          disabled={loading || !query.trim()}
        >
          {loading ? "…" : "Go"}
        </button>
      </div>

      {error && <div className="search-error">{error}</div>}

      <div className="search-results">
        {results.map((r, i) => (
          <SearchThumb
            key={i}
            result={r}
            busy={importing === r.img_src}
            disabled={importing !== null}
            onClick={() => void importResult(r)}
          />
        ))}
      </div>
    </div>
  );
}
