using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.Hands;
namespace Alongside {
public struct BrushHand {public bool tracked,pinching;public Vector3 tip;public Ray aim;}
public static class HandBrushInput {
 static readonly List<XRHandSubsystem> systems=new List<XRHandSubsystem>();
 public static bool Read(int index,Transform trackingRoot,PinchGate gate,out BrushHand result){result=default;SubsystemManager.GetSubsystems(systems);XRHandSubsystem system=null;foreach(var s in systems)if(s.running){system=s;break;}if(system==null){gate.Reset();return false;}var hand=index==0?system.leftHand:system.rightHand;if(!hand.isTracked||!hand.GetJoint(XRHandJointID.IndexTip).TryGetPose(out var finger)||!hand.GetJoint(XRHandJointID.ThumbTip).TryGetPose(out var thumb)){gate.Reset();return false;}var tip=trackingRoot.TransformPoint(finger.position);var aim=index==0?MetaAimHand.left:MetaAimHand.right;bool pressed;Ray ray;
 if(aim!=null && (MetaAimFlags)aim.aimFlags.ReadValue()!=MetaAimFlags.None){var flags=(MetaAimFlags)aim.aimFlags.ReadValue();if((flags&MetaAimFlags.SystemGesture)!=0){gate.Reset();pressed=false;}else pressed=gate.UpdateStrength(aim.pinchStrengthIndex.ReadValue());ray=new Ray(trackingRoot.TransformPoint(aim.devicePosition.ReadValue()),trackingRoot.rotation*aim.deviceRotation.ReadValue()*Vector3.forward);}
 else{pressed=gate.UpdateDistance(Vector3.Distance(finger.position,thumb.position));ray=new Ray(tip,trackingRoot.rotation*finger.rotation*Vector3.forward);}
 result=new BrushHand{tracked=true,pinching=pressed,tip=tip,aim=ray};return true;}
}
}
