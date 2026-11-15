using System;
using System.Collections;
using System.Reflection;
using UnityEngine;
namespace Alongside {
// MRUK is intentionally optional. The reflection adapter uses documented v81+ API names;
// the default preserves the existing Unity OpenXR stack via WebCamTexture, clearly ESTIMATED.
public class LiveCameraSource:MonoBehaviour {
 public MonoBehaviour mrukCameraAccess;
 public Transform head;
 [Range(50,120)]public float estimatedHorizontalFov=90;
 public Vector3 estimatedLensOffset=Vector3.zero;
 public int cameraIndex;
 public bool FlipReadbackRows=true;
 public bool Requested {get;private set;}
 public bool PermissionPending {get;private set;}
 public string Status{get;private set;}="Camera off";
 WebCamTexture webcam;
 public void Open(){if(Requested)return;Requested=true;StartCoroutine(OpenRoutine());}
 IEnumerator OpenRoutine(){PermissionPending=true;Status="Requesting camera permission";
#if UNITY_ANDROID && !UNITY_EDITOR
 const string permission="horizonos.permission.HEADSET_CAMERA";
 if(!UnityEngine.Android.Permission.HasUserAuthorizedPermission(permission)){UnityEngine.Android.Permission.RequestUserPermission(permission);float deadline=Time.realtimeSinceStartup+30;while(Requested&&!UnityEngine.Android.Permission.HasUserAuthorizedPermission(permission)&&Time.realtimeSinceStartup<deadline)yield return null;}
 if(!UnityEngine.Android.Permission.HasUserAuthorizedPermission(permission)){Requested=false;PermissionPending=false;Status="Camera permission denied";yield break;}
 if(mrukCameraAccess==null && !UnityEngine.Android.Permission.HasUserAuthorizedPermission(UnityEngine.Android.Permission.Camera)){UnityEngine.Android.Permission.RequestUserPermission(UnityEngine.Android.Permission.Camera);float end=Time.realtimeSinceStartup+30;while(Requested&&!UnityEngine.Android.Permission.HasUserAuthorizedPermission(UnityEngine.Android.Permission.Camera)&&Time.realtimeSinceStartup<end)yield return null;if(!UnityEngine.Android.Permission.HasUserAuthorizedPermission(UnityEngine.Android.Permission.Camera)){Requested=false;PermissionPending=false;Status="WebCamTexture camera permission denied";yield break;}}
#else
 yield return Application.RequestUserAuthorization(UserAuthorization.WebCam);
 if(!Application.HasUserAuthorization(UserAuthorization.WebCam)){Requested=false;PermissionPending=false;Status="Camera permission denied";yield break;}
#endif
 PermissionPending=false;
 if(!Requested)yield break;
 if(mrukCameraAccess!=null){mrukCameraAccess.enabled=true;Status="MRUK source requested; validate OpenXR coexistence on device";yield break;}
 var devices=WebCamTexture.devices;
#if UNITY_EDITOR || UNITY_STANDALONE
 // On the PC (Quest Link) the readback is already upright, and the virtual "Meta Quest" webcams deliver no frames, so use a real webcam.
 FlipReadbackRows=false;if(cameraIndex<devices.Length&&devices[cameraIndex].name.StartsWith("Meta Quest")){var real=System.Array.FindIndex(devices,d=>!d.name.StartsWith("Meta Quest"));if(real>=0)cameraIndex=real;}
#endif
 if(devices.Length==0){Requested=false;Status="No camera exposed. Install/authorize PCA and run on Quest; no fake frame supplied.";yield break;}
 webcam=new WebCamTexture(devices[Mathf.Clamp(cameraIndex,0,devices.Length-1)].name,960,720,15);webcam.Play();Status="WebCamTexture camera: ESTIMATED calibration";
 }
 static object Read(object o,string name){var t=o.GetType();return t.GetProperty(name)?.GetValue(o)??t.GetField(name)?.GetValue(o);}
 public bool TryFrame(out Texture texture,out Pose pose,out FrameIntrinsics intrinsic,out Vector2Int resolution,out string quality,out float rotation,out bool mirror,out double timestamp){texture=null;pose=default;intrinsic=null;resolution=default;quality="estimated";rotation=0;mirror=false;timestamp=LiveMath.Now();if(!Requested)return false;
 if(mrukCameraAccess!=null){try{var c=mrukCameraAccess;var t=c.GetType();if(Read(c,"IsPlaying") is bool playing&&!playing)return false;texture=t.GetMethod("GetTexture",Type.EmptyTypes)?.Invoke(c,null) as Texture;if(texture==null)return false;pose=(Pose)t.GetMethod("GetCameraPose",Type.EmptyTypes).Invoke(c,null);var raw=Read(c,"Intrinsics");var focal=(Vector2)Read(raw,"FocalLength");var principal=(Vector2)Read(raw,"PrincipalPoint");resolution=(Vector2Int)Read(c,"CurrentResolution");intrinsic=new FrameIntrinsics{fx=focal.x,fy=focal.y,cx=principal.x,cy=principal.y};if(Read(c,"Timestamp") is DateTime time)timestamp=new DateTimeOffset(time.ToUniversalTime()).ToUnixTimeMilliseconds();quality="measured";Status="MRUK texture + documented camera pose/intrinsics";return true;}catch(Exception e){Status="MRUK adapter: "+e.GetType().Name;return false;}}
 if(webcam==null||!webcam.isPlaying||webcam.width<64||!webcam.didUpdateThisFrame||head==null)return false;texture=webcam;pose=new Pose(head.TransformPoint(estimatedLensOffset),head.rotation);resolution=new Vector2Int(webcam.width,webcam.height);float fx=resolution.x/(2*Mathf.Tan(estimatedHorizontalFov*Mathf.Deg2Rad/2));intrinsic=new FrameIntrinsics{fx=fx,fy=fx,cx=resolution.x*.5f,cy=resolution.y*.5f};rotation=webcam.videoRotationAngle;mirror=webcam.videoVerticallyMirrored;return true;
 }
 public void Close(){Requested=false;PermissionPending=false;if(webcam!=null){webcam.Stop();Destroy(webcam);webcam=null;}if(mrukCameraAccess)mrukCameraAccess.enabled=false;Status="Camera off";}
 void OnDisable(){Close();}
}
}
