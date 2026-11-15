// Alongside for Unity — data model. Port of shared/model.js and the board rules in server/store.js.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using UnityEngine;
using Dict = System.Collections.Generic.Dictionary<string, object>;

namespace Alongside
{
    [Serializable]
    public struct BPoint
    {
        public float x, y;
        public BPoint(float x, float y) { this.x = x; this.y = y; }
        public static BPoint Clamp01(BPoint p) => new BPoint(Mathf.Clamp01(p.x), Mathf.Clamp01(p.y));
    }

    [Serializable]
    public class BoardObject
    {
        public string id, label, glyph, color;
        public float x, y, w, h;
        public BPoint target;
        public int version;
        public BoardObject Clone() => (BoardObject)MemberwiseClone();
    }

    [Serializable]
    public class Annotation
    {
        public string id = "", type = "pen", color = "#256b62", text = "", anchorId, ownerId, ownerName, source = "human";
        public float width = 4;
        public long at;
        public List<BPoint> points = new List<BPoint>();
        public Annotation Clone()
        {
            var a = (Annotation)MemberwiseClone();
            a.points = new List<BPoint>(points);
            return a;
        }
    }

    [Serializable]
    public class ChatMessage
    {
        public string id, author, ownerId, source, text;
        public long at;
    }

    [Serializable]
    public class Member
    {
        public string id, name, color, role;
        public bool IsHost => role == "host";
    }

    [Serializable]
    public class BoardState
    {
        public string id = "LOCAL", title = "Shared studio", task = Model.Task;
        public int revision;
        public bool aiEnabled = true;
        public bool collaborativeWriting = true;
        public List<BoardObject> objects = Model.InitialObjects();
        public List<Annotation> annotations = new List<Annotation>();
        public List<SpatialStroke> spatialStrokes = new List<SpatialStroke>();
        public List<ChatMessage> messages = new List<ChatMessage>();
        public List<Member> members = new List<Member>();
    }

    public static class Model
    {
        public static readonly string[] Colors = { "#256b62", "#da6b45", "#4b68bd", "#a0609c", "#273a47" };
        public const string AIColor = "#a0609c";
        public const string Ink = "#253c35";
        public const string Task = "Place the three tiles on their matching outlines. This is a spatial learning demonstration, not an electrical simulation.";
        public const int MaxAnnotations = 400;
        public const int MaxPoints = 512;

        public static List<BoardObject> InitialObjects() => new List<BoardObject>
        {
            new BoardObject { id = "base", label = "Foundation", glyph = "01", color = "#256b62", x = 0.24f, y = 0.77f, w = 0.16f, h = 0.14f, target = new BPoint(0.24f, 0.39f) },
            new BoardObject { id = "bridge", label = "Connection", glyph = "02", color = "#da6b45", x = 0.5f, y = 0.77f, w = 0.16f, h = 0.14f, target = new BPoint(0.5f, 0.39f) },
            new BoardObject { id = "cap", label = "Finish", glyph = "03", color = "#4b68bd", x = 0.76f, y = 0.77f, w = 0.16f, h = 0.14f, target = new BPoint(0.76f, 0.39f) },
        };

        public static bool CanWrite(BoardState state, Member member) =>
            state != null && member != null && (state.collaborativeWriting || member.IsHost);

        public static bool Placed(BoardObject o) => Mathf.Sqrt((o.x - o.target.x) * (o.x - o.target.x) + (o.y - o.target.y) * (o.y - o.target.y)) < 0.055f;

        public static BPoint AnchorPoint(BPoint p, Annotation a, IList<BoardObject> objects)
        {
            var o = a.anchorId == null ? null : objects.FirstOrDefault(x => x.id == a.anchorId);
            return o == null ? p : new BPoint(o.x - o.w / 2 + p.x * o.w, o.y - o.h / 2 + p.y * o.h);
        }

        public static BoardObject HitObject(IList<BoardObject> objects, BPoint p)
        {
            for (int i = objects.Count - 1; i >= 0; i--)
            {
                var o = objects[i];
                if (Mathf.Abs(o.x - p.x) < o.w / 2 && Mathf.Abs(o.y - p.y) < o.h / 2) return o;
            }
            return null;
        }

        public static string NewId() => Guid.NewGuid().ToString();

        public static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        /// Deterministic "scripted practice" guide (makeGuideActions in model.js).
        public static (List<Annotation> annotations, string text) Guide(BoardState s)
        {
            var o = s.objects.FirstOrDefault(x => !Placed(x));
            if (o == null)
                return (new List<Annotation>(), "All three tiles are aligned. Explain the sequence to your collaborator, or reset the exercise to try again.");
            var anns = new List<Annotation>
            {
                new Annotation { type = "circle", points = { new BPoint(0, 0), new BPoint(1, 1) }, anchorId = o.id, color = AIColor, width = 4 },
                new Annotation { type = "arrow", points = { new BPoint(o.x, o.y - 0.09f), new BPoint(o.target.x, o.target.y + 0.09f) }, color = AIColor, width = 4 },
            };
            return (anns, $"Move {o.label} ({o.glyph}) onto its matching dashed outline. Use Move mode and drag the tile. {s.objects.Count(Placed)} of 3 are aligned.");
        }

