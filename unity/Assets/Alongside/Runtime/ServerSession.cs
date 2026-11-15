// Alongside for Unity — live session against the Alongside Node server (REST + /live WebSocket).
// Protocol mirrors server/index.js: humans authenticate with a room-scoped bearer token.
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;
using Dict = System.Collections.Generic.Dictionary<string, object>;

namespace Alongside
{
    public partial class ServerSession : IBoardSession
    {
        public BoardState State { get; private set; }
        public Member Me { get; private set; }
        public bool IsRemote => true;
        public string BaseUrl { get; }
        public string RoomId { get; }
        public string Invite { get; private set; }
        public string AssistantName { get; private set; } = "Practice guide (scripted)";
        public string AssistantProvider { get; private set; } = "demo";
        public List<Member> Online { get; private set; } = new List<Member>();
        public string StatusLine => $"ROOM {RoomId} · {(connected ? "live" : "reconnecting…")} · {Online.Count} online";
        public string InviteLink => string.IsNullOrEmpty(Invite) ? null : BaseUrl + "/#room=" + RoomId + "&invite=" + Uri.EscapeDataString(Invite) + "&view=live";

        public event Action Changed;
        public event Action<string> Error;
        public event Action<string, Annotation> PreviewReceived;
        public event Action<Member, BPoint> CursorReceived;
        public event Action<List<Member>> PresenceChanged;

        readonly MonoBehaviour runner;
        readonly string token;
        readonly ConcurrentQueue<string> inbox = new ConcurrentQueue<string>();
        readonly ConcurrentQueue<string> errors = new ConcurrentQueue<string>();
        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);
        readonly CancellationTokenSource cts = new CancellationTokenSource();
        ClientWebSocket ws;
        volatile bool connected;
        bool disposed;

        ServerSession(MonoBehaviour runner, string baseUrl, Dict joinResponse, string invite)
        {
            this.runner = runner;
            BaseUrl = baseUrl.TrimEnd('/');
            token = (string)joinResponse["token"];
            Invite = joinResponse.TryGetValue("invite", out var inv) && inv != null ? (string)inv : invite;
            Me = Model.MemberFrom((Dict)joinResponse["member"]);
            State = Model.StateFrom((Dict)joinResponse["room"]);
            RoomId = State.id;
            _ = SocketLoop();
            runner.StartCoroutine(Http("GET", Room("/ai"), null, d => ApplyAIStatus(d as Dict), _ => { }));
        }

        // ------------------------------------------------------------------ factory
        public static void Create(MonoBehaviour runner, string baseUrl, string name, string title, Action<ServerSession> ok, Action<string> fail)
        {
            baseUrl = baseUrl.TrimEnd('/');
            runner.StartCoroutine(Request(baseUrl, null, "POST", "/api/rooms", new Dict { ["name"] = name, ["title"] = string.IsNullOrWhiteSpace(title) ? "Shared studio" : title },
                d => ok(new ServerSession(runner, baseUrl, (Dict)d, null)), fail));
        }

        public static void Join(MonoBehaviour runner, string inviteLink, string name, Action<ServerSession> ok, Action<string> fail)
        {
            if (!TryParseInvite(inviteLink, out var baseUrl, out var room, out var invite)) { fail("That doesn't look like an Alongside invitation link (…/#room=ABC123&invite=…)."); return; }
            runner.StartCoroutine(Request(baseUrl, null, "POST", "/api/rooms/" + room + "/join", new Dict { ["name"] = name, ["invite"] = invite },
                d => ok(new ServerSession(runner, baseUrl, (Dict)d, invite)), fail));
        }

        public static bool TryParseInvite(string link, out string baseUrl, out string room, out string invite)
        {
            baseUrl = room = invite = null;
            if (string.IsNullOrWhiteSpace(link)) return false;
            link = link.Trim();
            int hash = link.IndexOf('#');
            if (hash < 0) return false;
            baseUrl = link.Substring(0, hash).TrimEnd('/');
            foreach (var part in link.Substring(hash + 1).Split('&'))
            {
                var kv = part.Split(new[] { '=' }, 2);
                if (kv.Length != 2) continue;
                if (kv[0] == "room") room = Uri.UnescapeDataString(kv[1]);
                if (kv[0] == "invite") invite = Uri.UnescapeDataString(kv[1]);
            }
            return !string.IsNullOrEmpty(baseUrl) && !string.IsNullOrEmpty(room) && !string.IsNullOrEmpty(invite);
        }

        // ------------------------------------------------------------------ HTTP
        string Room(string suffix) => "/api/rooms/" + RoomId + suffix;

        IEnumerator Http(string method, string path, object body, Action<object> ok, Action<string> fail) => Request(BaseUrl, token, method, path, body, ok, fail);

