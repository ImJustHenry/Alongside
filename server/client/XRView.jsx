import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export default function XRView({ board, onTool, onUndo, onAsk, guidance }) {
  const host = useRef(null),
    runtime = useRef(null),
    callbacks = useRef({ onTool, onUndo, onAsk, guidance });
  callbacks.current = { onTool, onUndo, onAsk, guidance };
  const [supported, setSupported] = useState({ ar: false, vr: false }),
    [error, setError] = useState(""),
    [immersive, setImmersive] = useState(false);
  useEffect(() => {
    let alive = true;
    async function check() {
      if (!navigator.xr || !window.isSecureContext) return;
      const [ar, vr] = await Promise.all(
        ["immersive-ar", "immersive-vr"].map((m) =>
          navigator.xr.isSessionSupported(m).catch(() => false),
        ),
      );
      if (alive) setSupported({ ar, vr });
    }
    check();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("WebGL is unavailable. The 2D shared board still works.");
      return;
    }
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(48, 1, 0.05, 100);
    camera.position.set(0, 1.7, 1.6);
    camera.lookAt(0, 1.4, -2.2);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local-floor");
    host.current.appendChild(renderer.domElement);
    const group = new THREE.Group();
    group.position.set(0, 1.55, -2.2);
    scene.add(group);
    const texture = new THREE.CanvasTexture(board.current.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.5),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    group.add(plane);
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(2.45, 1.55, 0.035),
      new THREE.MeshBasicMaterial({ color: 0x263d35 }),
    );
    back.position.z = -0.026;
    group.add(back);
    const grid = new THREE.GridHelper(20, 40, 0xaebbb0, 0xd7ddd5);
    scene.add(grid);
    let pendingPlacement = 0;
    const placeBoard = () => {
      const head = renderer.xr.getCamera();
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
        head.quaternion,
      );
      forward.y = 0;
      if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
      forward.normalize();
      group.position.copy(head.position).addScaledVector(forward, 2.2);
      group.position.y = Math.max(1.2, head.position.y - 0.12);
      group.lookAt(head.position.x, group.position.y, head.position.z);
    };
    const buttons = [];
    const disposableTextures = [texture];
    const options = [
      ["Pen", () => callbacks.current.onTool("pen")],
      ["Move", () => callbacks.current.onTool("move")],
      ["Arrow", () => callbacks.current.onTool("arrow")],
      ["Circle", () => callbacks.current.onTool("circle")],
      ["Undo", () => callbacks.current.onUndo()],
      [
        "AI hint",
        () => callbacks.current.onAsk("Guide me through the next step."),
      ],
      ["Exit", () => renderer.xr.getSession()?.end()],
    ];
    for (let i = 0; i < options.length; i++) {
      const [label, fn] = options[i],
        c = document.createElement("canvas");
      c.width = 256;
      c.height = 100;
      const ctx = c.getContext("2d");
      ctx.fillStyle = label === "AI hint" ? "#a0609c" : "#243c34";
      ctx.fillRect(0, 0, 256, 100);
      ctx.fillStyle = "white";
      ctx.font = "32px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, 128, 62);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      disposableTextures.push(tex);
      const btn = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.117),
        new THREE.MeshBasicMaterial({ map: tex }),
      );
      btn.position.set((i - 3) * 0.34, -0.89, 0.01);
      btn.userData.click = fn;
      group.add(btn);
      buttons.push(btn);
    }
    const noteCanvas = document.createElement("canvas");
    noteCanvas.width = 1200;
    noteCanvas.height = 190;
    const noteTexture = new THREE.CanvasTexture(noteCanvas);
    noteTexture.colorSpace = THREE.SRGBColorSpace;
    disposableTextures.push(noteTexture);
    const note = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.38),
      new THREE.MeshBasicMaterial({ map: noteTexture }),
    );
    note.position.set(0, -1.18, 0.01);
    group.add(note);
    let lastNote = "";
    const ray = new THREE.Raycaster(),
      matrix = new THREE.Matrix4(),
      active = new Set();
    function intersection(controller, targets) {
      matrix.identity().extractRotation(controller.matrixWorld);
      ray.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      ray.ray.direction.set(0, 0, -1).applyMatrix4(matrix);
      return ray.intersectObjects(targets, false)[0];
    }
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(0, 0, -5),
        ]),
        new THREE.LineBasicMaterial({ color: i ? 0xda6b45 : 0x35a48b }),
      );
      controller.add(line);
      scene.add(controller);
      controller.addEventListener("selectstart", () => {
        const hit = intersection(controller, [...buttons, plane]);
        if (!hit) return;
        if (hit.object.userData.click) {
          hit.object.userData.click();
          return;
        }
        if (active.size) return;
        active.add(controller);
        board.current.begin({ x: hit.uv.x, y: 1 - hit.uv.y, p: 0.5 });
      });
      controller.addEventListener("selectend", () => {
        if (active.has(controller)) {
          active.delete(controller);
          board.current.end();
        }
      });
    }
    const observer = new ResizeObserver(() => {
      if (!host.current) return;
      const { width, height } = host.current.getBoundingClientRect();
      if (!renderer.xr.isPresenting) {
        renderer.setSize(width, Math.max(300, height));
        camera.aspect = width / Math.max(300, height);
        camera.updateProjectionMatrix();
      }
    });
    observer.observe(host.current);
    renderer.xr.addEventListener("sessionstart", () => {
      setImmersive(true);
      pendingPlacement = 2;
    });
    renderer.xr.addEventListener("sessionend", () => {
      setImmersive(false);
      scene.background = new THREE.Color("#e6ece4");
      grid.visible = true;
      active.clear();
      board.current?.end(true);
    });
    scene.background = new THREE.Color("#e6ece4");
    let lastPaint = "";
    renderer.setAnimationLoop(() => {
      if (
        renderer.xr.isPresenting &&
        pendingPlacement > 0 &&
        --pendingPlacement === 0
      )
        placeBoard();
      if (board.current?.canvas.dataset.paint !== lastPaint) {
        lastPaint = board.current?.canvas.dataset.paint;
        texture.needsUpdate = true;
      }
      for (const c of active) {
        const hit = intersection(c, [plane]);
        if (hit) board.current.move({ x: hit.uv.x, y: 1 - hit.uv.y, p: 0.5 });
      }
      const text =
        callbacks.current.guidance ||
        "Choose a tool below the board. Point and hold the trigger to draw or move tiles. AI hint requests the next step.";
      if (text !== lastNote) {
        lastNote = text;
        const ctx = noteCanvas.getContext("2d");
        ctx.fillStyle = "#243c34";
        ctx.fillRect(0, 0, 1200, 190);
        ctx.fillStyle = "#f7f6ed";
        ctx.font = "28px sans-serif";
        const words = text.slice(0, 430).split(" ");
        let line = "",
          y = 45;
        for (const word of words) {
          if (ctx.measureText(line + word).width > 1100) {
            ctx.fillText(line, 35, y);
            line = "";
            y += 38;
            if (y > 165) break;
          }
          line += word + " ";
        }
        if (y <= 165) ctx.fillText(line, 35, y);
        noteTexture.needsUpdate = true;
      }
      renderer.render(scene, camera);
    });
    runtime.current = { renderer, scene, grid };
    return () => {
      renderer.xr
        .getSession()
        ?.end()
        .catch(() => {});
      observer.disconnect();
      renderer.setAnimationLoop(null);
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      disposableTextures.forEach((t) => t.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  async function enter(mode) {
    setError("");
    try {
      const r = runtime.current;
      if (!r) throw new Error("Renderer not ready");
      const session = await navigator.xr.requestSession(mode, {
        optionalFeatures: ["local-floor", "hand-tracking"],
      });
      r.scene.background =
        mode === "immersive-ar" ? null : new THREE.Color("#e6ece4");
      r.grid.visible = mode !== "immersive-ar";
      await r.renderer.xr.setSession(session);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="xr-wrap">
      <div className="xr-render" ref={host} />
      <div className="xr-actions">
        <span>
          {immersive
            ? "Immersive session active"
            : "3D preview · same live board"}
        </span>
        <button disabled={!supported.ar} onClick={() => enter("immersive-ar")}>
          Enter mixed reality
        </button>
        <button disabled={!supported.vr} onClick={() => enter("immersive-vr")}>
          Enter VR
        </button>
      </div>
      {!supported.ar && !supported.vr && (
        <p className="xr-note">
          Immersive mode requires a supported headset browser over trusted
          HTTPS. This desktop 3D view is not a headset test.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
