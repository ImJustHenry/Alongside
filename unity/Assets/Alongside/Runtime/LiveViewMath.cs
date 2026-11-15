using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Dict=System.Collections.Generic.Dictionary<string,object>;
namespace Alongside {
[Serializable] public struct RoomPoint { public float x,y,z; public RoomPoint(Vector3 v){x=v.x;y=v.y;z=v.z;} public Vector3 V=>new Vector3(x,y,z); }
[Serializable] public struct FramePoint { public float u,v;public FramePoint(float x,float y){u=x;v=y;} }
[Serializable] public class SpatialStroke {
 public string id,ownerId,ownerName,source="human",color="#da6b45",anchorId,placement="room";public float width=.006f;public long at;public int frameRef=-1;public List<RoomPoint> points=new List<RoomPoint>();
 public Dict Wire(){var d=new Dict{{"color",color},{"width",width},{"placement",placement},{"points",points.Select(p=>(object)new Dict{{"x",p.x},{"y",p.y},{"z",p.z}}).ToList()}};if(frameRef>=0)d["frameRef"]=frameRef;if(!string.IsNullOrEmpty(anchorId))d["anchorId"]=anchorId;return d;}
}
[Serializable] public class FrameIntrinsics {public float fx,fy,cx,cy;}
[Serializable] public class FramePose {public float[] p=new float[3],q=new float[]{0,0,0,1};public Vector3 Position=>new Vector3(p[0],p[1],p[2]);public Quaternion Rotation=>new Quaternion(q[0],q[1],q[2],q[3]);}
[Serializable] public class FrameOverlay {public string id,ownerName,source,color;public List<FramePoint> points=new List<FramePoint>();}
[Serializable] public class CameraFrame {
 public string type="frame",epoch,source="quest-webcam",calibration="estimated";public int seq,w,h;public double ts;
 public FrameIntrinsics intrinsics=new FrameIntrinsics();public FramePose pose=new FramePose();public List<FrameOverlay> overlays=new List<FrameOverlay>();public List<FramePoint> hands=new List<FramePoint>();
}
[Serializable] public class ReprojectionRequest {public string type,requestId,phase,ownerId,ownerName,source,color;public int revision;public float width;public CameraFrame frame;public List<FramePoint> points;}
public static class LiveMath {
 // Room and camera conventions: Unity axes x-right/y-up/z-forward; JPEG u/v are top-left normalized.
 public static Ray Ray(CameraFrame f,FramePoint p){var i=f.intrinsics;var d=new Vector3((p.u*f.w-i.cx)/i.fx,(i.cy-p.v*f.h)/i.fy,1).normalized;return new Ray(f.pose.Position,f.pose.Rotation*d);}
 public static bool Project(CameraFrame f,Vector3 roomPoint,out FramePoint uv){var p=Quaternion.Inverse(f.pose.Rotation)*(roomPoint-f.pose.Position);uv=default;if(p.z<=.03f)return false;uv=new FramePoint((f.intrinsics.fx*p.x/p.z+f.intrinsics.cx)/f.w,(f.intrinsics.cy-f.intrinsics.fy*p.y/p.z)/f.h);return uv.u>=0&&uv.u<=1&&uv.v>=0&&uv.v<=1;}
 public static void Validate(SpatialStroke s){if(s.points==null||s.points.Count<1||s.points.Count>512)throw new FormatException("Spatial stroke needs 1-512 points");if(s.width<.001f||s.width>.03f||float.IsNaN(s.width))throw new FormatException("Invalid stroke width");if(!System.Text.RegularExpressions.Regex.IsMatch(s.color??"","^#[0-9a-fA-F]{6}$"))throw new FormatException("Invalid stroke color");foreach(var p in s.points)if(float.IsNaN(p.x)||float.IsNaN(p.y)||float.IsNaN(p.z)||Mathf.Abs(p.x)>20||Mathf.Abs(p.y)>20||Mathf.Abs(p.z)>20)throw new FormatException("Spatial point outside room bounds");}
 public static double Now()=>DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
public sealed class PinchGate {
 public bool Held{get;private set;}
 public bool UpdateDistance(float metres){Held=Held?metres<.03f:metres<.02f;return Held;}
 public bool UpdateStrength(float strength){Held=Held?strength>.65f:strength>.8f;return Held;}
 public void Reset(){Held=false;}
}
public sealed class OneEuroVector {
 bool initialized;Vector3 lastRaw,last,derivative;float lastTime;public float MinCutoff=1.5f,Beta=.08f;
 static float Alpha(float cutoff,float dt)=>1f/(1f+1f/(2f*Mathf.PI*cutoff*dt));
 public Vector3 Filter(Vector3 v,float time){if(!initialized){initialized=true;lastTime=time;lastRaw=last=v;return v;}float dt=Mathf.Clamp(time-lastTime,.001f,.1f);lastTime=time;var d=(v-lastRaw)/dt;lastRaw=v;derivative=Vector3.Lerp(derivative,d,Alpha(1f,dt));last=Vector3.Lerp(last,v,Alpha(MinCutoff+Beta*derivative.magnitude,dt));return last;}
 public void Reset(){initialized=false;}
}
}
