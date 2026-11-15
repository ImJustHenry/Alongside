using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
namespace Alongside {
// One combined tube mesh, not a GameObject per stroke or point.
public class SpatialStrokeMesh:MonoBehaviour {
 Mesh mesh;MeshRenderer renderer_;readonly List<Vector3> v=new List<Vector3>();readonly List<Color32> c=new List<Color32>();readonly List<int> t=new List<int>();
 public void Initialize(Material material){mesh=new Mesh{name="Alongside room strokes",indexFormat=IndexFormat.UInt32};mesh.MarkDynamic();gameObject.AddComponent<MeshFilter>().sharedMesh=mesh;renderer_=gameObject.AddComponent<MeshRenderer>();renderer_.sharedMaterial=material;renderer_.shadowCastingMode=ShadowCastingMode.Off;}
 public void Rebuild(IEnumerable<SpatialStroke> strokes){v.Clear();c.Clear();t.Clear();foreach(var stroke in strokes){if(stroke.points==null||stroke.points.Count==0)continue;var color=(Color32)Model.ParseColor(stroke.color);var points=stroke.points.Count==1?new List<RoomPoint>{stroke.points[0],new RoomPoint(stroke.points[0].V+Vector3.up*.001f)}:stroke.points;int sides=6,offset=v.Count;for(int i=0;i<points.Count;i++){Vector3 tangent=points.Count==1?Vector3.forward:points[Mathf.Min(i+1,points.Count-1)].V-points[Mathf.Max(0,i-1)].V;if(tangent.sqrMagnitude<.000001f)tangent=Vector3.forward;tangent.Normalize();var a=Vector3.Cross(tangent,Mathf.Abs(Vector3.Dot(tangent,Vector3.up))>.9f?Vector3.right:Vector3.up).normalized;var b=Vector3.Cross(tangent,a);for(int j=0;j<sides;j++){float theta=j*Mathf.PI*2/sides;v.Add(points[i].V+(a*Mathf.Cos(theta)+b*Mathf.Sin(theta))*stroke.width*.5f);c.Add(color);}if(i>0)for(int j=0;j<sides;j++){int k=offset+i*sides+j,n=offset+i*sides+(j+1)%sides;t.Add(k-sides);t.Add(n-sides);t.Add(k);t.Add(n-sides);t.Add(n);t.Add(k);}}}
 mesh.Clear();mesh.SetVertices(v);mesh.SetColors(c);mesh.SetTriangles(t,0);mesh.RecalculateBounds();}
 void OnDestroy(){if(mesh)Destroy(mesh);}
}
}
