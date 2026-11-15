using System;
using System.Linq;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Threading.Tasks;
using UnityEngine;
using Dict=System.Collections.Generic.Dictionary<string,object>;
namespace Alongside {
public partial class LocalSession {
 public void SpatialAction(string type,SpatialStroke stroke=null,string id=null){try{if(!State.collaborativeWriting)throw new Exception("Spatial writing is OFF for everyone.");if(type=="spatial.add"){LiveMath.Validate(stroke);if(State.spatialStrokes.Count>=500||State.spatialStrokes.Sum(x=>x.points.Count)+stroke.points.Count>20000)throw new Exception("Spatial board full");var s=JsonUtility.FromJson<SpatialStroke>(JsonUtility.ToJson(stroke));s.id=Model.NewId();s.ownerId=Me.id;s.ownerName=Me.name;s.source="human";s.at=Model.Now();State.spatialStrokes.Add(s);}else if(type=="spatial.clearMine")State.spatialStrokes.RemoveAll(x=>x.ownerId==Me.id);else{var s=type=="spatial.undo"?State.spatialStrokes.LastOrDefault(x=>x.ownerId==Me.id):State.spatialStrokes.Find(x=>x.id==id);if(s!=null){if(s.ownerId!=Me.id&&!Me.IsHost)throw new Exception("Author/host only");State.spatialStrokes.Remove(s);}}Changed_();}catch(Exception e){Error?.Invoke(e.Message);}}
}
public partial class ServerSession {
 public event Action<Dict> LiveMessage;
 public bool SocketConnected=>connected;
 public void LiveSend(Dict message)=>Send(message);
 public void SpatialAction(string type,SpatialStroke stroke=null,string id=null){if(!State.collaborativeWriting){Fail("Spatial writing is OFF for everyone.");return;}var a=new Dict{{"type",type}};if(stroke!=null){try{LiveMath.Validate(stroke);}catch(Exception e){Fail(e.Message);return;}a["stroke"]=stroke.Wire();}if(id!=null)a["id"]=id;Post(a);}
 // No unbounded queue of frames: drop if an earlier send currently owns the socket.
 public async Task<bool> SendCameraFrame(byte[] packet){var socket=ws;if(!connected||socket==null||!await sendLock.WaitAsync(0))return false;try{if(socket.State!=WebSocketState.Open)return false;await socket.SendAsync(new ArraySegment<byte>(packet),WebSocketMessageType.Binary,true,cts.Token);return true;}catch{return false;}finally{sendLock.Release();}}
 public void AskLiveFrame(string question,Action<string> done){runner.StartCoroutine(Http("POST",Room("/liveview/ask"),new Dict{{"prompt",question},{"consent",true}},d=>{var obj=d as Dict;done?.Invoke(obj!=null&&obj.TryGetValue("text",out var t)?t.ToString():"Request complete");},done));}
}
}
