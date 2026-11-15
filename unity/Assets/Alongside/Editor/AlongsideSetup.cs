// Alongside for Unity — one-click scene + player setup.  Menu: Alongside > Build Scene / Configure Quest Player Settings.
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Alongside.EditorTools
{
    public static class AlongsideSetup
    {
        const string ScenePath = "Assets/Scenes/Alongside.unity";
        const string MatPath = "Assets/Alongside/Materials/AlongsideUnlit.mat";

        [MenuItem("Alongside/Build Scene")]
        public static void BuildScene()
        {
            Directory.CreateDirectory("Assets/Alongside/Materials");
            Directory.CreateDirectory("Assets/Scenes");
            var mat = AssetDatabase.LoadAssetAtPath<Material>(MatPath);
            if (mat == null)
            {
                mat = new Material(Shader.Find("Sprites/Default")) { name = "AlongsideUnlit" };
                AssetDatabase.CreateAsset(mat, MatPath);
            }

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white;

            // XR rig: tracking-space root, head camera, two controllers
            var rigGo = new GameObject("XR Rig");
            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            camGo.transform.SetParent(rigGo.transform, false);
            var cam = camGo.AddComponent<Camera>();
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 100f;
            cam.fieldOfView = 60;
            camGo.AddComponent<AudioListener>();
            var left = Controller(rigGo.transform, "Left Controller", mat);
            var right = Controller(rigGo.transform, "Right Controller", mat);
            var input = rigGo.AddComponent<PointerInput>();
            input.desktopCamera = cam; input.leftController = left; input.rightController = right;
            var rig = rigGo.AddComponent<XRRig>();
            rig.head = cam;

            // world content (repositioned in front of the wearer on headset start)
            var world = new GameObject("Alongside");
            world.transform.position = new Vector3(0, 0, 2.0f);
            var boardGo = new GameObject("Board");
            boardGo.transform.SetParent(world.transform, false);
            boardGo.transform.localPosition = new Vector3(0, 1.6f, 0);
            var view = boardGo.AddComponent<BoardView>();
            view.baseMaterial = mat;
            var ctl = boardGo.AddComponent<BoardController>();
            ctl.view = view; ctl.input = input; ctl.rig = rig; ctl.uiMaterial = mat;
            boardGo.AddComponent<ConnectPanel>().controller = ctl;
            rig.worldContent = world.transform;
            rig.desktopPosition = new Vector3(0.45f, 1.5f, -0.75f);
            rig.desktopLookAt = new Vector3(0.45f, 1.45f, 2f);
            camGo.transform.SetPositionAndRotation(rig.desktopPosition, Quaternion.LookRotation(rig.desktopLookAt - rig.desktopPosition));

            // floor hint for VR
            var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
            floor.name = "Floor";
            Object.DestroyImmediate(floor.GetComponent<Collider>());
            floor.transform.localScale = new Vector3(3, 1, 3);
            var floorMat = AssetDatabase.LoadAssetAtPath<Material>("Assets/Alongside/Materials/Floor.mat");
            if (floorMat == null)
            {
                floorMat = new Material(mat) { color = new Color(0.86f, 0.86f, 0.82f) };
                AssetDatabase.CreateAsset(floorMat, "Assets/Alongside/Materials/Floor.mat");
            }
            floorMat.renderQueue = 2000; // draw before the transparent board so it never covers it
            EditorUtility.SetDirty(floorMat);
            floor.GetComponent<MeshRenderer>().sharedMaterial = floorMat;

            EditorSceneManager.SaveScene(scene, ScenePath);
            var scenes = EditorBuildSettings.scenes.Where(s => s.path != ScenePath).ToList();
            scenes.Insert(0, new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
            AssetDatabase.SaveAssets();
            Debug.Log("[Alongside] Scene built at " + ScenePath);
        }

        static Transform Controller(Transform parent, string name, Material mat)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var tip = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            tip.name = "Tip";
            Object.DestroyImmediate(tip.GetComponent<Collider>());
            tip.transform.SetParent(go.transform, false);
            tip.transform.localScale = Vector3.one * 0.03f;
            tip.GetComponent<MeshRenderer>().sharedMaterial = mat;
            go.SetActive(false);
            return go.transform;
        }

        [MenuItem("Alongside/Configure Quest Player Settings")]
        public static void ConfigurePlayer()
        {
            PlayerSettings.insecureHttpOption = InsecureHttpOption.AlwaysAllowed; // LAN http://<laptop-ip>:4173
            PlayerSettings.Android.forceInternetPermission = true;
            PlayerSettings.runInBackground = true; // keep syncing the shared room when the window/editor is not focused
            PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)32;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.productName = "Alongside";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "edu.slu.stanfordxr.alongside");
            AssetDatabase.SaveAssets();
            Debug.Log("[Alongside] Player settings configured for Quest (IL2CPP, ARM64, API 32+, HTTP allowed, Internet permission).");
        }
    }
}
