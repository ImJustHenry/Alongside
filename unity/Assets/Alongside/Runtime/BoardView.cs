// Alongside for Unity — renders the shared learning canvas as a world-positioned 2D board (2.4 m × 1.5 m).
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Alongside
{
    public class BoardView : MonoBehaviour
    {
        public const float W = 2.4f, H = 1.5f;
        const float PX = W / 900f, PY = H / 560f; // web canvas pixel → metres

        [Tooltip("Unlit vertex-color material (Sprites/Default). Assigned by Alongside > Build Scene.")]
        public Material baseMaterial;
        public bool showAILayer = true;

        public BoxCollider Surface { get; private set; }

        MeshBuilder mb = new MeshBuilder();
        MeshFilter staticMesh, dynamicMesh, annotationMesh, draftMesh, cursorMesh;
        readonly Dictionary<string, MeshFilter> previews = new Dictionary<string, MeshFilter>();
        readonly Dictionary<string, Annotation> previewData = new Dictionary<string, Annotation>();
        readonly Dictionary<string, (Member member, BPoint p, float time, TextMesh label)> cursors = new Dictionary<string, (Member, BPoint, float, TextMesh)>();
        readonly List<TextMesh> labelPool = new List<TextMesh>();
        readonly Dictionary<string, (TextMesh glyph, TextMesh label, TextMesh check, TextMesh targetLabel)> tileText = new Dictionary<string, (TextMesh, TextMesh, TextMesh, TextMesh)>();
        TextMesh footer, titleText;
        Transform layers;
        bool built;

        BoardState lastState;
        IList<BoardObject> lastObjects;

        static readonly Color Paper = Model.ParseColor("#fbfaf5"), Dot = Model.ParseColor("#d5dacd"), Border = Model.ParseColor("#d3dcc8");
        static readonly Color Muted = Model.ParseColor("#73856c"), Ink = Model.ParseColor(Model.Ink), Outline = Model.ParseColor("#aeba9f"), TrayLine = Model.ParseColor("#e0e5d8");

        public Vector3 Local(BPoint p, float z = 0) => new Vector3((p.x - 0.5f) * W, (0.5f - p.y) * H, z);
        Vector2 L2(BPoint p) => new Vector2((p.x - 0.5f) * W, (0.5f - p.y) * H);
        Vector2 L2(float x, float y) => new Vector2((x - 0.5f) * W, (0.5f - y) * H);

        public bool TryHit(Ray ray, out BPoint p, out float distance)
        {
            Build();
            p = default; distance = 0;
            if (!Surface.Raycast(ray, out var hit, 50f)) return false;
            var l = transform.InverseTransformPoint(hit.point);
            p = new BPoint(Mathf.Clamp01(l.x / W + 0.5f), Mathf.Clamp01(0.5f - l.y / H));
            distance = hit.distance;
            return true;
        }

        public void Build()
        {
            if (built) return;
            built = true;
            if (baseMaterial == null) baseMaterial = new Material(Shader.Find("Sprites/Default"));
            layers = new GameObject("Layers").transform;
            layers.SetParent(transform, false);

            var col = new GameObject("Surface");
            col.transform.SetParent(transform, false);
            Surface = col.AddComponent<BoxCollider>();
            Surface.size = new Vector3(W, H, 0.02f);

            staticMesh = Draw.MeshObject(layers, "Canvas", baseMaterial, 3000).Item1;
            dynamicMesh = Draw.MeshObject(layers, "Tiles", baseMaterial, 3001).Item1;
            annotationMesh = Draw.MeshObject(layers, "Annotations", baseMaterial, 3003).Item1;
            draftMesh = Draw.MeshObject(layers, "Draft", baseMaterial, 3005).Item1;
            cursorMesh = Draw.MeshObject(layers, "Cursors", baseMaterial, 3006).Item1;

            // static canvas: paper, dots, header, tray line
            mb.Clear();
            mb.RoundedRect(Vector2.zero, new Vector2(W + 0.03f, H + 0.03f), 0.035f, Border, 0.001f);
            mb.RoundedRect(Vector2.zero, new Vector2(W, H), 0.03f, Paper, 0);
            for (float y = 12; y < 560; y += 24)
                for (float x = 12; x < 900; x += 24)
                    mb.Disc(L2(x / 900f, y / 560f), 0.8f * PX * 1.4f, Dot, -0.0005f, 5);
            mb.Segment(L2(35 / 900f, 370 / 560f), L2(865 / 900f, 370 / 560f), 1.2f * PY, TrayLine, -0.001f);
            mb.Apply(staticMesh.sharedMesh);

            var header = new GameObject("Header").transform;
            header.SetParent(layers, false);
            Draw.Text(header, "Kicker", "SHARED LEARNING CANVAS", Local(new BPoint(35 / 900f, 30 / 560f), -0.002f), 13 * PY, Muted, TextAnchor.MiddleLeft, 3002);
            titleText = Draw.Text(header, "Title", "A little guidance. A shared understanding.", Local(new BPoint(35 / 900f, 62 / 560f), -0.002f), 26 * PY, Ink, TextAnchor.MiddleLeft, 3002);
            Draw.Text(header, "Sub", "Move the tiles. Draw a thought. Ask for a different perspective.", Local(new BPoint(35 / 900f, 92 / 560f), -0.002f), 15 * PY, Muted, TextAnchor.MiddleLeft, 3002);
            Draw.Text(header, "Tray", "TILE TRAY", Local(new BPoint(35 / 900f, 356 / 560f), -0.002f), 13 * PY, Muted, TextAnchor.MiddleLeft, 3002);
            footer = Draw.Text(header, "Footer", "0/3 ALIGNED", Local(new BPoint(35 / 900f, 532 / 560f), -0.002f), 14 * PY, Muted, TextAnchor.MiddleLeft, 3002);
        }

        TextMesh Label(int i)
        {
            while (labelPool.Count <= i)
                labelPool.Add(Draw.Text(layers, "Label" + labelPool.Count, "", Vector3.zero, 20 * PY, Ink, TextAnchor.LowerLeft, 3004));
            return labelPool[i];
        }

        /// Full redraw of tiles + annotations. objects may be a local drag override.
        public void Render(BoardState s, IList<BoardObject> objects)
        {
            Build();
            lastState = s; lastObjects = objects;
            titleText.text = "A little guidance. A shared understanding.";

            // tiles and their dashed targets
            mb.Clear();
            foreach (var o in objects)
            {
                var placed = Model.Placed(o);
                var oc = Model.ParseColor(o.color);
                mb.DashedRect(L2(o.target), new Vector2(o.w * W + 12 * PX, o.h * H + 12 * PY), 1.5f * PX, 6 * PX, 6 * PX, placed ? oc : Outline, -0.001f);
                mb.RoundedRect(L2(o.x, o.y) + new Vector2(0, -4 * PY), new Vector2(o.w * W, o.h * H), 12 * PX, new Color(0.18f, 0.3f, 0.15f, 0.08f), -0.0015f);
                mb.RoundedRect(L2(o.x, o.y), new Vector2(o.w * W, o.h * H), 12 * PX, oc, -0.002f);

                if (!tileText.TryGetValue(o.id, out var tt))
                {
                    tt = (Draw.Text(layers, o.id + "-glyph", o.glyph, Vector3.zero, 28 * PY, Color.white, TextAnchor.MiddleLeft, 3002, FontStyle.Bold),
                          Draw.Text(layers, o.id + "-label", o.label, Vector3.zero, 14 * PY, Color.white, TextAnchor.MiddleLeft, 3002),
                          Draw.Text(layers, o.id + "-check", "✓", Vector3.zero, 16 * PY, Color.white, TextAnchor.MiddleCenter, 3002),
                          Draw.Text(layers, o.id + "-target", "", Vector3.zero, 14 * PY, Muted, TextAnchor.MiddleCenter, 3002));
                    tileText[o.id] = tt;
                }
                float left = o.x - o.w / 2;
                tt.glyph.text = o.glyph;
                tt.glyph.transform.localPosition = Local(new BPoint(left + 16 / 900f, o.y - 10 / 560f), -0.003f);
                tt.label.text = o.label;
                tt.label.transform.localPosition = Local(new BPoint(left + 16 / 900f, o.y + 20 / 560f), -0.003f);
                tt.check.gameObject.SetActive(placed);
                tt.check.transform.localPosition = Local(new BPoint(o.x + o.w / 2 - 24 / 900f, o.y - o.h / 2 + 18 / 560f), -0.003f);
                tt.targetLabel.text = o.glyph + " / " + o.label;
                tt.targetLabel.transform.localPosition = Local(new BPoint(o.target.x, o.target.y + o.h / 2 + 30 / 560f), -0.002f);
            }
            mb.Apply(dynamicMesh.sharedMesh);
            footer.text = $"{objects.Count(Model.Placed)}/3 ALIGNED · {(s.id == "LOCAL" ? "LOCAL SESSION" : "ROOM " + s.id)}";

            // committed annotations
            mb.Clear();
            int li = 0;
            foreach (var a in s.annotations)
            {
                if (a.source == "ai" && !showAILayer) continue;
                if (a.type == "label") { PlaceLabel(Label(li++), a, objects); continue; }
                AddShape(mb, a, objects, -0.004f);
            }
            for (int i = li; i < labelPool.Count; i++) labelPool[i].gameObject.SetActive(false);
            mb.Apply(annotationMesh.sharedMesh);
            RenderPreviews();
        }

        public void Rerender() { if (lastState != null) Render(lastState, lastObjects); }

        void PlaceLabel(TextMesh tm, Annotation a, IList<BoardObject> objects)
        {
            tm.gameObject.SetActive(true);
            var p = Model.AnchorPoint(a.points[0], a, objects);
            tm.transform.localPosition = Local(p, -0.005f);
            tm.text = a.text;
            tm.color = Model.ParseColor(a.color);
        }

        void AddShape(MeshBuilder m, Annotation a, IList<BoardObject> objects, float z)
        {
            if (a.points.Count == 0) return;
            var col = Model.ParseColor(a.color);
            float w = Mathf.Clamp(a.width, 1, 16) * PX;
            var pts = a.points.Select(p => L2(Model.AnchorPoint(p, a, objects))).ToList();
            switch (a.type)
            {
                case "pen": m.Polyline(pts, w, col, z); break;
                case "circle":
                {
                    var p = pts[0]; var q = pts[pts.Count - 1];
                    m.Ellipse((p + q) / 2, Mathf.Max(3 * PX, Mathf.Abs(q.x - p.x) / 2), Mathf.Max(3 * PY, Mathf.Abs(q.y - p.y) / 2), w, col, z);
                    break;
                }
                case "arrow": m.Arrow(pts[0], pts[pts.Count - 1], w, 16 * PX, col, z); break;
                case "label": break;
            }
        }

        // ------------------------------------------------------------------ live layers
        TextMesh draftLabel;

        public void RenderDraft(Annotation draft, IList<BoardObject> objects)
        {
            Build();
            mb.Clear();
            if (draft != null && draft.type != "label") AddShape(mb, draft, objects, -0.006f);
            mb.Apply(draftMesh.sharedMesh);
        }

        public void SetPreview(string ownerId, Annotation a)
        {
            Build();
            if (string.IsNullOrEmpty(ownerId)) return;
            if (a == null) previewData.Remove(ownerId); else previewData[ownerId] = a;
            RenderPreviews();
        }

        void RenderPreviews()
        {
            if (lastObjects == null) return;
            foreach (var id in previews.Keys.ToList())
                if (!previewData.ContainsKey(id)) { Destroy(previews[id].gameObject); previews.Remove(id); }
            foreach (var kv in previewData)
            {
                if (!previews.TryGetValue(kv.Key, out var mf)) previews[kv.Key] = mf = Draw.MeshObject(layers, "Preview " + kv.Key, baseMaterial, 3005).Item1;
                mb.Clear();
                AddShape(mb, kv.Value, lastObjects, -0.006f);
                mb.Apply(mf.sharedMesh);
            }
        }

        public void SetCursor(Member m, BPoint p)
        {
            Build();
            if (m == null || m.id == null) return;
            if (!cursors.TryGetValue(m.id, out var c) || c.label == null)
                c.label = Draw.Text(layers, "Cursor " + m.name, m.name, Vector3.zero, 11 * PY, Model.ParseColor(m.color), TextAnchor.LowerLeft, 3006);
            cursors[m.id] = (m, p, Time.time, c.label);
        }

        void LateUpdate()
        {
            if (!built || cursors.Count == 0) return;
            mb.Clear();
            foreach (var id in cursors.Keys.ToList())
            {
                var c = cursors[id];
                if (Time.time - c.time > 4f) { Destroy(c.label.gameObject); cursors.Remove(id); continue; }
                var col = Model.ParseColor(c.member.color);
                mb.Disc(L2(c.p), 6 * PX, col, -0.007f, 12);
                c.label.transform.localPosition = Local(c.p, -0.007f) + new Vector3(8 * PX, 6 * PY, 0);
            }
            mb.Apply(cursorMesh.sharedMesh);
        }

        // ------------------------------------------------------------------ snapshot
        /// Renders only the board into a PNG (like the web "Snapshot PNG"). Hidden AI layers stay hidden.
        public byte[] Snapshot(int width = 1800)
        {
            Build();
            int height = Mathf.RoundToInt(width * H / W);
            var go = new GameObject("SnapshotCam");
            var cam = go.AddComponent<Camera>();
            cam.orthographic = true;
            cam.orthographicSize = H / 2;
            cam.aspect = W / H;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Paper;
            cam.nearClipPlane = 0.01f; cam.farClipPlane = 1f;
            cam.stereoTargetEye = StereoTargetEyeMask.None;
            go.transform.SetPositionAndRotation(transform.TransformPoint(new Vector3(0, 0, -0.5f)), transform.rotation);
            var rt = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            cam.targetTexture = rt;
            cam.Render();
            var prev = RenderTexture.active;
            RenderTexture.active = rt;
            var tex = new Texture2D(width, height, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, width, height), 0, 0);
            tex.Apply();
            RenderTexture.active = prev;
            var png = tex.EncodeToPNG();
            cam.targetTexture = null;
            Destroy(tex); rt.Release(); Destroy(rt); Destroy(go);
            return png;
        }
    }
}