        public static Color ParseColor(string hex, Color fallback = default)
        {
            return ColorUtility.TryParseHtmlString(hex ?? "", out var c) ? c : (fallback == default ? Color.magenta : fallback);
        }

        /// Distance (board units) from p to an annotation, for the eraser.
        public static float Distance(Annotation a, BPoint p, IList<BoardObject> objects)
        {
            var pts = a.points.Select(x => AnchorPoint(x, a, objects)).ToList();
            if (pts.Count == 0) return float.MaxValue;
            if (a.type == "label") return Dist(pts[0], p) - 0.02f;
            if (a.type == "circle" && pts.Count >= 2)
            {
                var c = new BPoint((pts[0].x + pts[pts.Count - 1].x) / 2, (pts[0].y + pts[pts.Count - 1].y) / 2);
                float rx = Mathf.Max(0.005f, Mathf.Abs(pts[pts.Count - 1].x - pts[0].x) / 2), ry = Mathf.Max(0.005f, Mathf.Abs(pts[pts.Count - 1].y - pts[0].y) / 2);
                float nx = (p.x - c.x) / rx, ny = (p.y - c.y) / ry;
                float r = Mathf.Sqrt(nx * nx + ny * ny);
                return Mathf.Abs(r - 1) * Mathf.Min(rx, ry);
            }
            if (pts.Count == 1) return Dist(pts[0], p);
            if (a.type == "arrow") pts = new List<BPoint> { pts[0], pts[pts.Count - 1] };
            float best = float.MaxValue;
            for (int i = 1; i < pts.Count; i++) best = Mathf.Min(best, SegDist(p, pts[i - 1], pts[i]));
            return best;
        }

        static float Dist(BPoint a, BPoint b) => Mathf.Sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

        static float SegDist(BPoint p, BPoint a, BPoint b)
        {
            float dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
            float t = l < 1e-9f ? 0 : Mathf.Clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / l);
            return Dist(p, new BPoint(a.x + t * dx, a.y + t * dy));
        }

