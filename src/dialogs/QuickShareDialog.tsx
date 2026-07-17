import "./NewCanvasDialog.css";
import "./QuickShareDialog.css";

interface QuickShareDialogProps {
  url: string;
  qrSvg: string;
  onClose: () => void;
}

export function QuickShareDialog({ url, qrSvg, onClose }: QuickShareDialogProps) {
  const qrImgSrc = `data:image/svg+xml;base64,${btoa(qrSvg)}`;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog quick-share-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Quick Share</h2>
        <p className="share-subtitle">Scan on your phone (same Wi-Fi network)</p>
        <img src={qrImgSrc} alt="QR code" className="qr-image" />
        <p className="share-url">{url}</p>
        <div className="dialog-actions">
          <button className="primary" onClick={onClose}>
            Stop Sharing
          </button>
        </div>
      </div>
    </div>
  );
}