        static IEnumerator Request(string baseUrl, string bearer, string method, string path, object body, Action<object> ok, Action<string> fail)
        {
            using (var req = new UnityWebRequest(baseUrl + path, method))
            {
                req.downloadHandler = new DownloadHandlerBuffer();
                if (body != null)
                {
                    var raw = body as string ?? Json.Serialize(body, false);
                    req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(raw));
                    req.SetRequestHeader("Content-Type", "application/json");
                }
                if (bearer != null) req.SetRequestHeader("Authorization", "Bearer " + bearer);
                req.timeout = 60;
                yield return req.SendWebRequest();
                string text = req.downloadHandler.text;
                object parsed = null;
                try { if (!string.IsNullOrEmpty(text)) parsed = Json.Parse(text); } catch { }
                if (req.result == UnityWebRequest.Result.Success) { ok?.Invoke(parsed); yield break; }
                string msg = parsed is Dict e && e.TryGetValue("error", out var er) ? Convert.ToString(er) : req.error;
                if (req.responseCode == 0) msg = "Cannot reach " + baseUrl + " (" + req.error + "). Is the Alongside server running and reachable from this device?";
                fail?.Invoke(msg);
            }
        }

        void Post(Dict action)
        {
            var type = action["type"] as string;
            if (new[] { "add", "undo", "erase", "clearMine", "move" }.Contains(type) && !Model.CanWrite(State, Me))
            { Fail("Collaborative writing is off. Only the host can edit the board."); return; }
            if (type == "collaborativeWriting" && !Me.IsHost)
            { Fail("Only the host can change collaborative writing."); return; }
            runner.StartCoroutine(Http("POST", Room("/actions"), action, null, Fail));
        }
        void Fail(string e) => Error?.Invoke(e);

        // ------------------------------------------------------------------ board actions
        public void Add(Annotation a)
        {
            try { Model.Validate(a); } catch (Exception e) { Fail(e.Message); return; }
            Post(new Dict { ["type"] = "add", ["annotation"] = Model.AnnotationWire(a) });
        }
        public void Undo() => Post(new Dict { ["type"] = "undo" });
        public void Erase(string id) => Post(new Dict { ["type"] = "erase", ["id"] = id });
        public void ClearMine() => Post(new Dict { ["type"] = "clearMine" });
        public void Move(string id, BPoint p, int version) => Post(new Dict { ["type"] = "move", ["id"] = id, ["version"] = version, ["position"] = new Dict { ["x"] = Mathf.Clamp01(p.x), ["y"] = Mathf.Clamp01(p.y) } });
        public void Reset() => Post(new Dict { ["type"] = "reset" });
        public void SetAIEnabled(bool enabled) => Post(new Dict { ["type"] = "aiEnabled", ["value"] = enabled });
        public void SetCollaborativeWriting(bool enabled) => Post(new Dict { ["type"] = "collaborativeWriting", ["value"] = enabled });
        public void SendMessage(string text) => Post(new Dict { ["type"] = "message", ["text"] = text });
        public void AskAI(string prompt) => runner.StartCoroutine(Http("POST", Room("/ai/ask"), new Dict { ["prompt"] = string.IsNullOrWhiteSpace(prompt) ? "Show me the next step" : prompt }, null, Fail));
        public string ExportJson() => Model.Export(State);
        public void ImportJson(string json) => runner.StartCoroutine(Http("POST", Room("/import"), json, null, e => Fail("Import failed: " + e)));

        // ------------------------------------------------------------------ AI connections & MCP (host/member panel)
        public void ConfigureAI(string provider, string model, string apiKey, string name, string instructions, Action<string> done)
        {
            var body = new Dict { ["provider"] = provider, ["model"] = model ?? "", ["apiKey"] = apiKey ?? "", ["name"] = string.IsNullOrWhiteSpace(name) ? "My assistant" : name, ["instructions"] = instructions ?? "", ["consent"] = true };
            runner.StartCoroutine(Http("PUT", Room("/ai"), body, d => { ApplyAIStatus(d as Dict); done?.Invoke("Connected: " + AssistantName + (provider == "demo" ? "" : " — validate one real question before relying on it.")); }, e => done?.Invoke("Failed: " + e)));
        }

        public void DisconnectAI(Action<string> done) =>
            runner.StartCoroutine(Http("DELETE", Room("/ai"), null, _ => { AssistantProvider = "demo"; AssistantName = "Practice guide (scripted)"; done?.Invoke("Disconnected"); }, e => done?.Invoke("Failed: " + e)));

        void ApplyAIStatus(Dict d)
        {
            if (d == null) return;
            if (d.TryGetValue("provider", out var p) && p != null) AssistantProvider = p.ToString();
            if (d.TryGetValue("name", out var n) && n != null) AssistantName = n.ToString();
            Changed?.Invoke();
        }

        public void IssueAgentToken(string name, Action<string, string, long> ok, Action<string> fail) =>
            runner.StartCoroutine(Http("POST", Room("/agents"), new Dict { ["name"] = string.IsNullOrWhiteSpace(name) ? "External agent" : name },
                d => { var r = (Dict)d; ok(BaseUrl + (string)r["mcpPath"], (string)r["token"], Convert.ToInt64(r["expires"])); }, fail));

        public void RotateInvite(Action<string> ok, Action<string> fail) =>
            runner.StartCoroutine(Http("POST", Room("/invite"), new Dict(), d => { Invite = (string)((Dict)d)["invite"]; ok(InviteLink); }, fail));

        // ------------------------------------------------------------------ live socket
        public void SendPreview(Annotation a)
        {
            if (!Model.CanWrite(State, Me)) return;
            try { Model.Validate(a); } catch { return; }
            Send(new Dict { ["type"] = "preview", ["annotation"] = Model.AnnotationWire(a) });
        }
        public void SendPreviewEnd() => Send(new Dict { ["type"] = "previewEnd" });
        public void SendCursor(BPoint p) => Send(new Dict { ["type"] = "cursor", ["point"] = new Dict { ["x"] = Mathf.Clamp01(p.x), ["y"] = Mathf.Clamp01(p.y) } });

        void Send(Dict msg)
        {
            if (!connected) return;
            var bytes = Encoding.UTF8.GetBytes(Json.Serialize(msg, false));
            _ = SendRaw(bytes);
        }

        async Task SendRaw(byte[] bytes)
        {
            var socket = ws;
            if (socket == null) return;
            await sendLock.WaitAsync();
            try { if (socket.State == WebSocketState.Open) await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cts.Token); }
            catch { }
            finally { sendLock.Release(); }
        }

        async Task SocketLoop()
        {
            var uri = new Uri((BaseUrl.StartsWith("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws") + BaseUrl.Substring(BaseUrl.IndexOf("://", StringComparison.Ordinal)) + "/live");
            int delay = 1000;
            while (!cts.IsCancellationRequested)
            {
                try
                {
                    ws = new ClientWebSocket();
                    await ws.ConnectAsync(uri, cts.Token);
                    await SendRaw(Encoding.UTF8.GetBytes(Json.Serialize(new Dict { ["type"] = "auth", ["room"] = RoomId, ["token"] = token }, false)));
                    connected = true;
                    delay = 1000;
                    var buffer = new byte[64 * 1024];
                    using (var message = new System.IO.MemoryStream())
                    while (ws.State == WebSocketState.Open && !cts.IsCancellationRequested)
                    {
                        var r = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                        if (r.MessageType == WebSocketMessageType.Close) break;
                        if(r.MessageType==WebSocketMessageType.Binary)continue; // publisher never subscribes to its own frames
                        message.Write(buffer,0,r.Count);
                        if(message.Length>8000000)throw new Exception("Room message too large");
                        if (r.EndOfMessage) { inbox.Enqueue(Encoding.UTF8.GetString(message.ToArray())); message.SetLength(0); }
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (Exception e) { errors.Enqueue("Live connection: " + e.Message); }
                connected = false;
                try { ws?.Dispose(); } catch { }
                if (cts.IsCancellationRequested) break;
                await Task.Delay(delay);
                delay = Math.Min(delay * 2, 15000);
            }
        }

        public void Tick()
        {
            while (errors.TryDequeue(out var e)) Debug.LogWarning("[Alongside] " + e);
            int n = 0;
            while (n++ < 200 && inbox.TryDequeue(out var raw))
            {
                Dict msg;
                try { msg = Json.Parse(raw) as Dict; } catch { continue; }
                if (msg == null || !msg.TryGetValue("type", out var t)) continue;
                switch (t as string)
                {
                    case "state":
                        State = Model.StateFrom((Dict)msg["state"]);
                        Changed?.Invoke();
                        break;
                    case "preview":
                        PreviewReceived?.Invoke(msg["ownerId"] as string, Model.AnnotationFrom((Dict)msg["annotation"]));
                        break;
                    case "previewEnd":
                        PreviewReceived?.Invoke(msg.TryGetValue("ownerId", out var o) ? o as string : null, null);
                        break;
                    case "cursor":
                        CursorReceived?.Invoke(Model.MemberFrom((Dict)msg["member"]), Model.PointFrom(msg["point"]));
                        break;
                    case "presence":
                        Online = ((List<object>)msg["members"]).Cast<Dict>().Select(Model.MemberFrom).ToList();
                        PresenceChanged?.Invoke(Online);
                        break;
                    case "error":
                        Fail(msg["error"] as string);
                        break;
                    default:
                        LiveMessage?.Invoke(msg);
                        break;
                }
            }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            cts.Cancel();
            try { ws?.Abort(); } catch { }
        }
    }
}
