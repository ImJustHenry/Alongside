using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using Unity.XR.CoreUtils;
using Dict=System.Collections.Generic.Dictionary<string,object>;
namespace Alongside {
public class LiveViewController:MonoBehaviour {
 public BoardController board;public LiveCameraSource cameraSource;public CameraJpegEncoder encoder;
 public bool AirInk=true;public bool Eraser;public float StrokeWidth=.006f;
 // SurfaceMode: pointer/pinch ink lands on real objects (scene mesh, planes, furniture boxes) when the aim ray hits one.
 public bool SurfaceMode=true;SurfaceInk surfaces;string surfaceState="Surfaces: not started (press Surfaces)";readonly bool[] onSurface=new bool[2];readonly Vector3[] surfaceNormals=new Vector3[2];readonly Vector3[] surfaceTips=new Vector3[2];
 const float ControllerTip=.01f,SurfaceReach=3f,SurfaceJumpBreak=.25f;
 // Surface-ink pointer per hand: orange line + ring where ink will land; grey dot at the reach limit when nothing is in range.
 readonly LineRenderer[] pointerLines=new LineRenderer[2];readonly GameObject[] pointerRings=new GameObject[2],pointerLimits=new GameObject[2];Material pointerMat;
 void UpdatePointer(int i,bool show,Ray aim,bool hit,Vector3 hitPoint,Vector3 normal){
  if(pointerLines[i]==null){if(pointerMat==null)pointerMat=new Material(Shader.Find("Sprites/Default"));var go=new GameObject("Surface pointer "+i);var lr=go.AddComponent<LineRenderer>();lr.sharedMaterial=pointerMat;lr.widthMultiplier=.003f;lr.positionCount=2;lr.useWorldSpace=true;lr.startColor=new Color(.85f,.42f,.27f,.25f);lr.endColor=new Color(.85f,.42f,.27f,.95f);pointerLines[i]=lr;
   GameObject Disc(string n,float d,Color c){var g=GameObject.CreatePrimitive(PrimitiveType.Cylinder);g.name=n;Destroy(g.GetComponent<Collider>());g.transform.localScale=new Vector3(d,.0008f,d);var m=new Material(pointerMat){color=c};g.GetComponent<Renderer>().sharedMaterial=m;return g;}
   pointerRings[i]=Disc("Surface pointer ring "+i,.02f,new Color(.85f,.42f,.27f,.95f));pointerLimits[i]=Disc("Surface pointer limit "+i,.012f,new Color(.5f,.5f,.5f,.6f));}
  pointerLines[i].enabled=show&&hit;pointerRings[i].SetActive(show&&hit);pointerLimits[i].SetActive(show&&!hit);
  if(!show)return;
  if(hit){pointerLines[i].SetPosition(0,aim.origin);pointerLines[i].SetPosition(1,hitPoint);pointerRings[i].transform.SetPositionAndRotation(hitPoint,Quaternion.FromToRotation(Vector3.up,normal));}
  else pointerLimits[i].transform.SetPositionAndRotation(aim.GetPoint(SurfaceReach),Quaternion.FromToRotation(Vector3.up,-aim.direction));}
 public Transform RoomOrigin{get;private set;}
 public string Status{get;private set;}="LiveView ready. Camera OFF. Physical accuracy unverified.";
 IBoardSession session;ServerSession remote;SpatialStrokeMesh committed,previewMesh;TextMesh label;BoardButton inkButton,streamButton,eraseButton;
 readonly PinchGate[] gates={new PinchGate(),new PinchGate()};readonly OneEuroVector[] filters={new OneEuroVector{MinCutoff=3f,Beta=.3f},new OneEuroVector{MinCutoff=3f,Beta=.3f}};string lastLabel;readonly SpatialStroke[] drafts=new SpatialStroke[2];readonly bool[] menuBlock=new bool[2];readonly Vector3[] tips=new Vector3[2];readonly bool[] tracked=new bool[2];readonly Dictionary<string,SpatialStroke> remotePreviews=new Dictionary<string,SpatialStroke>();
 ARRaycastManager raycasts;ARPlaneManager planes;readonly List<ARRaycastHit> hits=new List<ARRaycastHit>();bool xrStarted,lastConnected;int lastRevision=-1;GameObject cursor;float cursorUntil;
 void Start(){board=GetComponent<BoardController>();if(board==null){enabled=false;return;}RoomOrigin=new GameObject("Alongside Room Space (session origin)").transform;RoomOrigin.SetPositionAndRotation(board.rig.transform.position,board.rig.transform.rotation);
 committed=new GameObject("Combined spatial strokes").AddComponent<SpatialStrokeMesh>();committed.transform.SetParent(RoomOrigin,false);committed.Initialize(board.uiMaterial);previewMesh=new GameObject("Combined spatial previews").AddComponent<SpatialStrokeMesh>();previewMesh.transform.SetParent(RoomOrigin,false);previewMesh.Initialize(board.uiMaterial);
 cameraSource=GetComponent<LiveCameraSource>()??gameObject.AddComponent<LiveCameraSource>();cameraSource.head=board.rig.head.transform;encoder=GetComponent<CameraJpegEncoder>()??gameObject.AddComponent<CameraJpegEncoder>();encoder.source=cameraSource;encoder.roomOrigin=RoomOrigin;encoder.AddOverlays=Overlay;encoder.Encoded=(packet,f)=>{if(remote!=null&&!string.IsNullOrEmpty(encoder.Epoch))_ = remote.SendCameraFrame(packet);};BuildPanel();
 }
 Transform liveRow;public ControlHud Hud{get;private set;}
 // Streaming to the room (Camera ON) is separate from the camera merely being open (Shizuku snapshots).
 public bool Streaming=>encoder!=null&&!string.IsNullOrEmpty(encoder.Epoch);
 // GPT's eyes: the room camera stream is the path proven to work on the Quest, so GPT turns it on (host only).
 float nextStreamTry;
 public string EnsureStreaming(){if(Streaming)return null;if(remote==null)return "not connected to the server";if(!remote.SocketConnected)return "waiting for the room connection";if(!session.Me.IsHost)return "only the room host's camera can stream";if(Time.realtimeSinceStartup>=nextStreamTry){nextStreamTry=Time.realtimeSinceStartup+5f;remote.LiveSend(new Dict{{"type","streamStart"}});}return "starting the camera";}
 void BuildPanel(){var row=new GameObject("LiveView controls").transform;liveRow=row;row.SetParent(board.view.transform,false);row.localPosition=new Vector3(0,BoardView.H/2+.18f,-.035f);float x=-1.02f;BoardButton Add(string text,Action click){var b=BoardButton.Create(row,text,new Vector3(x,0,0),new Vector2(.25f,.10f),board.uiMaterial,click,.030f);x+=.29f;return b;}
 inkButton=Add("Ink: surfaces",()=>{if(AirInk&&SurfaceMode)SurfaceMode=false;else if(AirInk)AirInk=false;else{AirInk=true;SurfaceMode=true;}CancelDrafts();});eraseButton=Add("Eraser",()=>Eraser=!Eraser);Add("Undo 3D",()=>session?.SpatialAction("spatial.undo"));Add("Clear mine",()=>session?.SpatialAction("spatial.clearMine"));streamButton=Add("Camera ON",StartStopCamera);Add("Surfaces",()=>StartCoroutine(EnableSurfaces()));Add("Allow capture",()=>{if(remote!=null)remote.LiveSend(new Dict{{"type","capturePermit"}});});Add("Ask frame",()=>{if(remote==null){Notice("Join a room first");return;}remote.AskLiveFrame("What should I inspect next? State uncertainty; do not certify physical safety.",Notice);});
 label=Draw.Text(row,"LiveView status",Status,new Vector3(-1.15f,.15f,0),.033f,Color.red,TextAnchor.MiddleLeft);}
 // On the headset the big shared board is replaced by a small follow-me control HUD (board still available via "Board").
 public void EnableHud(){if(Hud==null&&liveRow!=null)Hud=ControlHud.Create(board,liveRow);}
 void Notice(string text){Status=text;board.Notice(text,6);}
 void StartStopCamera(){if(Streaming){StopCamera();return;}if(remote==null||!session.Me.IsHost){Notice("The Quest wearer must create the room (host) to publish a camera.");return;}if(!remote.SocketConnected){Notice("Wait for the room connection.");return;}remote.LiveSend(new Dict{{"type","streamStart"}});}
 void StopCamera(){if(remote!=null&&remote.SocketConnected)remote.LiveSend(new Dict{{"type","streamStop"}});encoder.StopCapture();remotePreviews.Clear();Notice("Camera OFF. No further frames are sent.");}
 IEnumerator EnableSurfaces(){
#if UNITY_ANDROID && !UNITY_EDITOR
 const string permission="com.oculus.permission.USE_SCENE";surfaceState="Surfaces: waiting for spatial-data permission";if(!UnityEngine.Android.Permission.HasUserAuthorizedPermission(permission)){UnityEngine.Android.Permission.RequestUserPermission(permission);float end=Time.realtimeSinceStartup+30;while(!UnityEngine.Android.Permission.HasUserAuthorizedPermission(permission)&&Time.realtimeSinceStartup<end)yield return null;}if(!UnityEngine.Android.Permission.HasUserAuthorizedPermission(permission)){surfaceState="Surfaces: spatial-data permission DENIED. Allow it in Settings > Apps > Alongside LiveView > Permissions, then press Surfaces.";Notice(surfaceState);yield break;}
#else
 yield return null;
#endif
 var rig=board.rig;var origin=rig.GetComponent<XROrigin>();if(origin==null)origin=rig.gameObject.AddComponent<XROrigin>();origin.Camera=rig.head;origin.CameraFloorOffsetObject=rig.gameObject;origin.RequestedTrackingOriginMode=XROrigin.TrackingOriginMode.Floor;
 planes=rig.GetComponent<ARPlaneManager>()??rig.gameObject.AddComponent<ARPlaneManager>();raycasts=rig.GetComponent<ARRaycastManager>()??rig.gameObject.AddComponent<ARRaycastManager>();planes.enabled=true;raycasts.enabled=true;
 if(surfaces==null)surfaces=gameObject.AddComponent<SurfaceInk>();surfaces.Setup(origin,planes);
 Notice("Surfaces on: point at a wall, desk or object and hold the trigger/pinch to draw on it. Needs Quest Space Setup; moving objects are NOT tracked.");}
 void Bind(){if(session==board.Session)return;if(remote!=null)remote.LiveMessage-=Message;if(encoder!=null)encoder.StopCapture();session=board.Session;remote=session as ServerSession;if(remote!=null)remote.LiveMessage+=Message;lastRevision=-1;remotePreviews.Clear();CancelDrafts();}
 void Update(){if(board==null)return;Bind();if(session==null)return;
 if(PointerInput.XRActive&&!xrStarted){xrStarted=true;board.rig.SetMixedReality(true);board.view.transform.localScale=Vector3.one*.52f;board.view.transform.localPosition=new Vector3(-.95f,1.35f,.1f);EnableHud();StartCoroutine(EnableSurfaces());}
 var floor=GameObject.Find("Floor");if(floor&&floor.TryGetComponent<Renderer>(out var floorRenderer))floorRenderer.enabled=!board.rig.MixedReality;if(floor&&floor.TryGetComponent<Collider>(out var floorCollider))floorCollider.enabled=!board.rig.MixedReality;
 if(remote!=null){if(lastConnected&&!remote.SocketConnected){encoder.StopCapture();Notice("Connection lost. Camera stopped; press Camera ON after reconnect.");}lastConnected=remote.SocketConnected;}
 if(!session.State.collaborativeWriting){CancelDrafts();remotePreviews.Clear();}
 if(lastRevision!=session.State.revision){lastRevision=session.State.revision;committed.Rebuild(session.State.spatialStrokes);}
 for(int i=0;i<2;i++){bool available=HandBrushInput.Read(i,board.rig.transform,gates[i],out var hand);tracked[i]=available;bool held=false;Ray aim=default;Vector3 world=default;
 // Air ink comes from the index fingertip (hands) or the front tip of the controller, smoothed.
 bool isHand=false;float now=Time.realtimeSinceStartup;
 // Air ink comes from the index fingertip (lightly smoothed; hand tracking is noisy) or the raw controller tip (no lag).
 if(available){isHand=true;held=hand.pinching;aim=hand.aim;world=filters[i].Filter(hand.tip,now);}else if(board.input!=null){var p=board.input.Pointers.FirstOrDefault(x=>x.id==i+1);if(p.valid){held=p.held;aim=p.ray;world=aim.GetPoint(ControllerTip);tracked[i]=true;}else{drafts[i]=null;filters[i].Reset();}}
 tips[i]=RoomOrigin.InverseTransformPoint(world);
 // "Ink: surfaces" draws ONLY on real surfaces hit by the pointer ray (controller laser or pinch-aim ray) within SurfaceReach.
 // It never falls back to air ink. The pointer shows where ink will land, or the reach limit when nothing is in range.
 bool surfaceMode=AirInk&&SurfaceMode;onSurface[i]=false;Vector3 hitWorld=default;
 if(tracked[i]&&surfaceMode&&surfaces!=null&&!menuBlock[i]&&surfaces.Raycast(aim,SurfaceReach,out hitWorld,out var sn)){surfaceTips[i]=RoomOrigin.InverseTransformPoint(hitWorld);onSurface[i]=true;surfaceNormals[i]=sn;tips[i]=surfaceTips[i];}
 UpdatePointer(i,tracked[i]&&surfaceMode&&!menuBlock[i]&&session.State.collaborativeWriting,aim,onSurface[i],hitWorld,surfaceNormals[i]);
 if(!held)menuBlock[i]=false;else if(Physics.Raycast(aim,out var uiHit,10f)&&uiHit.collider.GetComponentInParent<BoardButton>()!=null)menuBlock[i]=true;
 if(!AirInk||!session.State.collaborativeWriting||menuBlock[i]||!tracked[i]){drafts[i]=null;continue;}
 if(held){if(Eraser){if(drafts[i]==null){var target=session.State.spatialStrokes.LastOrDefault(s=>s.points.Any(p=>Vector3.Distance(p.V,tips[i])<.045f));if(target!=null)session.SpatialAction("spatial.erase",null,target.id);drafts[i]=new SpatialStroke();}}else{if(surfaceMode&&!onSurface[i]){if(drafts[i]!=null&&drafts[i].points.Count>0)Commit(i);else drafts[i]=null;}// off-surface: end the stroke, never bridge through the air
 else{var s=drafts[i];if(s==null)drafts[i]=s=new SpatialStroke{color=board.InkColor,width=StrokeWidth,ownerName=session.Me.name,placement=surfaceMode?"scene-plane":"room"};
 if(surfaceMode&&s.points.Count>0&&Vector3.Distance(s.points.Last().V,tips[i])>SurfaceJumpBreak){Commit(i);drafts[i]=s=new SpatialStroke{color=board.InkColor,width=StrokeWidth,ownerName=session.Me.name,placement="scene-plane"};}
 if(s.points.Count==0||Vector3.Distance(s.points.Last().V,tips[i])>.004f){s.points.Add(new RoomPoint(tips[i]));if(s.points.Count>=512){Commit(i);}}}}}
 else if(drafts[i]!=null){if(!Eraser)Commit(i);else drafts[i]=null;}
 }
 previewMesh.Rebuild(drafts.Where(s=>s!=null&&s.points.Count>0).Concat(remotePreviews.Values));if(cursor)cursor.SetActive(Time.realtimeSinceStartup<cursorUntil);
 inkButton.Label=!AirInk?"Ink: OFF":SurfaceMode?"Ink: surfaces":"Ink: air";eraseButton.SetActive(Eraser);streamButton.Label=Streaming?"STOP CAMERA":"Camera ON";streamButton.SetActive(Streaming);
 var last=session.State.spatialStrokes.LastOrDefault();label.color=Streaming?Color.red:Model.ParseColor(Model.Ink);var labelText=Draw.Wrap((string.IsNullOrEmpty(board.LastNotice)?"":board.LastNotice+"\n")+(Streaming?"● CAMERA LIVE — ":"CAMERA OFF — ")+(session.State.collaborativeWriting?"Spatial writing ON":"Spatial writing OFF for everyone")+"\n"+encoder.Status+(last!=null?" | Last: "+last.ownerName+" ("+last.source+", "+last.placement+")":"")+"\n"+(surfaces!=null?surfaces.Diagnostics():surfaceState)+"\nAim on surface: "+(onSurface[0]||onSurface[1]?"YES":"no")+" | Server: "+(remote!=null?(remote.SocketConnected?"room connected":"connecting…"):"LOCAL, not connected (Camera ON needs the hotspot)"),140,6);if(labelText!=lastLabel){lastLabel=labelText;label.text=labelText;}// TextMesh rebuilds its mesh on every assignment
 }
 void Commit(int index){var s=drafts[index];drafts[index]=null;if(s!=null&&s.points.Count>0){if(s.points.Count==1)s.points.Add(new RoomPoint(s.points[0].V+Vector3.up*.001f));session.SpatialAction("spatial.add",s);}}
 void CancelDrafts(){drafts[0]=drafts[1]=null;}
 void Message(Dict msg){if(!msg.TryGetValue("type",out var type))return;switch(type as string){case "streamStarted":encoder.Epoch=msg["epoch"] as string;cameraSource.Open();Notice("Camera starting. Everyone in this room can watch when frames arrive.");break;case "streamStop":encoder.StopCapture();remotePreviews.Clear();break;case "streamStatus":if(msg.TryGetValue("live",out var live)&&live is bool b&&!b)encoder.StopCapture();break;case "reproject":Reproject(JsonUtility.FromJson<ReprojectionRequest>(Json.Serialize(msg,false)));break;case "remoteCancel":if(msg.TryGetValue("requestId",out var id))remotePreviews.Remove(id.ToString());break;}}
 void Reproject(ReprojectionRequest r){if(remote==null||!session.State.collaborativeWriting||(r.source=="ai"&&!session.State.aiEnabled))return;try{var s=new SpatialStroke{color=r.color,width=r.width,frameRef=r.frame.seq,ownerId=r.ownerId,ownerName=r.ownerName,source=r.source,placement="scene-plane"};string anchor=null;foreach(var uv in r.points){var roomRay=LiveMath.Ray(r.frame,uv);var worldRay=new Ray(RoomOrigin.TransformPoint(roomRay.origin),RoomOrigin.TransformDirection(roomRay.direction));Vector3 worldPoint;if(raycasts!=null&&raycasts.enabled&&raycasts.Raycast(worldRay,hits,TrackableType.PlaneWithinPolygon)&&hits.Count>0){worldPoint=hits[0].pose.position;anchor=hits[0].trackableId.ToString();}else{worldPoint=worldRay.GetPoint(1.5f);s.placement="fixed-distance";}s.points.Add(new RoomPoint(RoomOrigin.InverseTransformPoint(worldPoint)));}s.anchorId=s.placement=="scene-plane"?anchor:null;LiveMath.Validate(s);
 var result=new Dict{{"type","reprojectResult"},{"requestId",r.requestId},{"revision",r.revision},{"phase",r.phase},{"points",s.points.Select(p=>(object)new Dict{{"x",p.x},{"y",p.y},{"z",p.z}}).ToList()},{"placement",s.placement}};if(s.anchorId!=null)result["anchorId"]=s.anchorId;remote.LiveSend(result);if(r.phase=="preview")remotePreviews[r.requestId]=s;else remotePreviews.Remove(r.requestId);
 if(cursor==null){cursor=GameObject.CreatePrimitive(PrimitiveType.Sphere);cursor.name="Remote helper cursor";Destroy(cursor.GetComponent<Collider>());cursor.transform.localScale=Vector3.one*.025f;cursor.GetComponent<Renderer>().material=new Material(Shader.Find("Unlit/Color"));}cursor.GetComponent<Renderer>().material.color=Model.ParseColor(s.color);cursor.transform.position=RoomOrigin.TransformPoint(s.points.Last().V);cursorUntil=Time.realtimeSinceStartup+1;
 if(r.phase=="commit")Notice(s.placement=="scene-plane"?"Helper mark projected onto a scene plane. Camera calibration: "+r.frame.calibration:"Approximate 1.5 m fallback — NOT anchored to a detected physical surface.");
 }catch(Exception e){remote.LiveSend(new Dict{{"type","reprojectResult"},{"requestId",r.requestId},{"revision",r.revision},{"error",e.Message}});}}
 void Overlay(CameraFrame f){foreach(var s in session.State.spatialStrokes.TakeLast(18).Concat(drafts.Where(d=>d!=null&&d.points.Count>0))){FrameOverlay current=null;int step=Mathf.Max(1,s.points.Count/32);for(int i=0;i<s.points.Count;i+=step){if(LiveMath.Project(f,s.points[i].V,out var uv)){if(current==null){if(f.overlays.Count>=100)break;current=new FrameOverlay{id=s.id+":"+i,ownerName=s.ownerName,source=s.source,color=s.color};f.overlays.Add(current);}current.points.Add(uv);}else current=null;}}for(int i=0;i<2;i++)if(tracked[i]&&LiveMath.Project(f,tips[i],out var uv))f.hands.Add(uv);}
 void OnApplicationPause(bool paused){if(paused&&encoder!=null&&!cameraSource.PermissionPending)StopCamera();}
 void OnDestroy(){if(remote!=null)remote.LiveMessage-=Message;if(encoder!=null)encoder.StopCapture();if(RoomOrigin)Destroy(RoomOrigin.gameObject);if(cursor)Destroy(cursor);for(int i=0;i<2;i++){if(pointerLines[i])Destroy(pointerLines[i].gameObject);if(pointerRings[i])Destroy(pointerRings[i]);if(pointerLimits[i])Destroy(pointerLimits[i]);}}
}
}
