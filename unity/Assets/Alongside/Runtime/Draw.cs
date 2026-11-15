// Alongside for Unity — lightweight mesh/text helpers (no TextMeshPro or LineRenderer dependency).
using System.Collections.Generic;
using UnityEngine;

namespace Alongside
{
    /// Builds flat vertex-colored meshes in a plane (x right, y up, z toward the viewer is negative).
    public class MeshBuilder
    {
        readonly List<Vector3> v = new List<Vector3>(1024);
        readonly List<Color32> c = new List<Color32>(1024);
        readonly List<int> t = new List<int>(2048);

        public void Clear() { v.Clear(); c.Clear(); t.Clear(); }

        public void Quad(Vector3 a, Vector3 b, Vector3 cc, Vector3 d, Color col)
        {
            int i = v.Count;
            v.Add(a); v.Add(b); v.Add(cc); v.Add(d);
            Color32 k = col; c.Add(k); c.Add(k); c.Add(k); c.Add(k);
            t.Add(i); t.Add(i + 1); t.Add(i + 2); t.Add(i); t.Add(i + 2); t.Add(i + 3);
        }

        public void Rect(Vector2 center, Vector2 size, Color col, float z)
        {
            float hx = size.x / 2, hy = size.y / 2;
            Quad(new Vector3(center.x - hx, center.y - hy, z), new Vector3(center.x - hx, center.y + hy, z),
                 new Vector3(center.x + hx, center.y + hy, z), new Vector3(center.x + hx, center.y - hy, z), col);
        }

        public void Disc(Vector2 center, float r, Color col, float z, int seg = 10)
        {
            int i = v.Count;
            Color32 k = col;
            v.Add(new Vector3(center.x, center.y, z)); c.Add(k);
            for (int s = 0; s <= seg; s++)
            {
                float a = s * Mathf.PI * 2 / seg;
                v.Add(new Vector3(center.x + Mathf.Cos(a) * r, center.y + Mathf.Sin(a) * r, z)); c.Add(k);
                if (s > 0) { t.Add(i); t.Add(i + s); t.Add(i + s + 1); }
            }
        }

        public void RoundedRect(Vector2 center, Vector2 size, float radius, Color col, float z)
        {
            radius = Mathf.Min(radius, size.x / 2, size.y / 2);
            Rect(center, new Vector2(size.x - 2 * radius, size.y), col, z);
            Rect(center, new Vector2(size.x, size.y - 2 * radius), col, z);
            float hx = size.x / 2 - radius, hy = size.y / 2 - radius;
            Disc(center + new Vector2(-hx, -hy), radius, col, z, 8);
            Disc(center + new Vector2(-hx, hy), radius, col, z, 8);
            Disc(center + new Vector2(hx, hy), radius, col, z, 8);
            Disc(center + new Vector2(hx, -hy), radius, col, z, 8);
        }

        public void Segment(Vector2 a, Vector2 b, float w, Color col, float z)
        {
            var d = b - a;
            if (d.sqrMagnitude < 1e-10f) { Disc(a, w / 2, col, z, 8); return; }
            var n = new Vector2(-d.y, d.x).normalized * (w / 2);
            Quad(new Vector3(a.x - n.x, a.y - n.y, z), new Vector3(a.x + n.x, a.y + n.y, z),
                 new Vector3(b.x + n.x, b.y + n.y, z), new Vector3(b.x - n.x, b.y - n.y, z), col);
        }

        public void Polyline(IList<Vector2> pts, float w, Color col, float z, bool closed = false, bool roundJoins = true)
        {
            if (pts.Count == 0) return;
            if (pts.Count == 1) { Disc(pts[0], w / 2, col, z, 8); return; }
            for (int i = 1; i < pts.Count; i++) Segment(pts[i - 1], pts[i], w, col, z);
            if (closed) Segment(pts[pts.Count - 1], pts[0], w, col, z);
            if (roundJoins) for (int i = 0; i < pts.Count; i++) Disc(pts[i], w / 2, col, z, 6);
        }

        public void Dashed(Vector2 a, Vector2 b, float w, float dash, float gap, Color col, float z)
        {
            float len = Vector2.Distance(a, b);
            if (len < 1e-6f) return;
            var dir = (b - a) / len;
            for (float s = 0; s < len; s += dash + gap)
                Segment(a + dir * s, a + dir * Mathf.Min(len, s + dash), w, col, z);
        }

        public void DashedRect(Vector2 center, Vector2 size, float w, float dash, float gap, Color col, float z)
        {
            float hx = size.x / 2, hy = size.y / 2;
            var p0 = center + new Vector2(-hx, -hy); var p1 = center + new Vector2(-hx, hy);
            var p2 = center + new Vector2(hx, hy); var p3 = center + new Vector2(hx, -hy);
            Dashed(p0, p1, w, dash, gap, col, z); Dashed(p1, p2, w, dash, gap, col, z);
            Dashed(p2, p3, w, dash, gap, col, z); Dashed(p3, p0, w, dash, gap, col, z);
        }

