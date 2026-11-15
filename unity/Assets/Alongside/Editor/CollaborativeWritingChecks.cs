// Manual Unity-side checks. These do not run automatically when importing the project.
using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Alongside.Editor
{
    public static class CollaborativeWritingChecks
    {
        [MenuItem("Alongside/Validate Collaborative Writing")]
        public static void Run()
        {
            int checks = 0;
            void Require(bool condition, string message)
            {
                if (!condition) throw new InvalidOperationException("Collaborative writing check failed: " + message);
                checks++;
            }

            var state = new BoardState();
            var host = new Member { id = "host", name = "Host", role = "host" };
            var guest = new Member { id = "guest", name = "Guest", role = "member" };
            Require(state.collaborativeWriting, "New board defaults ON");
            Require(Model.CanWrite(state, guest), "Guest can write when ON");
            state.collaborativeWriting = false;
            Require(Model.CanWrite(state, host), "Host can write when OFF");
            Require(!Model.CanWrite(state, guest), "Guest cannot write when OFF");
            var wire = new Dictionary<string, object> { ["id"] = "TEST", ["collaborativeWriting"] = false };
            Require(!Model.StateFrom(wire).collaborativeWriting, "Server false maps to Unity false");
            wire.Remove("collaborativeWriting");
            Require(Model.StateFrom(wire).collaborativeWriting, "Legacy snapshots default ON");

            using (var local = new LocalSession("Host"))
            {
                string error = null;
                local.Error += text => error = text;
                local.AskAI("Show me the next step");
                int originalMarks = local.State.annotations.Count;
                Require(originalMarks == 2, "Practice guide draws while ON");
                local.SetCollaborativeWriting(false);
                Require(!local.State.collaborativeWriting, "Offline host can toggle OFF");
                local.AskAI("Help without drawing");
                Require(local.State.annotations.Count == originalMarks, "OFF does not add or erase AI marks");
                Require(local.State.messages[local.State.messages.Count - 1].text.Contains("guidance only"), "OFF keeps text guidance");
                local.Add(new Annotation { points = new List<BPoint> { new BPoint(0.1f, 0.2f), new BPoint(0.2f, 0.3f) } });
                Require(local.State.annotations.Count == originalMarks + 1, "Offline host retains drawing access");
                local.SetCollaborativeWriting(true);
                Require(local.State.collaborativeWriting, "Offline host can toggle ON again");
                Require(error == null, "Offline toggle and guide produce no errors");
            }
            Debug.Log("[Alongside] Collaborative writing: " + checks + " manual Unity checks passed. Network/headset checks are separate.");
        }
    }
}
