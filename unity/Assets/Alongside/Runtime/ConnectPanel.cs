// Alongside for Unity — desktop overlay (Tab to toggle): rooms, invitations, AI connections, MCP tokens, import/export.
// In the headset use BoardController's start-up fields instead (Local / CreateRoom / JoinInvite).
using UnityEngine;

namespace Alongside
{
    public class ConnectPanel : MonoBehaviour
    {
        public BoardController controller;
        public bool visible = true;
        public static bool TypingFocus { get; private set; }
        static Rect screenRect;
        /// True when a screen position (bottom-left origin) is over the panel, so board input is ignored.
        public static bool Covers(Vector2 screenPos) => screenRect.width > 0 && screenRect.Contains(new Vector2(screenPos.x, Screen.height - screenPos.y));

        string serverUrl, displayName, roomTitle, invite = "", importPath = "";
        string provider = "demo", model = "", apiKey = "", assistantName = "My assistant", instructions = "", agentName = "External agent";
        string ask = "Show me the next step", chat = "", result = "";
        int tab;
        Vector2 scroll;
        static readonly string[] Tabs = { "Room", "AI", "MCP", "Board" };
        static readonly string[] Providers = { "demo", "openai", "anthropic" };

        void Start()
        {
            if (controller == null) controller = FindAnyObjectByType<BoardController>();
            serverUrl = controller.serverUrl;
            displayName = controller.displayName;
            roomTitle = controller.roomTitle;
            invite = controller.inviteLink;
        }

        void Update()
        {
#if ENABLE_INPUT_SYSTEM
            var kb = UnityEngine.InputSystem.Keyboard.current;
            if (kb != null && kb.tabKey.wasPressedThisFrame) visible = !visible;
#elif ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.Tab)) visible = !visible;
#endif
        }