        // ------------------------------------------------------------ JSON mapping (server wire format)
        static string S(Dict d, string k) => d != null && d.TryGetValue(k, out var v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;
        static float F(Dict d, string k, float def = 0) => d != null && d.TryGetValue(k, out var v) && v != null ? Convert.ToSingle(v, CultureInfo.InvariantCulture) : def;
        static long L(Dict d, string k) => d != null && d.TryGetValue(k, out var v) && v != null ? Convert.ToInt64(v, CultureInfo.InvariantCulture) : 0;
        static List<object> Arr(Dict d, string k) => d != null && d.TryGetValue(k, out var v) ? v as List<object> ?? new List<object>() : new List<object>();

        public static BPoint PointFrom(object o)
        {
            var d = o as Dict;
            return new BPoint(F(d, "x"), F(d, "y"));
        }

        public static BoardObject ObjectFrom(Dict d) => new BoardObject
        {
            id = S(d, "id"), label = S(d, "label"), glyph = S(d, "glyph"), color = S(d, "color"),
            x = F(d, "x"), y = F(d, "y"), w = F(d, "w", 0.16f), h = F(d, "h", 0.14f),
            target = d.TryGetValue("target", out var t) ? PointFrom(t) : default, version = (int)L(d, "version"),
        };

        public static Annotation AnnotationFrom(Dict d) => new Annotation
        {
            id = S(d, "id") ?? NewId(), type = S(d, "type") ?? "pen", color = S(d, "color") ?? AIColor, text = S(d, "text") ?? "",
            anchorId = S(d, "anchorId"), ownerId = S(d, "ownerId"), ownerName = S(d, "ownerName"), source = S(d, "source") ?? "human",
            width = F(d, "width", 4), at = L(d, "at"), points = Arr(d, "points").Select(PointFrom).ToList(),
        };

        public static ChatMessage MessageFrom(Dict d) => new ChatMessage
        {
            id = S(d, "id"), author = S(d, "author"), ownerId = S(d, "ownerId"), source = S(d, "source"), text = S(d, "text"), at = L(d, "at"),
        };

        public static Member MemberFrom(Dict d) => new Member { id = S(d, "id"), name = S(d, "name"), color = S(d, "color"), role = S(d, "role") };

        public static BoardState StateFrom(Dict d)
        {
            var s = new BoardState
            {
                id = S(d, "id") ?? "LOCAL", title = S(d, "title") ?? "Shared studio", task = S(d, "task") ?? Task,
                revision = (int)L(d, "revision"), aiEnabled = !d.TryGetValue("aiEnabled", out var ai) || ai is bool b && b,
                // Older servers omit this field; preserve their original enabled behavior.
                collaborativeWriting = !d.TryGetValue("collaborativeWriting", out var cw) || cw is bool enabled && enabled,
                objects = Arr(d, "objects").Cast<Dict>().Select(ObjectFrom).ToList(),
                annotations = Arr(d, "annotations").Cast<Dict>().Select(AnnotationFrom).ToList(),
                spatialStrokes = Arr(d, "spatialStrokes").Select(x=>JsonUtility.FromJson<SpatialStroke>(Json.Serialize(x,false))).ToList(),
                messages = Arr(d, "messages").Cast<Dict>().Select(MessageFrom).ToList(),
                members = Arr(d, "members").Cast<Dict>().Select(MemberFrom).ToList(),
            };
            if (s.objects.Count == 0) s.objects = InitialObjects();
            return s;
        }

        static object P(BPoint p) => new Dict { ["x"] = Math.Round(p.x, 5), ["y"] = Math.Round(p.y, 5) };

        /// Wire format accepted by the server's strict annotation schema (no id/owner fields).
        public static Dict AnnotationWire(Annotation a)
        {
            var d = new Dict
            {
                ["type"] = a.type,
                ["points"] = a.points.Take(MaxPoints).Select(p => P(BPoint.Clamp01(p))).ToList(),
                ["color"] = a.color,
                ["width"] = Mathf.Clamp(a.width, 1, 16),
                ["text"] = a.text ?? "",
            };
            if (!string.IsNullOrEmpty(a.anchorId)) d["anchorId"] = a.anchorId;
            return d;
        }

        public static Dict AnnotationFull(Annotation a)
        {
            var d = AnnotationWire(a);
            d["id"] = a.id; d["ownerId"] = a.ownerId; d["ownerName"] = a.ownerName; d["source"] = a.source; d["at"] = a.at;
            return d;
        }

        public static Dict ObjectJson(BoardObject o) => new Dict
        {
            ["id"] = o.id, ["label"] = o.label, ["glyph"] = o.glyph, ["color"] = o.color, ["x"] = o.x, ["y"] = o.y,
            ["w"] = o.w, ["h"] = o.h, ["target"] = P(o.target), ["version"] = o.version,
        };

        /// "alongside-board" v1 export, compatible with the server's Import board action.
        public static string Export(BoardState s) => Json.Serialize(new Dict
        {
            ["format"] = "alongside-board",
            ["version"] = 1,
            ["exportedAt"] = DateTime.UtcNow.ToString("o"),
            ["title"] = s.title,
            ["spatialStrokes"] = s.spatialStrokes.Select(x=>Json.Parse(JsonUtility.ToJson(x))).ToList(),
            ["objects"] = s.objects.Select(o => (object)ObjectJson(o)).ToList(),
            ["annotations"] = s.annotations.Select(a => (object)AnnotationFull(a)).ToList(),
            ["messages"] = s.messages.Select(m => (object)new Dict { ["id"] = m.id, ["at"] = m.at, ["author"] = m.author, ["ownerId"] = m.ownerId, ["source"] = m.source, ["text"] = m.text }).ToList(),
        });

        /// Validates an exported board like store.import(): returns objects + annotations or throws.
        public static (List<BoardObject> objects, List<Annotation> annotations) ParseImport(string json)
        {
            var d = Json.Parse(json) as Dict ?? throw new FormatException("Not a JSON object");
            if (S(d, "format") != "alongside-board" || L(d, "version") != 1) throw new FormatException("Not an Alongside v1 board");
            var anns = Arr(d, "annotations").Cast<Dict>().Select(AnnotationFrom).ToList();
            if (anns.Count > MaxAnnotations) throw new FormatException("Too many annotations");
            foreach (var a in anns) Validate(a);
            var positions = Arr(d, "objects").Cast<Dict>().Select(ObjectFrom).ToList();
            var objects = InitialObjects();
            if (positions.Count != 3 || positions.Select(p => p.id).Distinct().Count() != 3) throw new FormatException("Board must contain the three tiles exactly once");
            foreach (var o in objects)
            {
                var p = positions.FirstOrDefault(x => x.id == o.id) ?? throw new FormatException("Missing tile " + o.id);
                if (p.x < 0.1f || p.x > 0.9f || p.y < 0.16f || p.y > 0.88f) throw new FormatException("Tile out of range: " + o.id);
                o.x = p.x; o.y = p.y; o.version = 1;
            }
            return (objects, anns);
        }

        public static void Validate(Annotation a)
        {
            if (!new[] { "pen", "arrow", "circle", "label" }.Contains(a.type)) throw new FormatException("Unknown annotation type " + a.type);
            if (a.points.Count < 1 || a.points.Count > MaxPoints) throw new FormatException("Annotation needs 1-512 points");
            if ((a.type == "arrow" || a.type == "circle") && a.points.Count < 2) throw new FormatException("Two points required");
            if (a.type == "label" && string.IsNullOrWhiteSpace(a.text)) throw new FormatException("Label text required");
            if (a.points.Any(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || float.IsNaN(p.x) || float.IsNaN(p.y))) throw new FormatException("Points must be inside the board");
            if (a.anchorId != null && !new[] { "base", "bridge", "cap" }.Contains(a.anchorId)) throw new FormatException("Bad anchor");
            if (!System.Text.RegularExpressions.Regex.IsMatch(a.color ?? "", "^#[0-9a-fA-F]{6}$")) throw new FormatException("Bad color");
            if ((a.text ?? "").Length > 240) throw new FormatException("Text too long");
        }
    }
}
