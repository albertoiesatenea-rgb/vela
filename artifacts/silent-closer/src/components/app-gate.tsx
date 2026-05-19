import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "vela_gate_auth";
const CORRECT_PIN = import.meta.env.VITE_APP_PIN ?? "vela2025";

export function AppGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput]       = useState("");
  const [shake, setShake]       = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === CORRECT_PIN) {
        setUnlocked(true);
      }
    } catch { /* localStorage blocked (e.g. private mode) — require pin each time */ }
  }, []);

  useEffect(() => {
    if (!unlocked) setTimeout(() => inputRef.current?.focus(), 100);
  }, [unlocked]);

  const attempt = () => {
    if (input === CORRECT_PIN) {
      try { localStorage.setItem(STORAGE_KEY, CORRECT_PIN); } catch { /* ignore */ }
      setUnlocked(true);
    } else {
      setShake(true);
      setInput("");
      setTimeout(() => setShake(false), 500);
    }
  };

  if (unlocked) return <>{children}</>;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className={`flex flex-col items-center gap-6 transition-transform ${shake ? "animate-shake" : ""}`}>
        <div className="flex flex-col items-center gap-1">
          <span className="text-[9px] font-mono tracking-[0.3em] uppercase text-zinc-600">VELA</span>
          <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-zinc-700">acceso restringido</span>
        </div>

        <input
          ref={inputRef}
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && attempt()}
          placeholder="·····"
          autoComplete="off"
          className="w-40 bg-transparent border-b border-zinc-800 text-center text-white font-mono text-sm tracking-[0.4em] py-2 outline-none placeholder:text-zinc-700 focus:border-zinc-600 transition-colors"
        />

        <button
          onClick={attempt}
          className="text-[9px] font-mono tracking-[0.25em] uppercase text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          entrar →
        </button>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-8px); }
          40%      { transform: translateX(8px); }
          60%      { transform: translateX(-6px); }
          80%      { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.45s ease; }
      `}</style>
    </div>
  );
}
