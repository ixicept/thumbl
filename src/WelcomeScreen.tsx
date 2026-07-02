import type { RecentFile } from "./project/recentFiles";
import "./WelcomeScreen.css";

interface WelcomeScreenProps {
  recentFiles: RecentFile[];
  onNewCanvas: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
}

export function WelcomeScreen({ recentFiles, onNewCanvas, onOpen, onOpenRecent }: WelcomeScreenProps) {
  return (
    <div className="welcome">
      <div className="welcome-content">
        <div className="welcome-hero">
          <h1 className="welcome-title">Thumbl</h1>
        </div>

        <div className="welcome-actions">
          <button className="welcome-btn welcome-btn-primary" onClick={onNewCanvas}>
            <span className="welcome-btn-icon">+</span>
            <span className="welcome-btn-label">New Canvas</span>
            <span className="welcome-btn-hint">Start from scratch</span>
          </button>
          <button className="welcome-btn welcome-btn-secondary" onClick={onOpen}>
            <span className="welcome-btn-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            <span className="welcome-btn-label">Open Project</span>
            <span className="welcome-btn-hint">Load a .thumbl.json file</span>
          </button>
        </div>

        {recentFiles.length > 0 && (
          <div className="welcome-recent">
            <p className="welcome-recent-heading">Recent</p>
            <ul className="welcome-recent-list">
              {recentFiles.map((f) => (
                <li key={f.path}>
                  <button className="welcome-recent-item" onClick={() => onOpenRecent(f.path)} title={f.path}>
                    <svg className="welcome-recent-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className="welcome-recent-name">{f.name}</span>
                    <span className="welcome-recent-path">{f.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="welcome-shortcuts">
          <kbd>Ctrl+N</kbd> New &nbsp;·&nbsp; <kbd>Ctrl+O</kbd> Open &nbsp;·&nbsp; <kbd>Ctrl+S</kbd> Save &nbsp;·&nbsp; <kbd>Ctrl+E</kbd> Export
        </p>
      </div>
    </div>
  );
}
