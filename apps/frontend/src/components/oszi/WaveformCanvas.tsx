'use client';

import { useEffect, useRef } from 'react';

/* =========================================================================
   WaveformCanvas — Oszilloskop-Wellenform auf einem <canvas>.
   Portiert aus der Original-dashboard.html des Oszilloskop-Repos.
   ========================================================================= */

const GRID_COLOR = 'rgba(0, 180, 60, 0.18)';
const GRID_MAJOR = 'rgba(0, 200, 70, 0.28)';
const TRACE_COLOR = '#00ff44';
const TRACE_GLOW = 'rgba(0, 255, 68, 0.22)';
const H_DIVS = 10;
const V_DIVS = 8;

export function WaveformCanvas({ samples }: { samples: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = Math.max(rect.width || 600, 600);
      canvas!.height = Math.max(rect.height || 300, 300);
    }

    function drawGrid() {
      const W = canvas!.width;
      const H = canvas!.height;
      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = '#000305';
      ctx!.fillRect(0, 0, W, H);

      ctx!.strokeStyle = GRID_COLOR;
      ctx!.lineWidth = 0.5;
      for (let i = 0; i <= H_DIVS; i++) {
        const x = (W / H_DIVS) * i;
        ctx!.beginPath();
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, H);
        ctx!.stroke();
      }
      for (let j = 0; j <= V_DIVS; j++) {
        const y = (H / V_DIVS) * j;
        ctx!.beginPath();
        ctx!.moveTo(0, y);
        ctx!.lineTo(W, y);
        ctx!.stroke();
      }

      ctx!.strokeStyle = GRID_MAJOR;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.moveTo(W / 2, 0);
      ctx!.lineTo(W / 2, H);
      ctx!.stroke();
      ctx!.beginPath();
      ctx!.moveTo(0, H / 2);
      ctx!.lineTo(W, H / 2);
      ctx!.stroke();
    }

    function drawNoSignal() {
      drawGrid();
      const W = canvas!.width;
      const H = canvas!.height;
      ctx!.fillStyle = 'rgba(0, 255, 68, 0.25)';
      ctx!.font = 'bold 18px "Courier New", monospace';
      ctx!.textAlign = 'center';
      ctx!.textBaseline = 'middle';
      ctx!.fillText('KEIN SIGNAL', W / 2, H / 2);
    }

    function draw() {
      resize();
      if (!samples || samples.length === 0) {
        drawNoSignal();
        return;
      }
      drawGrid();
      const W = canvas!.width;
      const H = canvas!.height;

      let yMin = samples[0];
      let yMax = samples[0];
      for (let i = 1; i < samples.length; i++) {
        if (samples[i] < yMin) yMin = samples[i];
        if (samples[i] > yMax) yMax = samples[i];
      }
      const yRange = yMax - yMin;
      const yPad = yRange === 0 ? 1 : yRange * 0.1;
      const yLo = yMin - yPad;
      const yHi = yMax + yPad;
      const ySpan = yHi - yLo;
      const n = samples.length;

      const mapX = (idx: number) => (idx / (n - 1)) * W;
      const mapY = (v: number) => H - ((v - yLo) / ySpan) * H;

      // Glow-Durchlauf
      ctx!.beginPath();
      ctx!.moveTo(mapX(0), mapY(samples[0]));
      for (let gi = 1; gi < n; gi++) ctx!.lineTo(mapX(gi), mapY(samples[gi]));
      ctx!.strokeStyle = TRACE_GLOW;
      ctx!.lineWidth = 4;
      ctx!.lineJoin = 'round';
      ctx!.stroke();

      // Hauptlinie
      ctx!.beginPath();
      ctx!.moveTo(mapX(0), mapY(samples[0]));
      for (let mi = 1; mi < n; mi++) ctx!.lineTo(mapX(mi), mapY(samples[mi]));
      ctx!.strokeStyle = TRACE_COLOR;
      ctx!.lineWidth = 1.5;
      ctx!.lineJoin = 'round';
      ctx!.stroke();
    }

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [samples]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-[300px] w-full rounded border border-accent/20 bg-black"
    />
  );
}