        public void Ellipse(Vector2 center, float rx, float ry, float w, Color col, float z, int seg = 48)
        {
            var pts = new List<Vector2>(seg);
            for (int i = 0; i < seg; i++)
            {
                float a = i * Mathf.PI * 2 / seg;
                pts.Add(center + new Vector2(Mathf.Cos(a) * rx, Mathf.Sin(a) * ry));
            }
            Polyline(pts, w, col, z, true, false);
        }

        public void Arrow(Vector2 a, Vector2 b, float w, float head, Color col, float z)
        {
            Segment(a, b, w, col, z);
            float ang = Mathf.Atan2(b.y - a.y, b.x - a.x);
            var h1 = b - new Vector2(Mathf.Cos(ang - 0.5f), Mathf.Sin(ang - 0.5f)) * head;
            var h2 = b - new Vector2(Mathf.Cos(ang + 0.5f), Mathf.Sin(ang + 0.5f)) * head;
            Segment(h1, b, w, col, z); Segment(h2, b, w, col, z);
            Disc(a, w / 2, col, z, 6); Disc(b, w / 2, col, z, 6); Disc(h1, w / 2, col, z, 6); Disc(h2, w / 2, col, z, 6);
        }

        public void Apply(Mesh m)
        {
            m.Clear();
            m.indexFormat = v.Count > 65000 ? UnityEngine.Rendering.IndexFormat.UInt32 : UnityEngine.Rendering.IndexFormat.UInt16;
            m.SetVertices(v);
            m.SetColors(c);
            m.SetTriangles(t, 0);
            m.RecalculateBounds();
        }
    }

    public static class Draw
    {
        static Font font;
        public static Font Font => font != null ? font : (font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"));

        /// World height of one text line per (fontSize * characterSize) unit. Calibrated for the legacy runtime font.
        public static float TextUnit = 0.1f;

        static readonly Dictionary<(Material, int), Material> queued = new Dictionary<(Material, int), Material>();

        public static Material Queued(Material baseMat, int queue)
        {
            if (queued.TryGetValue((baseMat, queue), out var m) && m != null) return m;
            m = new Material(baseMat) { renderQueue = queue };
            queued[(baseMat, queue)] = m;
            return m;
        }

        public static (MeshFilter, MeshRenderer) MeshObject(Transform parent, string name, Material mat, int queue)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = new Mesh { name = name };
            mf.sharedMesh.MarkDynamic();
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = Queued(mat, queue);
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            return (mf, mr);
        }

        public static TextMesh Text(Transform parent, string name, string text, Vector3 localPos, float lineHeight, Color color,
            TextAnchor anchor = TextAnchor.MiddleLeft, int queue = 3010, FontStyle style = FontStyle.Normal)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            var tm = go.AddComponent<TextMesh>();
            tm.font = Font;
            tm.fontSize = 64;
            tm.fontStyle = style;
            tm.characterSize = lineHeight / (64 * TextUnit);
            tm.anchor = anchor;
            tm.alignment = anchor == TextAnchor.MiddleCenter || anchor == TextAnchor.UpperCenter || anchor == TextAnchor.LowerCenter ? TextAlignment.Center : TextAlignment.Left;
            tm.color = color;
            tm.richText = false;
            tm.text = text;
            var mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = Queued(Font.material, queue);
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return tm;
        }

        public static void SetLineHeight(TextMesh tm, float lineHeight) => tm.characterSize = lineHeight / (tm.fontSize * TextUnit);

        /// Greedy word wrap by character budget (TextMesh has no automatic wrapping).
        public static string Wrap(string text, int maxChars, int maxLines = 99)
        {
            if (string.IsNullOrEmpty(text)) return "";
            var lines = new List<string>();
            foreach (var para in text.Replace("\r", "").Split('\n'))
            {
                var line = "";
                foreach (var w in para.Split(' '))
                {
                    var word = w;
                    while (word.Length > maxChars) // hard-break very long tokens such as file paths
                    {
                        if (line.Length > 0) { lines.Add(line); line = ""; }
                        lines.Add(word.Substring(0, maxChars));
                        word = word.Substring(maxChars);
                    }
                    if (line.Length > 0 && line.Length + 1 + word.Length > maxChars) { lines.Add(line); line = word; }
                    else line = line.Length == 0 ? word : line + " " + word;
                }
                lines.Add(line);
            }
            if (lines.Count > maxLines) { lines = lines.GetRange(0, maxLines); lines[maxLines - 1] += " …"; }
            return string.Join("\n", lines);
        }
    }
}
