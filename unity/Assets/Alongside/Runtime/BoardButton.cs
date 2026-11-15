// Alongside for Unity — in-world button usable by mouse and controller rays.
using System;
using UnityEngine;

namespace Alongside
{
    public class BoardButton : MonoBehaviour
    {
        public Action onClick;
        public Vector2 size = new Vector2(0.135f, 0.085f);
        public Color fill = new Color32(0xfa, 0xf9, 0xf4, 0xff);
        public Color activeFill = new Color32(0xe0, 0xea, 0xd9, 0xff);
        public Color border = new Color32(0xdc, 0xe1, 0xd4, 0xff);
        public Color activeBorder = new Color32(0xa8, 0xbd, 0xa7, 0xff);
        public Color textColor = Model.ParseColor(Model.Ink);
        public Color? swatch;
        public bool Active { get; private set; }
        public bool Interactable { get; private set; } = true;

        MeshFilter mf;
        TextMesh tm;
        bool hover;
        readonly MeshBuilder mb = new MeshBuilder();

        public static BoardButton Create(Transform parent, string label, Vector3 localPos, Vector2 size, Material mat, Action onClick, float textHeight = 0.024f)
        {
            var go = new GameObject("Button " + label);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            var b = go.AddComponent<BoardButton>();
            b.size = size;
            b.onClick = onClick;
            b.mf = Draw.MeshObject(go.transform, "Shape", mat, 3007).Item1;
            b.tm = Draw.Text(go.transform, "Text", label, new Vector3(0, 0, -0.003f), textHeight, b.textColor, TextAnchor.MiddleCenter, 3011);
            var col = go.AddComponent<BoxCollider>();
            col.size = new Vector3(size.x, size.y, 0.02f);
            b.Redraw();
            return b;
        }

        public string Label { get => tm.text; set => tm.text = value; }
        public void SetActive(bool on) { if (Active == on) return; Active = on; Redraw(); }
        public void SetHover(bool on) { if (hover == on) return; hover = on; Redraw(); }
        public void SetInteractable(bool on) { Interactable = on; Redraw(); }
        public void SetColors(Color f, Color text) { fill = f; textColor = text; Redraw(); }

        public void Click()
        {
            if (!Interactable) return;
            onClick?.Invoke();
        }

        void Redraw()
        {
            if (mf == null) return;
            mb.Clear();
            var bc = Active ? activeBorder : border;
            var fc = Active ? activeFill : fill;
            if (hover && Interactable) fc = Color.Lerp(fc, Color.white, 0.35f);
            if (!Interactable) fc = Color.Lerp(fc, new Color(0.85f, 0.85f, 0.82f), 0.6f);
            mb.RoundedRect(Vector2.zero, size + new Vector2(0.006f, 0.006f), 0.016f, bc, 0);
            mb.RoundedRect(Vector2.zero, size, 0.014f, fc, -0.001f);
            if (swatch.HasValue) mb.Disc(Vector2.zero, Mathf.Min(size.x, size.y) * 0.32f, swatch.Value, -0.002f, 20);
            mb.Apply(mf.sharedMesh);
            if (tm != null) tm.color = Interactable ? textColor : new Color(textColor.r, textColor.g, textColor.b, 0.4f);
        }
    }
}
