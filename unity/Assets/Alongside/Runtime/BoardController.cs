// Alongside for Unity — tools, in-world toolbar, guidance panel and session wiring.
// Mirrors the web workspace: Pen / Move / Arrow / Circle / Text / Erase, Undo, Clear mine, AI hint,
// AI layer, host Reset, Export JSON, Snapshot PNG, live presence and peer stroke previews.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace Alongside
{
    public enum StartMode { Local, CreateRoom, JoinInvite }

    public class BoardController : MonoBehaviour
    {
        [Header("Scene")]
        public BoardView view;
        public PointerInput input;
        public XRRig rig;
        public Material uiMaterial;

        [Header("Start-up (use these for headset builds)")]
        public StartMode startMode = StartMode.Local;
        public string displayName = "Unity";
        public string serverUrl = "http://localhost:4173";
        public string roomTitle = "Shared studio";
        [Tooltip("Full invitation link: https://host/#room=ABC123&invite=…")]
        public string inviteLink = "";

        [Header("Behaviour")]
        public string[] labelPresets = { "Look here", "Next", "Nice!", "Why?", "Start here" };
        [Tooltip("Ask the assistant for feedback after you complete a tile move (rate limited).")]
        public bool autoFeedback = false;

        public IBoardSession Session { get; private set; }
        public string Tool { get; private set; } = "pen";
        public string InkColor { get; private set; } = Model.Colors[0];
        public string LabelText { get; set; } = "Look here";
        public string LastNotice { get; private set; } = "";
        public bool CanWrite => Session != null && Model.CanWrite(Session.State, Session.Me);
        public string ExportDir => Application.isEditor ? Path.Combine(Directory.GetParent(Application.dataPath).FullName, "Exports") : Path.Combine(Application.persistentDataPath, "Exports");

        // interaction state
        int activePointer = -1;
        Annotation draft;
        List<BoardObject> dragObjects;
        string dragId; int dragVersion; Vector2 dragOffset;
        float pendingMoveUntil, nextPreview, nextCursor, lastFeedback = -100, noticeUntil, resetArmedUntil;
        int labelIndex;

        // UI
        readonly Dictionary<string, BoardButton> toolButtons = new Dictionary<string, BoardButton>();
        readonly Dictionary<string, BoardButton> colorButtons = new Dictionary<string, BoardButton>();
        readonly List<BoardButton> writeButtons = new List<BoardButton>();
        BoardButton aiLayerButton, resetButton, labelButton, mrButton, recenterButton, hintButton, collaborativeButton;
        TextMesh guidanceText, badgeText, statusText, noticeText;
        readonly Dictionary<int, LineRenderer> lasers = new Dictionary<int, LineRenderer>();
        BoardButton hovered;

        static readonly Color InkC = Model.ParseColor(Model.Ink), Muted = Model.ParseColor("#708068");

        void Start()
        {
            if (view == null) view = GetComponentInChildren<BoardView>();
            if (input == null) input = FindAnyObjectByType<PointerInput>();
            if (rig == null) rig = FindAnyObjectByType<XRRig>();
            if (uiMaterial == null) uiMaterial = view.baseMaterial;
            view.Build();
            BuildToolbar();
            BuildSidePanel();
            switch (startMode)
            {
                case StartMode.CreateRoom: CreateRoom(serverUrl, displayName, roomTitle); break;
                case StartMode.JoinInvite: JoinRoom(inviteLink, displayName); break;
            }
            if (Session == null) UseSession(new LocalSession(displayName));
            if(GetComponent<LiveViewController>()==null)gameObject.AddComponent<LiveViewController>();
        }

        void OnDestroy() => Session?.Dispose();

        // ------------------------------------------------------------------ sessions
        public void UseSession(IBoardSession s)
        {
            if (Session != null)
            {
                Session.Changed -= OnChanged; Session.Error -= OnError;
                Session.PreviewReceived -= view.SetPreview; Session.CursorReceived -= view.SetCursor;
                Session.Dispose();
            }
            Session = s;
            s.Changed += OnChanged; s.Error += OnError;
            s.PreviewReceived += view.SetPreview; s.CursorReceived += view.SetCursor;
            dragObjects = null; draft = null; activePointer = -1;
            OnChanged();
            Notice(s.IsRemote ? "Joined room " + s.State.id + " as " + s.Me.name : "Local session — scripted practice guide only.");
        }

        // serverUrl may list several addresses ("http://192.168.137.1:4173, http://10.16.92.33:4173").
        // Each is probed quickly and the first that answers /api/health is used, so one build works on
        // the laptop's Windows hotspot (always 192.168.137.1) or on a shared Wi-Fi network.
        public void CreateRoom(string url, string name, string title)
        {
            var urls = (url ?? "").Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (urls.Length > 1) { StartCoroutine(PickServer(urls, u => { if (u != null) CreateRoom(u, name, title); else OnError("No Alongside server answered (" + string.Join(", ", urls) + "). Running offline: start the server, pause VPN, and put the Quest on the laptop's hotspot or Wi-Fi."); })); return; }
            if (urls.Length == 1) url = urls[0];
            Notice("Creating room on " + url + " …");
            ServerSession.Create(this, url, name, title, UseSession, e => { OnError(e); if (Session == null) UseSession(new LocalSession(displayName)); });
        }

        System.Collections.IEnumerator PickServer(string[] urls, Action<string> done)
        {
            foreach (var u in urls)
            {
                Notice("Looking for the Alongside server at " + u + " …");
                using (var r = UnityEngine.Networking.UnityWebRequest.Get(u.TrimEnd('/') + "/api/health"))
                {
                    r.timeout = 3;
                    yield return r.SendWebRequest();
                    if (r.result == UnityEngine.Networking.UnityWebRequest.Result.Success) { done(u); yield break; }
                }
            }
            done(null);
        }

        public void JoinRoom(string link, string name)
        {
            Notice("Joining …");
            ServerSession.Join(this, link, name, UseSession, e => { OnError(e); if (Session == null) UseSession(new LocalSession(displayName)); });
        }

        public void GoLocal() => UseSession(new LocalSession(displayName));

        void OnChanged()
        {
            if (Session == null) return;
            // A host can lock writing while another person is drawing. Discard that draft.
            if (!CanWrite) End(cancel: true);
            pendingMoveUntil = 0;
            if (activePointer < 0 || dragObjects == null) dragObjects = null;
            view.Render(Session.State, dragObjects ?? Session.State.objects);
            RefreshPanel();
        }

        void OnError(string e)
        {
            Debug.LogWarning("[Alongside] " + e);
            Notice(e);
        }

        public void Notice(string text, float seconds = 6)
        {
            LastNotice = text;
            noticeUntil = Time.time + seconds;
            if (noticeText != null) noticeText.text = Draw.Wrap(text, 40, 3);
        }

        // ------------------------------------------------------------------ actions (also used by the desktop panel)
        public void SetTool(string t)
        {
            Tool = t;
            foreach (var kv in toolButtons) kv.Value.SetActive(kv.Key == t);
            if (t == "label") Notice("Text: point at the board and pull the trigger to place \"" + LabelText + "\".", 4);
        }

        public void SetColor(string c)
        {
            InkColor = c;
            foreach (var kv in colorButtons) kv.Value.SetActive(kv.Key == c);
        }

        public void AskForHint(string prompt = "Show me the next step")
        {
            if (!Session.State.aiEnabled) { Notice("AI access is paused by the host."); return; }
            Session.AskAI(prompt);
            Notice(Session.IsRemote ? "Asking " + Session.AssistantName + " …" : "Scripted practice guide (not a live model).", 3);
        }

        public void ToggleCollaborativeWriting()
        {
            if (Session == null) return;
            if (!Session.Me.IsHost) { Notice("Only the host can change collaborative writing."); return; }
            Session.SetCollaborativeWriting(!Session.State.collaborativeWriting);
        }

        public void ToggleAILayer()
        {
            view.showAILayer = !view.showAILayer;
            view.Rerender();
            RefreshPanel();
        }

        public void ResetBoard()
        {
            if (!Session.Me.IsHost) { Notice("Only the host can reset the exercise."); return; }
            if (Time.time > resetArmedUntil) { resetArmedUntil = Time.time + 3; Notice("Press Reset again within 3 s to clear annotations, messages and tiles.", 3); return; }
            resetArmedUntil = 0;
            Session.Reset();
        }

        public string ExportBoard()
        {
            Directory.CreateDirectory(ExportDir);
            var path = Path.Combine(ExportDir, $"alongside-{Session.State.id}-{DateTime.Now:yyyyMMdd-HHmmss}.json");
            File.WriteAllText(path, Session.ExportJson());
            Notice("Exported board JSON → " + path, 8);
            return path;
        }

        public string SnapshotBoard()
        {
            Directory.CreateDirectory(ExportDir);
            var path = Path.Combine(ExportDir, $"alongside-{Session.State.id}-{DateTime.Now:yyyyMMdd-HHmmss}.png");
            File.WriteAllBytes(path, view.Snapshot());
            Notice("Snapshot PNG → " + path, 8);
            return path;
        }

        public void ImportBoard(string path)
        {
            if (!Session.Me.IsHost) { Notice("Only the host can import a board."); return; }
            if (string.IsNullOrWhiteSpace(path))
            {
                var latest = Directory.Exists(ExportDir) ? new DirectoryInfo(ExportDir).GetFiles("*.json").OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault() : null;
                if (latest == null) { Notice("No exported board found in " + ExportDir); return; }
                path = latest.FullName;
            }
            Session.ImportJson(File.ReadAllText(path));
            Notice("Imported " + Path.GetFileName(path), 5);
        }

        public void CycleLabel()
        {
            labelIndex = (labelIndex + 1) % labelPresets.Length;
            LabelText = labelPresets[labelIndex];
            RefreshPanel();
            SetTool("label");
        }

        // ------------------------------------------------------------------ frame loop
        void Update()
        {
            Session?.Tick();
            if (Session == null || input == null) return;
            HandleKeys();

            BoardButton newHover = null;
            var hitPointers = new HashSet<int>();
            foreach (var p in input.Pointers)
            {
                float laserLen = 3f;
                bool onButton = false;
                if (activePointer < 0 || activePointer == p.id)
                {
                    if (activePointer < 0 && Physics.Raycast(p.ray, out var hit, 20f))
                    {
                        var b = hit.collider.GetComponentInParent<BoardButton>();
                        if (b != null)
                        {
                            onButton = true; newHover = b; laserLen = hit.distance;
                            if (p.down) b.Click();
                        }
                    }
                    if (!onButton && view.TryHit(p.ray, out var bp, out float dist))
                    {
                        laserLen = dist;
                        hitPointers.Add(p.id);
                        if (p.down && activePointer < 0) Begin(p.id, bp);
                        else if (activePointer == p.id && p.held) Drag(bp);
                        if (Time.time > nextCursor && Session.IsRemote) { nextCursor = Time.time + 0.1f; Session.SendCursor(bp); }
                    }
                }
                if (activePointer == p.id && (p.up || !p.held)) End(cancel: false);
                if (p.secondaryDown && CanWrite) Session.Undo();
                if (p.visual != null) Laser(p, laserLen);
            }
            if (activePointer >= 0 && !input.Pointers.Any(p => p.id == activePointer)) End(cancel: true);
            if (hovered != newHover) { hovered?.SetHover(false); newHover?.SetHover(true); hovered = newHover; }
            foreach (var kv in lasers) if (!input.Pointers.Any(p => p.id == kv.Key)) kv.Value.enabled = false;

            if (pendingMoveUntil > 0 && Time.time > pendingMoveUntil) { pendingMoveUntil = 0; dragObjects = null; view.Render(Session.State, Session.State.objects); }
            if (noticeText != null && noticeUntil > 0 && Time.time > noticeUntil) { noticeUntil = 0; noticeText.text = ""; }
            if (statusText != null) statusText.text = Draw.Wrap(Session.StatusLine, 40, 2);
        }

        void Laser(PointerState p, float len)
        {
            if (!lasers.TryGetValue(p.id, out var lr))
            {
                var go = new GameObject("Laser " + p.id);
                lr = go.AddComponent<LineRenderer>();
                lr.sharedMaterial = Draw.Queued(view.baseMaterial, 3008);
                lr.widthMultiplier = 0.004f;
                lr.positionCount = 2;
                lr.useWorldSpace = true;
                lr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                lr.startColor = new Color(0.63f, 0.38f, 0.61f, 0.9f);
                lr.endColor = new Color(0.63f, 0.38f, 0.61f, 0.2f);
                lasers[p.id] = lr;
            }
            lr.enabled = true;
            lr.SetPosition(0, p.ray.origin);
            lr.SetPosition(1, p.ray.origin + p.ray.direction * len);
        }

        void Begin(int pointer, BPoint p)
        {
            var live = GetComponent<LiveViewController>();
            if(PointerInput.XRActive && live != null && live.AirInk) return;
            if (!CanWrite) { Notice("Collaborative writing is off. You can view and ask questions; only the host can edit."); return; }
            var objs = Session.State.objects;
            switch (Tool)
            {
                case "move":
                {
                    var o = Model.HitObject(objs, p);
                    if (o == null) return;
                    activePointer = pointer;
                    dragObjects = objs.Select(x => x.Clone()).ToList();
                    dragId = o.id; dragVersion = o.version;
                    dragOffset = new Vector2(o.x - p.x, o.y - p.y);
                    return;
                }
                case "label":
                    if (string.IsNullOrWhiteSpace(LabelText)) return;
                    Session.Add(new Annotation { type = "label", points = { p }, text = LabelText, color = InkColor, width = 4 });
                    return;
                case "erase":
                {
                    var target = Session.State.annotations
                        .Where(a => a.source != "ai" || view.showAILayer)
                        .Select(a => (a, d: Model.Distance(a, p, objs)))
                        .Where(x => x.d < 0.025f).OrderBy(x => x.d).Select(x => x.a).FirstOrDefault();
                    if (target == null) return;
                    if (target.ownerId != Session.Me.id && !Session.Me.IsHost) { Notice("You can erase your own marks; the host can erase any mark."); return; }
                    Session.Erase(target.id);
                    return;
                }
                default:
                    activePointer = pointer;
                    draft = new Annotation { type = Tool, color = InkColor, width = 4, ownerId = Session.Me.id, ownerName = Session.Me.name };
                    draft.points.Add(p);
                    if (Tool != "pen") draft.points.Add(p);
                    view.RenderDraft(draft, objs);
                    return;
            }
        }

        void Drag(BPoint p)
        {
            if (!CanWrite) { End(cancel: true); return; }
            if (dragObjects != null && dragId != null)
            {
                var o = dragObjects.First(x => x.id == dragId);
                o.x = Mathf.Clamp(p.x + dragOffset.x, 0.1f, 0.9f);
                o.y = Mathf.Clamp(p.y + dragOffset.y, 0.16f, 0.88f);
                view.Render(Session.State, dragObjects);
                return;
            }
            if (draft == null) return;
            if (draft.type == "pen")
            {
                var last = draft.points[draft.points.Count - 1];
                if (Mathf.Abs(last.x - p.x) + Mathf.Abs(last.y - p.y) < 0.002f) return;
                if (draft.points.Count >= Model.MaxPoints) draft.points.RemoveAt(0);
                draft.points.Add(p);
            }
            else draft.points[1] = p;
            view.RenderDraft(draft, Session.State.objects);
            if (Time.time > nextPreview) { nextPreview = Time.time + 0.066f; Session.SendPreview(draft); }
        }

        void End(bool cancel)
        {
            cancel = cancel || !CanWrite;
            int was = activePointer;
            activePointer = -1;
            if (was < 0) return;
            if (dragObjects != null && dragId != null)
            {
                var o = dragObjects.First(x => x.id == dragId);
                var orig = Session.State.objects.First(x => x.id == dragId);
                bool moved = Mathf.Abs(o.x - orig.x) + Mathf.Abs(o.y - orig.y) > 0.001f;
                var id = dragId; dragId = null;
                if (!cancel && moved)
                {
                    pendingMoveUntil = Time.time + 2f;
                    var label = o.label; bool nowPlaced = Model.Placed(o);
                    Session.Move(id, new BPoint(o.x, o.y), dragVersion);
                    if (!Session.IsRemote) dragObjects = null;
                    if (autoFeedback && Time.time - lastFeedback > 8f)
                    {
                        lastFeedback = Time.time;
                        AskForHint($"I just moved {label}{(nowPlaced ? " onto its outline" : "")}. What should I do next?");
                    }
                }
                else { dragObjects = null; view.Render(Session.State, Session.State.objects); }
                return;
            }
            if (draft != null)
            {
                var d = draft; draft = null;
                view.RenderDraft(null, Session.State.objects);
                Session.SendPreviewEnd();
                if (cancel) return;
                if (d.type != "pen")
                {
                    var a = d.points[0]; var b = d.points[1];
                    if (Mathf.Abs(a.x - b.x) + Mathf.Abs(a.y - b.y) < 0.006f) return; // a tap, not a shape
                }
                Session.Add(d);
            }
        }

        void HandleKeys()
        {
            if (Key("p")) SetTool("pen");
            if (Key("m")) SetTool("move");
            if (Key("a")) SetTool("arrow");
            if (Key("c")) SetTool("circle");
            if (Key("t")) SetTool("label");
            if (Key("e")) SetTool("erase");
            if (Key("z") && CanWrite) Session.Undo();
            if (Key("h")) AskForHint();
        }

        static bool Key(string k)
        {
            if (ConnectPanel.TypingFocus) return false;
#if ENABLE_INPUT_SYSTEM
            var kb = Keyboard.current;
            if (kb == null) return false;
            switch (k)
            {
                case "p": return kb.pKey.wasPressedThisFrame;
                case "m": return kb.mKey.wasPressedThisFrame;
                case "a": return kb.aKey.wasPressedThisFrame;
                case "c": return kb.cKey.wasPressedThisFrame;
                case "t": return kb.tKey.wasPressedThisFrame;
                case "e": return kb.eKey.wasPressedThisFrame;
                case "z": return kb.zKey.wasPressedThisFrame;
                case "h": return kb.hKey.wasPressedThisFrame;
            }
            return false;
#elif ENABLE_LEGACY_INPUT_MANAGER
            return Input.GetKeyDown(k);
#else
            return false;
#endif
        }

        // ------------------------------------------------------------------ in-world UI
        void BuildToolbar()
        {
            var bar = new GameObject("Toolbar").transform;
            bar.SetParent(view.transform, false);
            bar.localPosition = new Vector3(0, -BoardView.H / 2 - 0.085f, -0.01f);
            var size = new Vector2(0.138f, 0.085f);
            float x = -BoardView.W / 2 + size.x / 2;
            float step = size.x + 0.012f;
            void Add(string key, string label, Action a, Dictionary<string, BoardButton> into = null, bool writes = false)
            {
                var b = BoardButton.Create(bar, label, new Vector3(x, 0, 0), size, uiMaterial, a, 0.03f);
                if (into != null) into[key] = b;
                if (writes) writeButtons.Add(b);
                x += step;
            }
            Add("pen", "Pen", () => SetTool("pen"), toolButtons);
            Add("move", "Move", () => SetTool("move"), toolButtons);
            Add("arrow", "Arrow", () => SetTool("arrow"), toolButtons);
            Add("circle", "Circle", () => SetTool("circle"), toolButtons);
            Add("label", "Text", () => SetTool("label"), toolButtons);
            Add("erase", "Erase", () => SetTool("erase"), toolButtons);
            foreach (var c in Model.Colors.Take(4))
            {
                var col = c;
                var b = BoardButton.Create(bar, "", new Vector3(x - step / 2 + 0.045f, 0, 0), new Vector2(0.075f, 0.085f), uiMaterial, () => SetColor(col));
                b.swatch = Model.ParseColor(col);
                b.SetActive(true); b.SetActive(false);
                colorButtons[col] = b;
                x += 0.087f;
            }
            x += step / 2 - 0.045f + 0.012f;
            Add(null, "Undo", () => Session.Undo(), writes: true);
            Add(null, "Clear mine", () => Session.ClearMine(), writes: true);
            resetButton = BoardButton.Create(bar, "Reset", new Vector3(x, 0, 0), size, uiMaterial, ResetBoard, 0.03f); x += step;
            Add(null, "Export", () => ExportBoard());
            Add(null, "Snapshot", () => SnapshotBoard());
            SetTool("pen");
            SetColor(Model.Colors[0]);
        }

        void BuildSidePanel()
        {
            var panel = new GameObject("Perspective Panel").transform;
            panel.SetParent(view.transform, false);
            float pw = 0.82f, ph = BoardView.H + 0.2f;
            panel.localPosition = new Vector3(BoardView.W / 2 + 0.08f + pw / 2 * Mathf.Cos(25 * Mathf.Deg2Rad), -0.1f, -pw / 2 * Mathf.Sin(25 * Mathf.Deg2Rad));
            panel.localRotation = Quaternion.Euler(0, 25, 0);
            var bg = Draw.MeshObject(panel, "Background", uiMaterial, 3000).Item1;
            var mb = new MeshBuilder();
            mb.RoundedRect(Vector2.zero, new Vector2(pw + 0.012f, ph + 0.012f), 0.03f, Model.ParseColor("#dfe4d5"), 0.001f);
            mb.RoundedRect(Vector2.zero, new Vector2(pw, ph), 0.028f, Model.ParseColor("#f8f7f0"), 0);
            mb.Apply(bg.sharedMesh);

            float left = -pw / 2 + 0.05f, top = ph / 2 - 0.07f;
            Draw.Text(panel, "Star", "✳", new Vector3(left, top, -0.003f), 0.06f, Model.ParseColor(Model.AIColor), TextAnchor.MiddleLeft);
            Draw.Text(panel, "Kicker", "ANOTHER PERSPECTIVE", new Vector3(left, top - 0.07f, -0.003f), 0.024f, Muted, TextAnchor.MiddleLeft);
            Draw.Text(panel, "Headline", "Not just an answer.\nSomething you can point to.", new Vector3(left, top - 0.1f, -0.003f), 0.042f, InkC, TextAnchor.UpperLeft);
            badgeText = Draw.Text(panel, "Badge", "", new Vector3(left, top - 0.25f, -0.003f), 0.022f, Model.ParseColor("#837861"), TextAnchor.MiddleLeft);

            hintButton = BoardButton.Create(panel, "Show me the next step  ↗", new Vector3(0, top - 0.33f, -0.004f), new Vector2(pw - 0.1f, 0.09f), uiMaterial, () => AskForHint(), 0.028f);
            hintButton.SetColors(InkC, Color.white);

            guidanceText = Draw.Text(panel, "Guidance", "", new Vector3(left, top - 0.42f, -0.003f), 0.03f, Muted, TextAnchor.UpperLeft);

            float by = -ph / 2 + 0.33f, bw = (pw - 0.12f) / 2;
            collaborativeButton = BoardButton.Create(panel, "Collaborative writing: ON", new Vector3(0, by + 0.1f, -0.004f), new Vector2(pw - 0.1f, 0.075f), uiMaterial, ToggleCollaborativeWriting, 0.026f);
            labelButton = BoardButton.Create(panel, "Label: Look here", new Vector3(-bw / 2 - 0.01f, by, -0.004f), new Vector2(bw, 0.075f), uiMaterial, CycleLabel, 0.026f);
            aiLayerButton = BoardButton.Create(panel, "AI layer: on", new Vector3(bw / 2 + 0.01f, by, -0.004f), new Vector2(bw, 0.075f), uiMaterial, ToggleAILayer, 0.026f);
            recenterButton = BoardButton.Create(panel, "Recenter", new Vector3(-bw / 2 - 0.01f, by - 0.09f, -0.004f), new Vector2(bw, 0.075f), uiMaterial, () => rig?.Recenter(), 0.026f);
            mrButton = BoardButton.Create(panel, "Mixed reality", new Vector3(bw / 2 + 0.01f, by - 0.09f, -0.004f), new Vector2(bw, 0.075f), uiMaterial, () => { rig?.SetMixedReality(!(rig?.MixedReality ?? false)); RefreshPanel(); }, 0.026f);
            statusText = Draw.Text(panel, "Status", "", new Vector3(left, -ph / 2 + 0.17f, -0.003f), 0.022f, Muted, TextAnchor.UpperLeft);
            noticeText = Draw.Text(panel, "Notice", "", new Vector3(left, -ph / 2 + 0.1f, -0.003f), 0.022f, Model.ParseColor("#9a806a"), TextAnchor.UpperLeft);
        }

        void RefreshPanel()
        {
            if (Session == null || guidanceText == null) return;
            var s = Session.State;
            bool live = Session.IsRemote && Session is ServerSession ss && ss.AssistantProvider != "demo";
            badgeText.text = live ? (((ServerSession)Session).AssistantProvider.ToUpperInvariant() + " · YOUR CONNECTION · " + Session.AssistantName) : "SCRIPTED PRACTICE · NOT A LIVE MODEL";
            var lastAI = s.messages.LastOrDefault(m => m.source == "ai");
            var lastHuman = s.messages.LastOrDefault(m => m.source != "ai");
            string body = lastAI != null ? lastAI.author + ": " + lastAI.text
                : "Draw on the board, or choose Move and drag a tile to its outline. " + s.task;
            if (!s.aiEnabled) body = "AI access is paused by the host.\n\n" + body;
            if (lastHuman != null && (lastAI == null || lastHuman.at > lastAI.at)) body = lastHuman.author + ": " + lastHuman.text + "\n\n" + body;
            if (!s.collaborativeWriting)
                body = (CanWrite ? "HOST-ONLY WRITING. You can still edit.\n\n" : "READ-ONLY BOARD. Viewing and guidance remain available.\n\n") + body;
            guidanceText.text = Draw.Wrap(body, 40, 11);
            collaborativeButton.Label = "Collaborative writing: " + (s.collaborativeWriting ? "ON" : "OFF");
            collaborativeButton.SetActive(s.collaborativeWriting);
            collaborativeButton.SetInteractable(Session.Me.IsHost);
            foreach (var b in toolButtons.Values) b.SetInteractable(CanWrite);
            foreach (var b in writeButtons) b.SetInteractable(CanWrite);
            labelButton.SetInteractable(CanWrite);
            aiLayerButton.Label = "AI layer: " + (view.showAILayer ? "on" : "off");
            aiLayerButton.SetActive(view.showAILayer);
            labelButton.Label = "Label: " + LabelText;
            resetButton.SetInteractable(Session.Me.IsHost);
            hintButton.SetInteractable(s.aiEnabled);
            bool xr = PointerInput.XRActive;
            recenterButton.SetInteractable(xr);
            mrButton.SetInteractable(xr);
            mrButton.Label = rig != null && rig.MixedReality ? "Enter VR" : "Mixed reality";
        }
    }
}
