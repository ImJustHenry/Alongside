using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.XR.OpenXR;
namespace Alongside.EditorTools {
public static class LiveViewSetup {
 static readonly string[] Required={"HandTracking","MetaHandTrackingAim","ARCameraFeature","ARSessionFeature","ARPlaneFeature","ARRaycastFeature"};
 [MenuItem("Alongside/LiveView/1 - Check Android module")]
 public static void CheckAndroid(){if(!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.Android,BuildTarget.Android))throw new BuildFailedException("Android Build Support is absent. Unity Hub > Installs > 6000.6.5f1 > Add modules > Android Build Support + SDK/NDK + OpenJDK. No APK can be built until installed.");Debug.Log("[Alongside] Android module detected. This does not verify the connected Quest.");}
 [MenuItem("Alongside/LiveView/2 - Configure XR features")]
 public static void Configure(){AlongsideSetup.ConfigurePlayer();foreach(var group in new[]{BuildTargetGroup.Android,BuildTargetGroup.Standalone}){var settings=OpenXRSettings.GetSettingsForBuildTargetGroup(group);if(settings==null)throw new BuildFailedException("Assign the OpenXR loader to "+group+" first in XR Plug-in Management.");var features=settings.GetFeatures();foreach(var name in Required){var feature=features.FirstOrDefault(f=>f!=null&&f.GetType().Name==name);if(feature==null)throw new BuildFailedException("Missing "+name+" for "+group+". Resolve XR Hands 1.7.3 / Meta OpenXR 2.7.0, reopen OpenXR settings, then rerun. Available: "+string.Join(", ",features.Where(f=>f!=null).Select(f=>f.GetType().Name)));feature.enabled=true;EditorUtility.SetDirty(feature);}EditorUtility.SetDirty(settings);}AssetDatabase.SaveAssets();Debug.Log("[Alongside] Enabled HandTracking, MetaHandTrackingAim, ARCamera/ARSession/ARPlane/ARRaycast for Android and Standalone. Perform Project Validation and on-device smoke test.");}
 [MenuItem("Alongside/LiveView/3 - Build LiveView scene")]
 public static void BuildScene(){if(!Application.isBatchMode&&!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())return;AlongsideSetup.BuildScene();var controller=UnityEngine.Object.FindAnyObjectByType<BoardController>();if(controller.GetComponent<LiveViewController>()==null)controller.gameObject.AddComponent<LiveViewController>();EditorSceneManager.SaveScene(controller.gameObject.scene,"Assets/Scenes/Alongside.unity");AssetDatabase.SaveAssets();Debug.Log("[Alongside] LiveView component attached. Create the room from Quest so the wearer is host.");}
 [MenuItem("Alongside/LiveView/4 - Run math checks")]
 public static void CheckMath(){var frame=new CameraFrame{w=640,h=480,intrinsics=new FrameIntrinsics{fx=500,fy=500,cx=320,cy=240},pose=new FramePose()};var ray=LiveMath.Ray(frame,new FramePoint(.5f,.5f));if(Vector3.Distance(ray.direction,Vector3.forward)>.0001f)throw new Exception("Centre ray failed");var plane=new Plane(Vector3.back,new Vector3(0,0,2));if(!plane.Raycast(ray,out var distance)||Mathf.Abs(distance-2)>.0001f)throw new Exception("Plane intersection failed");if(!LiveMath.Project(frame,ray.GetPoint(distance),out var uv)||Mathf.Abs(uv.u-.5f)>.0001f||Mathf.Abs(uv.v-.5f)>.0001f)throw new Exception("Projection round trip failed");var pinch=new PinchGate();if(pinch.UpdateDistance(.025f)||!pinch.UpdateDistance(.019f)||!pinch.UpdateDistance(.025f)||pinch.UpdateDistance(.031f))throw new Exception("Pinch hysteresis failed");var filter=new OneEuroVector();filter.Filter(Vector3.zero,0);var result=filter.Filter(Vector3.one,.016f);if(result.x<=0||result.x>=1||float.IsNaN(result.x))throw new Exception("One-Euro check failed");Debug.Log("[Alongside] PASS: centre ray, ray/plane intersection, projection round trip, pinch hysteresis, One-Euro smoothing. This is not camera calibration or a hardware test.");}
 [MenuItem("Alongside/LiveView/5 - Build Android APK")]
 public static void BuildAndroid(){CheckAndroid();Configure();CheckMath();if(EditorUserBuildSettings.activeBuildTarget!=BuildTarget.Android)throw new BuildFailedException("Switch the active Build Profile to Android and wait for script reimport, then run Build Android APK again.");BuildScene();Directory.CreateDirectory("Builds");var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{"Assets/Scenes/Alongside.unity"},locationPathName="Builds/Alongside-LiveView.apk",target=BuildTarget.Android,options=BuildOptions.Development});if(report.summary.result!=BuildResult.Succeeded)throw new BuildFailedException("Alongside APK build failed. See Editor log.");Debug.Log("[Alongside] APK built: Builds/Alongside-LiveView.apk. On-device tests still required.");}
}
}
