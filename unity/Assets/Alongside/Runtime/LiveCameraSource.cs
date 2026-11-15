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
 // Stream orientation (0.1.16). The old Android default (row flip) showed the iPad an upside-down view.
 // ViewMode bit 0 = flip rows, bit 1 = rotate 180. Default 0 (no flip); the HUD "View" button cycles 0-3 and it is remembered.
 public int ViewMode{get;private set;}
 public int ExtraQuarter=>(ViewMode&2)!=0?2:0;
 public int CycleView(){ViewMode=(ViewMode+1)%4;ApplyView();try{PlayerPrefs.SetInt("alongside.viewMode",ViewMode);PlayerPrefs.Save();}catch{}return ViewMode;}
 void ApplyView(){FlipReadbackRows=(ViewMode&1)!=0;}
 void Awake(){try{ViewMode=PlayerPrefs.GetInt("alongside.viewMode",0)&3;}catch{ViewMode=0;}ApplyView();
  // Quest 3/3S passthrough cameras are ~74° wide, not 90°. A too-wide guess squeezed the VR strokes drawn on the iPad toward the centre.
  if(estimatedHorizontalFov>85f)estimatedHorizontalFov=74f;}
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
 if(cameraIndex<devices.Length&&devices[cameraIndex].name.StartsWith("Meta Quest")){var real=System.Array.FindIndex(devices,d=>!d.name.StartsWith("Meta Quest"));if(real>=0)cameraIndex=real;}
