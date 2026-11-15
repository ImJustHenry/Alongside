using System;
using System.Collections.Generic;
using UnityEngine;
namespace Alongside {
// Headset control HUD. Replaces the big shared canvas as the default view on the Quest:
// a small world-locked panel the wearer can drag anywhere convenient. It holds the LiveView controls,
// ink colours and a status line, and collapses to a single "Alongside" pill. The shared board is still
// there ("Board" button) but hidden by default.
public class ControlHud : MonoBehaviour {
 public const float Scale = .2f;              // HUD local units -> metres
 // Where it first appears (and where "Bring here" puts it): low and to the left, tilted up toward the face.
 public float distance = .5f, drop = .29f, side = -.2f;
 public bool Minimized { get; private set; }
 public bool BoardVisible { get; private set; }
 public bool Dragging => dragPointer >= 0;

 BoardController board; Transform head, content, pill; Transform liveRow; TextMesh title;
 public ShizukuCompanion Shizuku { get; private set; }
 BoardButton boardButton, minimizeButton, pillButton, handle, shizukuButton; readonly Dictionary<string, BoardButton> swatches = new Dictionary<string, BoardButton>();
 bool placed; float placeAfter; int dragPointer = -1; float dragDistance; Vector3 dragLocalGrab;

 public static ControlHud Create(BoardController board, Transform liveViewRow) {
  var hud = new GameObject("Alongside HUD").AddComponent<ControlHud>();
  hud.board = board; hud.head = board.rig.head.transform; hud.liveRow = liveViewRow; hud.Build(); return hud;
 }

 void Build() {
  transform.localScale = Vector3.one * Scale;
  content = new GameObject("HUD content").transform; content.SetParent(transform, false);
  var mat = board.uiMaterial;
  // Row 1 (top): the LiveView buttons + status label, moved here from above the board.
  liveRow.SetParent(content, false); liveRow.localPosition = new Vector3(0, .12f, 0); liveRow.localRotation = Quaternion.identity; liveRow.localScale = Vector3.one;
  // Row 2: ink colours, show/hide shared board, bring here, minimize.
  var row = new GameObject("HUD row").transform; row.SetParent(content, false); row.localPosition = new Vector3(0, -.02f, 0);
  float x = -1.02f;
  foreach (var c in Model.Colors) {
   if (swatches.Count >= 5) break; var col = c;
   var b = BoardButton.Create(row, "", new Vector3(x, 0, 0), new Vector2(.11f, .10f), mat, () => { board.SetColor(col); Refresh(); });
   b.swatch = Model.ParseColor(col); b.SetActive(true); b.SetActive(false); swatches[col] = b; x += .13f;
  }
  x += .06f;
  boardButton = BoardButton.Create(row, "Board: off", new Vector3(x + .1f, 0, 0), new Vector2(.25f, .10f), mat, () => SetBoard(!BoardVisible), .030f); x += .29f;
  BoardButton.Create(row, "Bring here", new Vector3(x + .1f, 0, 0), new Vector2(.25f, .10f), mat, () => { PlaceInFront(); if (BoardVisible) board.rig.Recenter(); }, .030f); x += .29f;
  minimizeButton = BoardButton.Create(row, "Minimize", new Vector3(x + .1f, 0, 0), new Vector2(.25f, .10f), mat, () => SetMinimized(true), .030f); x += .29f;
  // Shizuku voice companion floats beside the HUD; off by default so the mic only listens when the wearer opts in.
  Shizuku = ShizukuCompanion.Create(board, transform);
  shizukuButton = BoardButton.Create(row, "GPT: off", new Vector3(x + .1f, 0, 0), new Vector2(.25f, .10f), mat, () => { Shizuku.SetEnabled(!Shizuku.Enabled); shizukuButton.Label = Shizuku.Enabled ? "GPT: on" : "GPT: off"; shizukuButton.SetActive(Shizuku.Enabled); }, .030f); x += .29f;
  // Stream orientation for the iPad view: cycles flip / rotate-180 combinations (remembered). Fix an upside-down iPad view in 1-3 taps.
  var cam = board.GetComponent<LiveViewController>()?.cameraSource;
  BoardButton viewButton = null;
  viewButton = BoardButton.Create(row, "View " + ((cam != null ? cam.ViewMode : 0) + 1) + "/4", new Vector3(x + .1f, 0, 0), new Vector2(.25f, .10f), mat, () => { if (cam == null) return; viewButton.Label = "View " + (cam.CycleView() + 1) + "/4"; }, .030f);
  title = Draw.Text(content, "HUD title", "ALONGSIDE", new Vector3(-1.15f, .5f, 0), .045f, Model.ParseColor(Model.Ink), TextAnchor.MiddleLeft);
  // Drag handle across the top. It's a BoardButton so pinching on it never starts air ink (LiveView's menu block).
  handle = BoardButton.Create(content, "=  Drag here to move  =", new Vector3(.3f, .5f, 0), new Vector2(1.5f, .09f), mat, null, .030f);
  // Backing plate: readable over passthrough, and its collider stops surface ink from passing through the HUD.
  var plate = GameObject.CreatePrimitive(PrimitiveType.Quad); plate.name = "HUD plate"; plate.transform.SetParent(content, false);
  plate.transform.localPosition = new Vector3(.1f, .22f, .015f); plate.transform.localScale = new Vector3(2.7f, .7f, 1);
  plate.GetComponent<Renderer>().sharedMaterial = new Material(Shader.Find("Sprites/Default")) { color = new Color(.96f, .95f, .91f, .82f) };
  // Minimized pill (stays where the HUD was).
  pill = new GameObject("HUD pill").transform; pill.SetParent(transform, false);
  pillButton = BoardButton.Create(pill, "Alongside  +", Vector3.zero, new Vector2(.42f, .12f), mat, () => SetMinimized(false), .036f);
  SetBoard(false); SetMinimized(false); Refresh();
  placeAfter = Time.realtimeSinceStartup + .5f; // let head tracking settle before the first placement
 }

