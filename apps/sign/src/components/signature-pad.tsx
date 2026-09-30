"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

/** 手書きサイン（任意）。PNGのdata URLを返す */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={canvas}
        aria-label="手書きサインの入力欄"
        className="h-36 w-full touch-none rounded-lg bg-white ring-1 ring-slate-300"
        onPointerDown={(e) => {
          drawing.current = true;
          canvas.current!.setPointerCapture(e.pointerId);
          const ctx = canvas.current!.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (!empty || canvas.current) onChange(canvas.current!.toDataURL("image/png"));
        }}
      />
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{empty ? "枠内に指やペンでサインしてください（任意）" : "サインを入力しました"}</span>
        <Button
          type="button"
          variant="ghost"
          className="min-h-0 px-2 py-1 text-xs"
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
            onChange(null);
          }}
        >
          消す
        </Button>
      </div>
    </div>
  );
}