#endif
 if(devices.Length==0){Requested=false;Status="No camera exposed. Install/authorize PCA and run on Quest; no fake frame supplied.";yield break;}
 cameraIndex=Mathf.Clamp(cameraIndex,0,devices.Length-1);StartWebcam();
 }

 // ---- WebCamTexture lifecycle, stall watchdog and diagnostics (0.1.15) ----
 // Meta's passthrough camera only supports these sizes; 960x720 (used before) is not one of them.
 static readonly Vector2Int[] QuestSizes={new Vector2Int(640,480),new Vector2Int(1280,960),new Vector2Int(800,600)};
 int sizeIndex,attempts;string deviceName="";Vector2Int requested;
 public int Updates{get;private set;}            // camera frames observed (didUpdateThisFrame), counted every render frame
 int consumed=-1;float lastUpdate=-1,startedAt;
 public string LastFail{get;private set;}="";
 void StartWebcam(){
  if(webcam!=null){webcam.Stop();Destroy(webcam);webcam=null;}
  var devices=WebCamTexture.devices;if(devices.Length==0){Status="No camera devices";return;}
  deviceName=devices[cameraIndex].name;
#if UNITY_ANDROID && !UNITY_EDITOR
  requested=QuestSizes[sizeIndex%QuestSizes.Length];
#else
  requested=new Vector2Int(640,480);
#endif
  webcam=new WebCamTexture(deviceName,requested.x,requested.y,30);webcam.Play();
  Updates=0;consumed=-1;lastUpdate=-1;startedAt=Time.realtimeSinceStartup;attempts++;
  Status="WebCamTexture camera: ESTIMATED calibration";
 }
 // Re-start the camera after a short app pause if the OS stopped it.
 public void Resume(){if(Requested&&webcam!=null&&!webcam.isPlaying){webcam.Play();startedAt=Time.realtimeSinceStartup;}}
 void Update(){
  if(webcam==null||!Requested)return;
  if(webcam.didUpdateThisFrame){Updates++;lastUpdate=Time.realtimeSinceStartup;}
  // Watchdog: no new camera frame for 3 s → try the next resolution, then the next camera device.
  float since=Time.realtimeSinceStartup-(lastUpdate>0?lastUpdate:startedAt);
  if(since>3f&&attempts<12){
   var devices=WebCamTexture.devices;sizeIndex++;
   if(sizeIndex%QuestSizes.Length==0&&devices.Length>1)cameraIndex=(cameraIndex+1)%devices.Length;
   Debug.LogWarning("[LiveCamera] no frames for "+since.ToString("0.0")+"s on '"+deviceName+"' "+requested.x+"x"+requested.y+"; retrying");
   StartWebcam();
  }
 }
 // One-line state for the HUD (encoder.Status shows this when no frame can be sent).
 public string Diagnostics(){
  if(mrukCameraAccess!=null)return "MRUK camera: "+Status;
  if(webcam==null)return "camera: "+Status+(PermissionPending?" (waiting for permission)":"");
  float since=lastUpdate>0?Time.realtimeSinceStartup-lastUpdate:-1;
  var names=string.Join(", ",Array.ConvertAll(WebCamTexture.devices,d=>d.name));
  return "cam '"+deviceName+"' got "+webcam.width+"x"+webcam.height+" (asked "+requested.x+"x"+requested.y+") playing="+webcam.isPlaying+
   " updates="+Updates+" last="+(since<0?"never":since.ToString("0.0")+"s ago")+" try#"+attempts+(string.IsNullOrEmpty(LastFail)?"":" | "+LastFail)+" | devices: "+names;
 }
 static object Read(object o,string name){var t=o.GetType();return t.GetProperty(name)?.GetValue(o)??t.GetField(name)?.GetValue(o);}
 public bool TryFrame(out Texture texture,out Pose pose,out FrameIntrinsics intrinsic,out Vector2Int resolution,out string quality,out float rotation,out bool mirror,out double timestamp){texture=null;pose=default;intrinsic=null;resolution=default;quality="estimated";rotation=0;mirror=false;timestamp=LiveMath.Now();if(!Requested)return false;
 if(mrukCameraAccess!=null){try{var c=mrukCameraAccess;var t=c.GetType();if(Read(c,"IsPlaying") is bool playing&&!playing)return false;texture=t.GetMethod("GetTexture",Type.EmptyTypes)?.Invoke(c,null) as Texture;if(texture==null)return false;pose=(Pose)t.GetMethod("GetCameraPose",Type.EmptyTypes).Invoke(c,null);var raw=Read(c,"Intrinsics");var focal=(Vector2)Read(raw,"FocalLength");var principal=(Vector2)Read(raw,"PrincipalPoint");resolution=(Vector2Int)Read(c,"CurrentResolution");intrinsic=new FrameIntrinsics{fx=focal.x,fy=focal.y,cx=principal.x,cy=principal.y};if(Read(c,"Timestamp") is DateTime time)timestamp=new DateTimeOffset(time.ToUniversalTime()).ToUnixTimeMilliseconds();quality="measured";Status="MRUK texture + documented camera pose/intrinsics";return true;}catch(Exception e){Status="MRUK adapter: "+e.GetType().Name;return false;}}
 // A frame is sendable if the camera produced ANY new frame since the last one we sent (not only in this exact render frame).
 if(webcam==null){LastFail="no webcam";return false;}if(!webcam.isPlaying){LastFail="webcam not playing";return false;}
 if(webcam.width<64){LastFail="webcam size "+webcam.width+"x"+webcam.height+" (no frames yet)";return false;}
 if(head==null){LastFail="no head transform";return false;}
 if(Updates==consumed){LastFail="no new camera frame since last send";return false;}
 consumed=Updates;LastFail="";texture=webcam;pose=new Pose(head.TransformPoint(estimatedLensOffset),head.rotation);resolution=new Vector2Int(webcam.width,webcam.height);float fx=resolution.x/(2*Mathf.Tan(estimatedHorizontalFov*Mathf.Deg2Rad/2));intrinsic=new FrameIntrinsics{fx=fx,fy=fx,cx=resolution.x*.5f,cy=resolution.y*.5f};rotation=webcam.videoRotationAngle;mirror=webcam.videoVerticallyMirrored;return true;
 }
 // For one-off stills (Shizuku): the live WebCamTexture once it is delivering frames.
 public WebCamTexture Webcam=>webcam!=null&&webcam.isPlaying&&webcam.width>64?webcam:null;
 public void Close(){Requested=false;PermissionPending=false;attempts=0;if(webcam!=null){webcam.Stop();Destroy(webcam);webcam=null;}if(mrukCameraAccess)mrukCameraAccess.enabled=false;Status="Camera off";}
 void OnDisable(){Close();}
}
}
