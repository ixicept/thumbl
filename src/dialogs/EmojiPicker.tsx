import { useMemo, useState } from "react";
import "./NewCanvasDialog.css";
import "./EmojiPicker.css";

const CATEGORIES: { name: string; emojis: string[] }[] = [
  {
    name: "Smileys",
    emojis: [
      "😀","😁","😂","🤣","😃","😄","😅","😆","😇","😈",
      "😉","😊","😋","😍","🤩","😎","🤔","🤨","😐","😑",
      "😒","😓","😔","😕","🙃","😤","😠","😡","🤬","😈",
      "💀","☠️","😱","😨","😰","😥","😢","😭","😩","😫",
      "🥱","😴","🤤","🥳","🤑","🤗","🤭","🫡","🥹","😶",
      "🤐","🤧","🤒","🤕","🤢","🤮","😷","🥴","😵","💫",
    ],
  },
  {
    name: "Gestures",
    emojis: [
      "👍","👎","👋","🤚","✋","🖐️","☝️","👆","👇","👈",
      "👉","✌️","🤞","🤟","🤘","🤙","💪","🦾","🙌","👏",
      "🫶","🤝","🙏","✊","👊","🤛","🤜","🫵","👌","🤌",
      "💅","🫰","👁️","👅","💋","🧠","❤️","🔥","💯","⭐",
    ],
  },
  {
    name: "Hearts",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔",
      "❤️‍🔥","❤️‍🩹","💕","💞","💓","💗","💖","💘","💝","💟",
      "♥️","🫀","💌","💋","💑","👫","👬","👭",
    ],
  },
  {
    name: "People",
    emojis: [
      "👶","🧒","👦","👧","🧑","👱","👨","🧔","🧓","👴",
      "👵","👲","👳","🧕","👼","🎅","🤶","🧙","🧝","🧛",
      "🧟","🧞","🧜","🧚","🧑‍🦰","🧑‍🦱","🧑‍🦳","🧑‍🦲","💁","🙋",
      "🤦","🤷","💆","💇","🧖","🧗","🚴","🤸","🏋️","🤺",
    ],
  },
  {
    name: "Animals",
    emojis: [
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯",
      "🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐔","🐧",
      "🦅","🦉","🐺","🦋","🐝","🐛","🦀","🐬","🐳","🦈",
      "🦖","🦕","🐉","🐲","🌵","🌴","🌳","🌺","🌸","🌈",
    ],
  },
  {
    name: "Food",
    emojis: [
      "🍎","🍊","🍋","🍌","🍍","🍓","🍇","🍉","🍑","🍒",
      "🥑","🍆","🥕","🌽","🍕","🍔","🌮","🍜","🍣","🍩",
      "🍰","🎂","🧁","🍫","🍬","🍭","🧃","☕","🧋","🍺",
    ],
  },
  {
    name: "Objects",
    emojis: [
      "🔥","💯","✨","🌟","⭐","💎","👑","🏆","🥇","🎯",
      "🎉","🎊","🎁","🎀","🎵","🎶","🎸","🎹","🥁","🎺",
      "📱","💻","📷","🎥","📺","🔑","🗝️","🔒","🔓","🔔",
      "💡","🔦","🕯️","💰","💵","💳","📚","📖","✏️","🖊️",
      "🔭","🔬","💊","🩺","🩹","⚔️","🛡️","🪄","🎩","👓",
    ],
  },
  {
    name: "Symbols",
    emojis: [
      "✅","❌","❎","⚠️","🚫","🔞","💠","🔷","🔹","🔶",
      "🔸","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤",
      "🔺","🔻","♻️","💲","💱","™️","®️","©️","🅰️","🅱️",
      "🆗","🆕","🆙","🆒","🆓","🔝","🔄","🔃","⬆️","⬇️",
      "⬅️","➡️","↗️","↘️","↙️","↖️","↕️","↔️","🔁","🔀",
      "▶️","⏸️","⏹️","⏺️","⏭️","⏮️","⏩","⏪","🎦","🔊",
    ],
  },
];

function emojiToTwemojiUrl(emoji: string): string {
  const cps = [...emoji]
    .map((ch) => ch.codePointAt(0)!.toString(16).toLowerCase())
    .filter((cp) => cp !== "fe0f");
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${cps.join("-")}.png`;
}

interface EmojiPickerProps {
  onPick: (emoji: string, twemojiUrl: string) => void;
  onCancel: () => void;
}

export function EmojiPicker({ onPick, onCancel }: EmojiPickerProps) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    return CATEGORIES.flatMap((c) => c.emojis).filter((e) => {
      try {
        return [...e].some((ch) => {
          const cp = ch.codePointAt(0)?.toString(16);
          return cp?.includes(q);
        }) || e.includes(q);
      } catch {
        return false;
      }
    });
  }, [search]);

  const displayed = filtered ?? CATEGORIES[activeCategory].emojis;

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="emoji-picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="emoji-picker-search-row">
          <input
            className="emoji-picker-search"
            type="text"
            placeholder="Search emoji..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {!search && (
          <div className="emoji-picker-cats">
            {CATEGORIES.map((cat, i) => (
              <button
                key={cat.name}
                className={`emoji-picker-cat${i === activeCategory ? " active" : ""}`}
                onClick={() => setActiveCategory(i)}
                title={cat.name}
              >
                {cat.emojis[0]}
              </button>
            ))}
          </div>
        )}

        <div className="emoji-picker-grid">
          {displayed.map((emoji) => (
            <button
              key={emoji}
              className="emoji-picker-btn"
              title={emoji}
              onClick={() => onPick(emoji, emojiToTwemojiUrl(emoji))}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
