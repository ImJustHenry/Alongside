// Alongside for Unity — session abstraction. LocalSession applies the same rules as server/store.js offline.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Alongside
{
    public interface IBoardSession : IDisposable
    {
        BoardState State { get; }
        Member Me { get; }
        bool IsRemote { get; }
        string StatusLine { get; }
        string AssistantName { get; }
        event Action Changed;
        event Action<string> Error;
        event Action<string, Annotation> PreviewReceived;     // ownerId, annotation (null => preview ended)
        event Action<Member, BPoint> CursorReceived;
        event Action<List<Member>> PresenceChanged;

        void Add(Annotation a);
        void Undo();
        void Erase(string id);
        void ClearMine();
        void Move(string id, BPoint position, int version);
        void Reset();
        void SetAIEnabled(bool enabled);
        void SetCollaborativeWriting(bool enabled);
        void SendMessage(string text);
        void AskAI(string prompt);
        void SendPreview(Annotation a);
        void SendPreviewEnd();
        void SendCursor(BPoint p);
        string ExportJson();
        void ImportJson(string json);
        void SpatialAction(string type, SpatialStroke stroke = null, string id = null);
        void Tick();
    }

    /// Offline, single-device session: identical board rules, scripted practice guide only.
    public partial class LocalSession : IBoardSession
    {
        public BoardState State { get; } = new BoardState { title = "Local studio" };
        public Member Me { get; }
        public bool IsRemote => false;
        public string StatusLine => "LOCAL · not connected to an Alongside server";
        public string AssistantName => "Practice guide (scripted)";
        public event Action Changed;
        public event Action<string> Error;
        public event Action<string, Annotation> PreviewReceived { add { } remove { } }
        public event Action<Member, BPoint> CursorReceived { add { } remove { } }
        public event Action<List<Member>> PresenceChanged { add { } remove { } }

        const string AgentId = "local-scripted-guide";

        public LocalSession(string name)
        {
            Me = new Member { id = Model.NewId(), name = string.IsNullOrWhiteSpace(name) ? "Me" : name.Trim(), role = "host", color = Model.Colors[0] };
            State.members.Add(Me);
        }

        void Changed_() { State.revision++; Changed?.Invoke(); }

        bool Guard(Func<string> check)
        {
            var err = check();
            if (err == null) return true;
            Error?.Invoke(err);
            return false;
        }

        public void Add(Annotation a) => AddAs(a, Me.id, Me.name, "human");

        void AddAs(Annotation a, string ownerId, string ownerName, string source)
        {
            try { Model.Validate(a); }
            catch (Exception e) { Error?.Invoke(e.Message); return; }
            if (!Guard(() => State.annotations.Count >= Model.MaxAnnotations ? "Board is full. Remove annotations before adding more." : null)) return;
            var c = a.Clone();
            c.id = Model.NewId(); c.ownerId = ownerId; c.ownerName = ownerName; c.source = source; c.at = Model.Now();
            State.annotations.Add(c);
            Changed_();
        }

        public void Undo()
        {
            var a = State.annotations.LastOrDefault(x => x.ownerId == Me.id);
            if (a == null) return;
            State.annotations.Remove(a);
            Changed_();
        }

        public void Erase(string id)
        {
            var a = State.annotations.FirstOrDefault(x => x.id == id);
            if (!Guard(() => a == null ? "Annotation not found" : a.ownerId != Me.id && !Me.IsHost ? "Only the author or host can erase this mark" : null)) return;
            State.annotations.Remove(a);
            Changed_();
        }

        public void ClearMine()
        {
            State.annotations.RemoveAll(x => x.ownerId == Me.id);
            Changed_();
        }

        public void Move(string id, BPoint p, int version)
        {
            var o = State.objects.FirstOrDefault(x => x.id == id);
            if (!Guard(() => o == null ? "Unknown object" : o.version != version ? "Object moved; refresh and try again" : null)) return;
            o.x = UnityEngine.Mathf.Clamp(p.x, 0.1f, 0.9f);
            o.y = UnityEngine.Mathf.Clamp(p.y, 0.16f, 0.88f);
            o.version++;
            Changed_();
        }

        public void Reset()
        {
            State.objects = Model.InitialObjects();
            State.spatialStrokes.Clear();
            State.annotations.Clear();
            State.messages.Clear();
            Changed_();
        }

        public void SetAIEnabled(bool enabled) { State.aiEnabled = enabled; Changed_(); }

        public void SetCollaborativeWriting(bool enabled)
        {
            if (!Guard(() => Me.IsHost ? null : "Only the host can change collaborative writing.")) return;
            if (State.collaborativeWriting == enabled) return;
            State.collaborativeWriting = enabled;
            Changed_();
        }

        public void SendMessage(string text) => Message(Me.id, Me.name, "human", text);

        void Message(string ownerId, string author, string source, string text)
        {
            text = (text ?? "").Trim();
            if (text.Length == 0) return;
            if (text.Length > 2000) text = text.Substring(0, 2000);
            State.messages.Add(new ChatMessage { id = Model.NewId(), at = Model.Now(), author = author, ownerId = ownerId, source = source, text = text });
            if (State.messages.Count > 80) State.messages.RemoveRange(0, State.messages.Count - 80);
            Changed_();
        }

        public void AskAI(string prompt)
        {
            if (!Guard(() => State.aiEnabled ? null : "AI access is paused")) return;
            Message(Me.id, Me.name, "human", string.IsNullOrWhiteSpace(prompt) ? "Show me the next step" : prompt);
            var (anns, text) = Model.Guide(State);
            if (State.collaborativeWriting)
            {
                State.annotations.RemoveAll(x => x.ownerId == AgentId);
                foreach (var a in anns) AddAs(a, AgentId, AssistantName, "ai");
            }
            else text += " Collaborative writing is off; this is guidance only and the board was not changed.";
            Message(AgentId, AssistantName, "ai", "[Scripted practice — not a live model] " + text);
        }

        public void SendPreview(Annotation a) { }
        public void SendPreviewEnd() { }
        public void SendCursor(BPoint p) { }

        public string ExportJson() => Model.Export(State);

        public void ImportJson(string json)
        {
            try
            {
                var (objects, anns) = Model.ParseImport(json);
                var spatial=Model.StateFrom(Json.Parse(json) as Dictionary<string,object>).spatialStrokes;
                if(spatial.Count>500||spatial.Sum(x=>x.points.Count)>20000)throw new Exception("Spatial point budget exceeded");
                foreach(var x in spatial){LiveMath.Validate(x);x.id=Model.NewId();x.ownerId=Me.id;x.ownerName=Me.name;x.source="human";}
                State.spatialStrokes=spatial;
                State.objects = objects;
                State.annotations = anns.Select(a => { var c = a.Clone(); c.id = Model.NewId(); c.ownerId = Me.id; c.ownerName = Me.name; c.source = "human"; c.at = Model.Now(); return c; }).ToList();
                State.messages.Clear();
                Changed_();
            }
            catch (Exception e) { Error?.Invoke("Import failed: " + e.Message); }
        }

        public void Tick() { }
        public void Dispose() { }
    }
}
