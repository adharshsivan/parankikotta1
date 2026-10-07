import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { mountFortScene, type FortController, type FortHud, type FortMode } from "./fortScene";

const INITIAL_HUD: FortHud = {
  location: "Coast path",
  elevation: 0,
  x: -1.5,
  z: 35,
};

function FortMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M7 31V17l6-5 7 4 7-6 6 5v16H7Z" />
      <path d="M13 31V21h5v10m7 0V20h5v11M4 34h32" />
      <path d="M3 8c4-2 7-2 11 0s7 2 11 0 7-2 12 0" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 10h12m-5-5 5 5-5 5" />
    </svg>
  );
}

function WalkPad({ controller }: { controller: RefObject<FortController | null> }) {
  const start = (side: number, forward: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    controller.current?.setTouchMove(side, forward);
  };
  const stop = () => controller.current?.setTouchMove(0, 0);

  return (
    <div className="walk-pad" aria-label="Movement controls">
      <button
        className="pad-key pad-up"
        aria-label="Move forward"
        onPointerDown={start(0, 1)}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
      >
        <span />
      </button>
      <button
        className="pad-key pad-left"
        aria-label="Move left"
        onPointerDown={start(-1, 0)}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
      >
        <span />
      </button>
      <button
        className="pad-key pad-right"
        aria-label="Move right"
        onPointerDown={start(1, 0)}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
      >
        <span />
      </button>
      <button
        className="pad-key pad-down"
        aria-label="Move backward"
        onPointerDown={start(0, -1)}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
      >
        <span />
      </button>
    </div>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<FortController | null>(null);
  const [mode, setMode] = useState<FortMode>("overview");
  const [hud, setHud] = useState<FortHud>(INITIAL_HUD);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = mountFortScene(canvas, setHud);
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setMode(mode);
  }, [mode]);

  const isWalking = mode === "walk";
  const toggleMode = () => setMode((current) => (current === "overview" ? "walk" : "overview"));

  return (
    <main className={`game-shell${isWalking ? " is-walking" : ""}`}>
      <canvas ref={canvasRef} className="fort-canvas" aria-label="Interactive 3D view of Paranki Kotta fort" />
      <div className="scene-shade" aria-hidden="true" />

      <header className="topbar">
        <div className="brand-lockup" aria-label="Lokam Mini">
          <span className="brand-mark"><FortMark /></span>
          <span className="brand-type">
            <strong>LOKAM</strong>
            <small>MINI WORLDS</small>
          </span>
        </div>
        <span className="topbar-rule" />
        <div className="world-crumb">
          <span>WORLD ATLAS</span>
          <strong>AAZHI <i>/</i> COAST</strong>
        </div>

        <div className="topbar-actions">
          <div className="location-readout" aria-live="polite">
            <span className="readout-light" />
            <div>
              <small>{isWalking ? "YOU ARE IN" : "LIVE LOCATION"}</small>
              <strong>{isWalking ? hud.location : "PARANKI KOTTA"}</strong>
            </div>
            <span className="readout-height">+{Math.max(0, hud.elevation).toFixed(1)} <i>M</i></span>
          </div>
          <button className="mode-switch" onClick={toggleMode}>
            <span className="mode-switch-icon" aria-hidden="true">{isWalking ? "01" : "02"}</span>
            <span>{isWalking ? "FORT OVERVIEW" : "WALK THE FORT"}</span>
            <ArrowIcon />
          </button>
        </div>
      </header>

      <section className="hero-copy" aria-labelledby="fort-title">
        <div className="hero-kicker">
          <span>THE AAZHI COAST</span>
          <i />
          <span>FIELD SITE 04</span>
        </div>
        <h1 id="fort-title">Paranki <em>Kotta</em></h1>
        <p className="hero-description">
          The landward walls still stand. The seaward half fell centuries ago, and is now footings, rubble and moss above the old ditch.
        </p>
        <div className="hero-actions">
          <button className="enter-button" onClick={() => setMode("walk")}>
            <span>{isWalking ? "CONTINUE EXPLORING" : "ENTER THE FORT"}</span>
            <ArrowIcon />
          </button>
          <p className="site-scale"><strong>c. 1664</strong><span />SEAWARD HALF IN RUIN <i>/</i> MOATED</p>
        </div>
      </section>

      <div className="route-note" aria-label="Suggested exploration route">
        <span className="route-eyebrow">A WALK THROUGH THE FORT</span>
        <div className="route-sequence">
          <span>BRIDGE</span><i /><span>GATE</span><i /><span>RAMPART</span><i /><span>SLOPE</span><i /><span>RUINS</span>
        </div>
      </div>

      <div className="control-guide" aria-live="polite">
        {isWalking ? (
          <>
            <span className="key-hint">W A S D</span><span>WALK</span><b />
            <span className="mouse-hint"><i /></span><span>DRAG TO LOOK</span><b />
            <span className="scroll-hint"><i /></span><span>ZOOM</span>
          </>
        ) : (
          <>
            <span className="mouse-hint"><i /></span><span>DRAG TO ORBIT</span><b />
            <span className="scroll-hint"><i /></span><span>SCROLL TO INSPECT</span>
          </>
        )}
      </div>

      {isWalking && <WalkPad controller={controllerRef} />}

      <div className="edge-mark edge-mark-left" aria-hidden="true">17.31 N <span>/</span> 76.14 E</div>
      <div className="edge-mark edge-mark-right" aria-hidden="true">A HISTORIC PLACE, MADE PLAYABLE <span>/</span> LOKAM MINI</div>
    </main>
  );
}