        void OnGUI()
        {
            TypingFocus = false;
            screenRect = default;
            if (PointerInput.XRActive || controller == null || controller.Session == null) return;
            if (!visible) { GUI.Label(new Rect(10, 10, 300, 22), "Tab: Alongside panel"); return; }
            screenRect = new Rect(10, 10, 360, Screen.height - 20);
            var s = controller.Session;
            GUILayout.BeginArea(new Rect(10, 10, 360, Screen.height - 20), GUI.skin.box);
            GUILayout.Label("<b>◌ alongside.</b>  " + s.StatusLine, new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true });
            bool wasEnabled = GUI.enabled;
            GUI.enabled = wasEnabled && s.Me.IsHost;
            bool collaborative = GUILayout.Toggle(s.State.collaborativeWriting, "Collaborative writing (host control)");
            GUI.enabled = wasEnabled;
            if (collaborative != s.State.collaborativeWriting) s.SetCollaborativeWriting(collaborative);
            GUILayout.Label(s.State.collaborativeWriting ? "ON: people and authorized AI can edit." : "OFF: host-only board editing. Viewing and guidance stay on.", new GUIStyle(GUI.skin.label) { wordWrap = true });
            tab = GUILayout.Toolbar(tab, Tabs);
            scroll = GUILayout.BeginScrollView(scroll);
            var server = s as ServerSession;
            switch (tab)
            {
                case 0:
                    GUILayout.Label("Your name"); displayName = GUILayout.TextField(displayName, 48);
                    GUILayout.Label("Server (Alongside Node app)"); serverUrl = GUILayout.TextField(serverUrl);
                    GUILayout.Label("Room title"); roomTitle = GUILayout.TextField(roomTitle, 48);
                    if (GUILayout.Button("Create room on server")) { controller.displayName = displayName; controller.CreateRoom(serverUrl, displayName, roomTitle); }
                    GUILayout.Space(6);
                    GUILayout.Label("Invitation link (…/#room=…&invite=…)"); invite = GUILayout.TextField(invite);
                    if (GUILayout.Button("Join with invitation")) { controller.displayName = displayName; controller.JoinRoom(invite, displayName); }
                    if (GUILayout.Button("Work locally (offline)")) controller.GoLocal();
                    if (server != null)
                    {
                        GUILayout.Space(6);
                        GUILayout.Label("Invite others — open in a browser, iPad or Quest Browser:");
                        GUILayout.TextArea(server.InviteLink ?? "(only the host's invite is known; rotate to get a new one)");
                        if (GUILayout.Button("Copy invite link")) GUIUtility.systemCopyBuffer = server.InviteLink ?? "";
                        if (s.Me.IsHost && GUILayout.Button("Rotate invitation (old links stop working)"))
                            server.RotateInvite(l => { result = "New invitation:\n" + l; GUIUtility.systemCopyBuffer = l; }, e => result = e);
                        GUILayout.Label("Online: " + string.Join(", ", server.Online.ConvertAll(m => m.name)));
                    }
                    break;
                case 1:
                    GUILayout.Label("Assistant: " + s.AssistantName);
                    GUILayout.Label("Ask"); ask = GUILayout.TextField(ask, 2000);
                    if (GUILayout.Button("Ask / Show me the next step")) controller.AskForHint(ask);
                    GUILayout.Label("Message the room"); chat = GUILayout.TextField(chat, 2000);
                    if (GUILayout.Button("Send message") && chat.Trim().Length > 0) { s.SendMessage(chat); chat = ""; }
                    controller.autoFeedback = GUILayout.Toggle(controller.autoFeedback, "Automatic feedback after tile moves");
                    if (s.Me.IsHost && GUILayout.Button(s.State.aiEnabled ? "Pause AI access (host)" : "Resume AI access (host)")) s.SetAIEnabled(!s.State.aiEnabled);
                    GUILayout.Space(8);
                    if (server == null) { GUILayout.Label("Connect to an Alongside server to use OpenAI / Anthropic. Offline, the clearly labelled scripted practice guide is used."); break; }
                    GUILayout.Label("<b>AI connection</b> — your key goes to this server's memory only. Use a server you trust.", new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true });
                    provider = Providers[GUILayout.Toolbar(System.Array.IndexOf(Providers, provider), Providers)];
                    if (provider != "demo")
                    {
                        GUILayout.Label("Exact model ID enabled on your account"); model = GUILayout.TextField(model, 100);
                        GUILayout.Label("API key"); apiKey = GUILayout.PasswordField(apiKey, '•', 300);
                        GUILayout.Label("Assistant name"); assistantName = GUILayout.TextField(assistantName, 48);
                        GUILayout.Label("Coaching preference (optional)"); instructions = GUILayout.TextArea(instructions, 2000, GUILayout.Height(50));
                    }
                    if (GUILayout.Button("Authorize for this shared room")) server.ConfigureAI(provider, model, apiKey, assistantName, instructions, r => { result = r; apiKey = ""; });
                    if (GUILayout.Button("Disconnect assistant")) server.DisconnectAI(r => result = r);
                    break;
                case 2:
                    if (server == null) { GUILayout.Label("MCP agent tokens are issued by the Alongside server. Create or join a room first."); break; }
                    GUILayout.Label("Issue an 8-hour, room-scoped MCP token for an external agent (stateless Streamable HTTP, POST only). The agent must poll get_scene_state itself.", new GUIStyle(GUI.skin.label) { wordWrap = true });
                    GUILayout.Label("Agent name"); agentName = GUILayout.TextField(agentName, 48);
                    if (GUILayout.Button("Issue MCP token"))
                        server.IssueAgentToken(agentName, (endpoint, token, exp) => { result = "Endpoint: " + endpoint + "\nAuthorization: Bearer " + token + "\nExpires: " + System.DateTimeOffset.FromUnixTimeMilliseconds(exp).ToLocalTime(); GUIUtility.systemCopyBuffer = token; }, e => result = e);
                    break;
                case 3:
                    if (GUILayout.Button("Export board JSON")) result = controller.ExportBoard();
                    if (GUILayout.Button("Snapshot PNG")) result = controller.SnapshotBoard();
                    GUILayout.Label("Import JSON (blank = newest export)"); importPath = GUILayout.TextField(importPath);
                    if (GUILayout.Button("Import board (host, replaces content)")) controller.ImportBoard(importPath);
                    GUILayout.Label("Exports folder: " + controller.ExportDir, new GUIStyle(GUI.skin.label) { wordWrap = true });
                    if (GUILayout.Button("Reset exercise (host)")) controller.ResetBoard();
                    GUILayout.Label("Label text"); controller.LabelText = GUILayout.TextField(controller.LabelText, 240);
                    GUILayout.Label("Keys: P pen · M move · A arrow · C circle · T text · E erase · Z undo · H hint · right-click undo");
                    break;
            }
            if (!string.IsNullOrEmpty(result)) GUILayout.TextArea(result);
            if (!string.IsNullOrEmpty(controller.LastNotice)) GUILayout.Label(controller.LastNotice, new GUIStyle(GUI.skin.label) { wordWrap = true });
            GUILayout.EndScrollView();
            GUILayout.EndArea();
            TypingFocus = GUIUtility.keyboardControl != 0;
        }
    }
}
