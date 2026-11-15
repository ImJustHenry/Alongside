// Alongside for Unity — static hooks so tests/automation (e.g. the Claude Bridge invoke_static command) can drive a running board.
using System.Linq;
using UnityEngine;

namespace Alongside
{
    public static class AlongsideDebug
    {
        static BoardController C => Object.FindAnyObjectByType<BoardController>() ?? throw new System.Exception("No BoardController in the scene (enter Play mode first)");

        public static string Status()
        {
            var s = C.Session;
            return $"{s.StatusLine} | tool={C.Tool} | tiles placed={s.State.objects.Count(Model.Placed)}/3 | annotations={s.State.annotations.Count} | messages={s.State.messages.Count} | writing={(s.State.collaborativeWriting ? "ON" : "OFF")} | last={s.State.messages.LastOrDefault()?.text}";
        }

        public static string Stroke(string type, float x1, float y1, float x2, float y2)
        {
            var a = new Annotation { type = type, color = C.InkColor, width = 4 };
            if (type == "pen")
                for (int i = 0; i <= 20; i++)
                {
                    float t = i / 20f;
                    a.points.Add(new BPoint(Mathf.Lerp(x1, x2, t), Mathf.Lerp(y1, y2, t) + Mathf.Sin(t * Mathf.PI * 2) * 0.03f));
                }
            else { a.points.Add(new BPoint(x1, y1)); a.points.Add(new BPoint(x2, y2)); }
            C.Session.Add(a);
            return Status();
        }

        public static string Label(string text, float x, float y)
        {
            C.Session.Add(new Annotation { type = "label", text = text, color = C.InkColor, points = { new BPoint(x, y) } });
            return Status();
        }

        public static string MoveTile(string id, float x, float y)
        {
            var o = C.Session.State.objects.First(t => t.id == id);
            C.Session.Move(id, new BPoint(x, y), o.version);
            return Status();
        }

        public static string Invite() => (C.Session as ServerSession)?.InviteLink ?? "not connected to a server (or not the host)";
        public static string Collab(bool on) { C.Session.SetCollaborativeWriting(on); return Status() + " | collaborativeWriting=" + on; }
#if UNITY_EDITOR && UNITY_EDITOR_WIN
        /// Editor-only helper for automated multi-client checks (starts a detached cmd.exe command).
        public static string EditorShell(string command)
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe", "/c " + command) { UseShellExecute = false, CreateNoWindow = true });
            return "started";
        }
#endif
        public static string Hint() { C.AskForHint(); return Status(); }
        public static string Tool(string t) { C.SetTool(t); return Status(); }
        public static string Undo() { C.Session.Undo(); return Status(); }
        public static string Reset() { C.Session.Reset(); return Status(); }
        public static string Export() => C.ExportBoard();
        public static string Snapshot() => C.SnapshotBoard();
        public static string Import(string path) { C.ImportBoard(path); return Status(); }
        public static string Join(string inviteLink, string name) { C.JoinRoom(inviteLink, name); return "joining"; }
        public static string Create(string url, string name) { C.CreateRoom(url, name, "Shared studio"); return "creating"; }
    }
}
