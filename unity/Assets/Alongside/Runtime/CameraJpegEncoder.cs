using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Experimental.Rendering;
namespace Alongside {
public class CameraJpegEncoder:MonoBehaviour {
 public LiveCameraSource source;public Transform roomOrigin;public int targetWidth=800;[Range(1,15)]public int fps=12;[Range(30,85)]public int quality=65;
 public Action<CameraFrame> AddOverlays;public Action<byte[],CameraFrame> Encoded;
 public string Epoch;public string Status="Encoder idle";public long Dropped;public int Frames;
 float next;bool busy;float busySince;public int Stalls;int generation,sequence;Task<byte[]> encoding;CameraFrame pending;int pendingGeneration;Material orient;
 public void StopCapture(){generation++;Epoch=null;source.Close();Status="Camera stopped";}
 void Update(){
 if(encoding!=null&&encoding.IsCompleted){var task=encoding;encoding=null;busy=false;if(!task.IsFaulted&&pendingGeneration==generation&&!string.IsNullOrEmpty(Epoch)){Frames++;Encoded?.Invoke(task.Result,pending);}else if(task.IsFaulted)Status="JPEG encoding failed";}
 if(string.IsNullOrEmpty(Epoch)||!source.Requested)return;if(Time.realtimeSinceStartup<next)return;if(busy){if(Time.realtimeSinceStartup-busySince>2f){busy=false;generation++;Stalls++;}else{Dropped++;return;}}// a GPU readback that never completes must not block the stream forever
 if(!SystemInfo.supportsAsyncGPUReadback){Status="AsyncGPUReadback unavailable; live encoding disabled rather than blocking XR";return;}
 if(!source.TryFrame(out var tex,out var pose,out var k,out var size,out var calibration,out var rotation,out var mirror,out var ts)){Status="NOT SENDING: "+source.Diagnostics()+" | sent "+Frames+", stalls "+Stalls;return;}next=Time.realtimeSinceStartup+1f/fps;// only pace after a frame was actually taken
 int quarter=(((Mathf.RoundToInt(rotation/90)+source.ExtraQuarter)%4)+4)%4;int sourceW=quarter%2==1?size.y:size.x,sourceH=quarter%2==1?size.x:size.y;float resize=Mathf.Clamp(targetWidth,640,960)/(float)Mathf.Max(sourceW,sourceH);int w=Mathf.RoundToInt(sourceW*resize),h=Mathf.RoundToInt(sourceH*resize);if(quarter%2==1)calibration="estimated";
 var localP=roomOrigin.InverseTransformPoint(pose.position);var localQ=Quaternion.Inverse(roomOrigin.rotation)*pose.rotation;var f=new CameraFrame{epoch=Epoch,seq=sequence++,ts=ts,w=w,h=h,calibration=calibration,source=source.mrukCameraAccess?"quest-pca":Application.isEditor?"simulation":"quest-webcam",pose=new FramePose{p=new[]{localP.x,localP.y,localP.z},q=new[]{localQ.x,localQ.y,localQ.z,localQ.w}},intrinsics=new FrameIntrinsics{fx=k.fx*w/size.x,fy=k.fy*h/size.y,cx=k.cx*w/size.x,cy=k.cy*h/size.y}};
 if(quarter%2==1){float fx=w/(2*Mathf.Tan(source.estimatedHorizontalFov*Mathf.Deg2Rad/2));f.intrinsics=new FrameIntrinsics{fx=fx,fy=fx,cx=w*.5f,cy=h*.5f};}
 AddOverlays?.Invoke(f);if(orient==null){var shader=Resources.Load<Shader>("AlongsideCameraOrient");if(shader==null){Status="CameraOrient shader missing";return;}orient=new Material(shader);}orient.SetFloat("_Quarter",quarter);orient.SetFloat("_MirrorY",mirror?1:0);var rt=RenderTexture.GetTemporary(w,h,0,RenderTextureFormat.ARGB32);Graphics.Blit(tex,rt,orient);busy=true;busySince=Time.realtimeSinceStartup;int g=generation;
 AsyncGPUReadback.Request(rt,0,TextureFormat.RGBA32,request=>{if(request.hasError||g!=generation){RenderTexture.ReleaseTemporary(rt);busy=false;return;}var rgba=request.GetData<byte>().ToArray();RenderTexture.ReleaseTemporary(rt);pending=f;pendingGeneration=g;var header=Encoding.UTF8.GetBytes(JsonUtility.ToJson(f));bool flip=source.FlipReadbackRows;int q=quality;encoding=Task.Run(()=>{if(flip){int stride=w*4;var row=new byte[stride];for(int y=0;y<h/2;y++){int a=y*stride,b=(h-1-y)*stride;Buffer.BlockCopy(rgba,a,row,0,stride);Buffer.BlockCopy(rgba,b,rgba,a,stride);Buffer.BlockCopy(row,0,rgba,b,stride);}}var jpeg=ImageConversion.EncodeArrayToJPG(rgba,GraphicsFormat.R8G8B8A8_UNorm,(uint)w,(uint)h,(uint)(w*4),q);if(header.Length>64000||jpeg.Length>600000)throw new Exception("Frame size limit");var packet=new byte[4+header.Length+jpeg.Length];Buffer.BlockCopy(BitConverter.GetBytes(header.Length),0,packet,0,4);Buffer.BlockCopy(header,0,packet,4,header.Length);Buffer.BlockCopy(jpeg,0,packet,4+header.Length,jpeg.Length);return packet;});});Status="Camera live: sent "+Frames+" ("+fps+" fps target), dropped "+Dropped+", stalls "+Stalls+" | "+source.Diagnostics();
 }
 void OnDisable(){StopCapture();}
 void OnDestroy(){if(orient)Destroy(orient);}
}
}
