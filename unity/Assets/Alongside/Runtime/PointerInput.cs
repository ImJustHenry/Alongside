// Alongside for Unity — unified pointers: mouse/touch on desktop, controller rays on Quest (UnityEngine.XR, no extra packages).
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;
using XRUsages = UnityEngine.XR.CommonUsages;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace Alongside
{
    public struct PointerState
    {
        public int id;            // 0 mouse, 1 left hand, 2 right hand
        public bool valid;
        public Ray ray;
        public bool held, down, up;
        public bool secondaryDown; // B/Y button or right mouse: undo
        public Transform visual;  // controller transform for the laser (null for mouse)
    }

    public class PointerInput : MonoBehaviour
    {
        public Camera desktopCamera;
        public Transform leftController, rightController;
        public readonly List<PointerState> Pointers = new List<PointerState>();

        readonly PinchGate[] handGates = { new PinchGate(), new PinchGate() };
        readonly bool[] wasHeld = new bool[3];
        readonly bool[] wasSecondary = new bool[3];
        static readonly InputFeatureUsage<Vector3> PointerPosition = new InputFeatureUsage<Vector3>("PointerPosition");
        static readonly InputFeatureUsage<Quaternion> PointerRotation = new InputFeatureUsage<Quaternion>("PointerRotation");

        public static bool XRActive => XRSettings.isDeviceActive;

        void Update()
        {
            Pointers.Clear();
            if (XRActive)
            {
                AddController(1, XRNode.LeftHand, leftController);
                AddController(2, XRNode.RightHand, rightController);
            }
            else AddMouse();
        }

        void AddMouse()
        {
            if (desktopCamera == null) desktopCamera = Camera.main;
            if (desktopCamera == null) return;
            Vector2 pos; bool held, secondary;
#if ENABLE_INPUT_SYSTEM
            var mouse = Mouse.current;
            var touch = Touchscreen.current;
            if (touch != null && touch.primaryTouch.press.isPressed) { pos = touch.primaryTouch.position.ReadValue(); held = true; secondary = false; }
            else if (mouse != null) { pos = mouse.position.ReadValue(); held = mouse.leftButton.isPressed; secondary = mouse.rightButton.isPressed; }
            else return;
#elif ENABLE_LEGACY_INPUT_MANAGER
            pos = Input.mousePosition; held = Input.GetMouseButton(0); secondary = Input.GetMouseButton(1);
#else
            return;
#endif
            if (ConnectPanel.Covers(pos) && !wasHeld[0]) { held = false; secondary = false; }
            Push(0, desktopCamera.ScreenPointToRay(pos), held, secondary, null);
        }

        void AddController(int id, XRNode node, Transform visual)
        {
            if(HandBrushInput.Read(id-1,transform,handGates[id-1],out var hand))
            {
                if(visual){visual.gameObject.SetActive(true);visual.SetPositionAndRotation(hand.aim.origin,Quaternion.LookRotation(hand.aim.direction));}
                Push(id,hand.aim,hand.pinching,false,visual);return;
            }
            var dev = InputDevices.GetDeviceAtXRNode(node);
            if (!dev.isValid) { if (visual) visual.gameObject.SetActive(false); return; }
            if (visual) visual.gameObject.SetActive(true);
            // Prefer the OpenXR aim pose; fall back to the grip pose.
            Vector3 pos; Quaternion rot;
            if (!(dev.TryGetFeatureValue(PointerPosition, out pos) && dev.TryGetFeatureValue(PointerRotation, out rot)))
            {
                dev.TryGetFeatureValue(XRUsages.devicePosition, out pos);
                dev.TryGetFeatureValue(XRUsages.deviceRotation, out rot);
            }
            dev.TryGetFeatureValue(XRUsages.triggerButton, out bool trigger);
            if (!trigger && dev.TryGetFeatureValue(XRUsages.trigger, out float tv)) trigger = tv > 0.6f;
            dev.TryGetFeatureValue(XRUsages.secondaryButton, out bool secondary);
            var origin = transform; // XR rig root = tracking space
            var wp = origin.TransformPoint(pos);
            var wr = origin.rotation * rot;
            if (visual) visual.SetPositionAndRotation(wp, wr);
            Push(id, new Ray(wp, wr * Vector3.forward), trigger, secondary, visual);
        }

        void Push(int id, Ray ray, bool held, bool secondary, Transform visual)
        {
            Pointers.Add(new PointerState
            {
                id = id, valid = true, ray = ray, held = held, visual = visual,
                down = held && !wasHeld[id], up = !held && wasHeld[id],
                secondaryDown = secondary && !wasSecondary[id],
            });
            wasHeld[id] = held;
            wasSecondary[id] = secondary;
        }
    }
}
