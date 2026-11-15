// Alongside for Unity — minimal XR rig: head tracking, floor origin, VR / mixed-reality (passthrough) switch.
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace Alongside
{
    public class XRRig : MonoBehaviour
    {
        public Camera head;
        [Tooltip("Desktop camera pose used when no headset is active.")]
        public Vector3 desktopPosition = new Vector3(0.35f, 1.35f, -0.55f);
        public Vector3 desktopLookAt = new Vector3(0.35f, 1.3f, 2f);
        [Tooltip("Board and panels placed in front of the wearer when the headset starts.")]
        public Transform worldContent;
        public float contentDistance = 2.0f;
        public Color vrBackground = new Color(0.937f, 0.929f, 0.898f);

        public bool MixedReality { get; private set; }
        bool placed, wasXR;
        static readonly List<XRInputSubsystem> subsystems = new List<XRInputSubsystem>();

        void OnEnable() { Application.onBeforeRender += UpdateHead; }
        void OnDisable() { Application.onBeforeRender -= UpdateHead; }

        void Start()
        {
            if (head == null) head = Camera.main;
            if (!PointerInput.XRActive) head.transform.SetPositionAndRotation(desktopPosition, Quaternion.LookRotation(desktopLookAt - desktopPosition));
            ApplyBackground();
        }

        void Update()
        {
            bool xr = PointerInput.XRActive;
            if (xr && !wasXR)
            {
                SubsystemManager.GetSubsystems(subsystems);
                foreach (var s in subsystems) s.TrySetTrackingOriginMode(TrackingOriginModeFlags.Floor);
                placed = false;
            }
            wasXR = xr;
            UpdateHead();
            if (xr && !placed && TryHeadPose(out var p, out _)) { Recenter(); placed = true; }
        }

        void UpdateHead()
        {
            if (!PointerInput.XRActive || head == null) return;
            if (TryHeadPose(out var pos, out var rot)) head.transform.SetLocalPositionAndRotation(pos, rot);
        }

        static bool TryHeadPose(out Vector3 pos, out Quaternion rot)
        {
            pos = default; rot = Quaternion.identity;
            var dev = InputDevices.GetDeviceAtXRNode(XRNode.CenterEye);
            if (!dev.isValid) dev = InputDevices.GetDeviceAtXRNode(XRNode.Head);
            return dev.isValid && dev.TryGetFeatureValue(CommonUsages.devicePosition, out pos) && dev.TryGetFeatureValue(CommonUsages.deviceRotation, out rot);
        }

        /// Places the board in front of the wearer's current gaze (yaw only), like the WebXR version.
        public void Recenter()
        {
            if (worldContent == null || head == null) return;
            var f = head.transform.forward; f.y = 0;
            if (f.sqrMagnitude < 1e-4f) f = Vector3.forward;
            f.Normalize();
            var hp = head.transform.position;
            var basePos = new Vector3(hp.x, transform.position.y, hp.z) + f * contentDistance;
            worldContent.SetPositionAndRotation(basePos, Quaternion.LookRotation(f));
            // LiveView shrinks and offsets the board, so centre the board itself at eye level in front of the wearer
            // (works for seated and standing users and whatever floor height the runtime reports).
            var board = worldContent.GetComponentInChildren<BoardView>();
            if (board != null)
            {
                var target = hp + f * Mathf.Min(contentDistance, 1.3f);
                target.y = hp.y - 0.05f;
                worldContent.position += target - board.transform.position;
            }
        }

        public void SetMixedReality(bool on)
        {
            MixedReality = on;
            ApplyBackground();
#if ALONGSIDE_ARF
            var cm = head.GetComponent<UnityEngine.XR.ARFoundation.ARCameraManager>();
            if (on && cm == null) cm = head.gameObject.AddComponent<UnityEngine.XR.ARFoundation.ARCameraManager>();
            if (cm != null) cm.enabled = on;
            if (on && FindAnyObjectByType<UnityEngine.XR.ARFoundation.ARSession>() == null)
                new GameObject("AR Session").AddComponent<UnityEngine.XR.ARFoundation.ARSession>();
#endif
        }

        void ApplyBackground()
        {
            if (head == null) return;
            head.clearFlags = CameraClearFlags.SolidColor;
            head.backgroundColor = MixedReality ? new Color(0, 0, 0, 0) : vrBackground;
        }
    }
}