 // The Board GameObject also carries BoardController, PointerInput and LiveViewController, so never
 // deactivate it: hide only its visual children (canvas, toolbar, side panel, board collider).
 readonly List<GameObject> boardVisuals = new List<GameObject>();
 public void SetBoard(bool on) {
  BoardVisible = on;
  if (boardVisuals.Count == 0) foreach (Transform t in board.view.transform) if (!t.name.StartsWith("Laser") && t != liveRow) boardVisuals.Add(t.gameObject);
  foreach (var g in boardVisuals) if (g) g.SetActive(on);
  if (on) board.rig.Recenter();
  if (boardButton != null) { boardButton.Label = on ? "Board: on" : "Board: off"; boardButton.SetActive(on); }
 }

 public void SetMinimized(bool on) { Minimized = on; content.gameObject.SetActive(!on); pill.gameObject.SetActive(on); dragPointer = -1; }

 // Puts the HUD low and to the left of where the wearer is looking, facing them.
 public void PlaceInFront() {
  var f = head.forward; f.y = 0; if (f.sqrMagnitude < 1e-4f) f = Vector3.forward; f.Normalize();
  var right = Vector3.Cross(Vector3.up, f);
  var pos = head.position + f * distance + right * side + Vector3.down * drop;
  transform.SetPositionAndRotation(pos, FaceHead(pos)); placed = true;
 }

 public const float ReturnDistance = 3f;
 bool stickWas;
 static bool StickClick(UnityEngine.XR.XRNode node) { var d = UnityEngine.XR.InputDevices.GetDeviceAtXRNode(node); return d.isValid && d.TryGetFeatureValue(UnityEngine.XR.CommonUsages.primary2DAxisClick, out bool c) && c; }
 static bool HeadTracked() {
  if (!PointerInput.XRActive) return true; // desktop / editor
  var dev = UnityEngine.XR.InputDevices.GetDeviceAtXRNode(UnityEngine.XR.XRNode.CenterEye);
  if (!dev.isValid) dev = UnityEngine.XR.InputDevices.GetDeviceAtXRNode(UnityEngine.XR.XRNode.Head);
  return dev.isValid && dev.TryGetFeatureValue(UnityEngine.XR.CommonUsages.isTracked, out bool t) && t
      && dev.TryGetFeatureValue(UnityEngine.XR.CommonUsages.devicePosition, out var p) && p.sqrMagnitude > 1e-4f;
 }

 Quaternion FaceHead(Vector3 pos) { var look = pos - head.position; return look.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(look.normalized, Vector3.up) : transform.rotation; }

 void Refresh() { foreach (var kv in swatches) kv.Value.SetActive(kv.Key == board.InkColor); }

 void LateUpdate() {
  if (head == null) return;
  Refresh();
  // First placement waits until the headset reports a tracked head pose (early frames sit at the tracking origin,
  // which put the HUD on the floor / behind the wearer in 0.1.8), then a short settle delay.
  if (!placed) {
   if (!HeadTracked()) { placeAfter = Time.realtimeSinceStartup + 1f; return; }
   if (Time.realtimeSinceStartup >= placeAfter) PlaceInFront();
   return;
  }
  // Safety net: if the HUD ends up out of reach (walked away, or a bad first pose), bring it back.
  if (dragPointer < 0 && Vector3.Distance(transform.position, head.position) > ReturnDistance) PlaceInFront();
  // Summon: press either thumbstick in to bring the HUD in front of you (and un-minimize it).
  bool stick = StickClick(UnityEngine.XR.XRNode.LeftHand) || StickClick(UnityEngine.XR.XRNode.RightHand);
  if (stick && !stickWas) { SetMinimized(false); PlaceInFront(); }
  stickWas = stick;
  var input = board.input; if (input == null) return;
  // Grab: trigger or pinch while pointing at the handle.
  if (dragPointer < 0 && !Minimized) foreach (var p in input.Pointers) {
   if (!p.down || !Physics.Raycast(p.ray, out var hit, 10f) || hit.collider.GetComponentInParent<BoardButton>() != handle) continue;
   dragPointer = p.id; dragDistance = hit.distance; dragLocalGrab = transform.InverseTransformPoint(hit.point); handle.SetActive(true); break;
  }
  if (dragPointer < 0) return;
  // Drag: keep the grabbed point at the same distance along the pointer ray; keep facing the wearer.
  bool found = false;
  foreach (var p in input.Pointers) {
   if (p.id != dragPointer) continue; found = p.held; if (!found) break;
   var grabWorld = p.ray.GetPoint(dragDistance);
   var rot = FaceHead(grabWorld);
   var pos = grabWorld - rot * Vector3.Scale(dragLocalGrab, transform.localScale);
   transform.SetPositionAndRotation(pos, FaceHead(pos));
   break;
  }
  if (!found) { dragPointer = -1; handle.SetActive(false); }
 }
}
}
