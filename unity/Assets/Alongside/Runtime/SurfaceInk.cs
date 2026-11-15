using Unity.XR.CoreUtils;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
namespace Alongside {
// Lets ink land on real objects: the Quest scene mesh, scene planes (walls, desks, floor)
// and furniture bounding boxes become invisible colliders on the Ignore Raycast layer,
// so board/UI raycasts (default mask) never hit them, and Raycast() below only hits them.
// Needs Space Setup on the headset and the USE_SCENE permission. Moving objects are not tracked.
public class SurfaceInk : MonoBehaviour {
 public const int Layer = 2; // "Ignore Raycast"
 public const float MaxDistance = 6f, Lift = .004f;
 public bool Ready { get; private set; }
 public string Status { get; private set; } = "Surfaces off";
 Transform templates; GameObject reticle; ARMeshManager meshes; ARPlaneManager planes; ARBoundingBoxManager boxes;

 public void Setup(XROrigin origin, ARPlaneManager planeManager) {
  if (Ready) return;
  templates = new GameObject("Surface templates").transform; templates.gameObject.SetActive(false); templates.SetParent(transform, false);
  // Planes: the visualizer fills the MeshCollider; no renderer, so they stay invisible over passthrough.
  var plane = Template("Surface plane"); plane.AddComponent<ARPlane>(); plane.AddComponent<MeshFilter>(); plane.AddComponent<MeshCollider>(); plane.AddComponent<ARPlaneMeshVisualizer>();
  planes = planeManager; planes.enabled = false; planes.planePrefab = plane; planes.enabled = true;
  // Room mesh: covers chairs, monitors, anything Space Setup scanned. Must live on a child of the XR Origin.
  try {
   var meshGo = Template("Surface mesh"); var filter = meshGo.AddComponent<MeshFilter>(); meshGo.AddComponent<MeshCollider>();
   var holder = new GameObject("Room mesh"); holder.transform.SetParent(origin.transform, false);
   holder.SetActive(false); meshes = holder.AddComponent<ARMeshManager>(); meshes.meshPrefab = filter; meshes.density = 1f; holder.SetActive(true);
  } catch (System.Exception e) { Debug.LogWarning("[SurfaceInk] room mesh unavailable: " + e.Message); }
  // Furniture boxes (tables, couches, screens) as box colliders.
  try {
   var box = Template("Surface box"); box.AddComponent<ARBoundingBox>(); box.AddComponent<BoxCollider>(); box.AddComponent<BoxColliderSync>();
   boxes = origin.GetComponent<ARBoundingBoxManager>() ?? origin.gameObject.AddComponent<ARBoundingBoxManager>(); boxes.enabled = false; boxes.boundingBoxPrefab = box; boxes.enabled = true;
  } catch (System.Exception e) { Debug.LogWarning("[SurfaceInk] bounding boxes unavailable: " + e.Message); }
  reticle = GameObject.CreatePrimitive(PrimitiveType.Cylinder); reticle.name = "Surface reticle"; Destroy(reticle.GetComponent<Collider>());
  reticle.transform.localScale = new Vector3(.018f, .0008f, .018f);
  var mat = new Material(Shader.Find("Sprites/Default")) { color = new Color(.85f, .42f, .27f, .9f) }; reticle.GetComponent<Renderer>().sharedMaterial = mat; reticle.SetActive(false);
  Ready = true; Status = "Surfaces on: point at a wall, desk or object to draw on it";
 }

 GameObject Template(string name) { var go = new GameObject(name); go.layer = Layer; go.transform.SetParent(templates, false); return go; }

 // Hit a real surface along the ray. Point is lifted slightly off the surface so ink doesn't z-fight.
 public bool Raycast(Ray ray, out Vector3 point, out Vector3 normal) {
  point = default; normal = Vector3.up;
  if (!Ready || !Physics.Raycast(ray, out var hit, MaxDistance, 1 << Layer, QueryTriggerInteraction.Ignore)) return false;
  // The board and its buttons (default layers) win if they're in front of the real surface.
  if (Physics.Raycast(ray, out var ui, hit.distance, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore)) return false;
  normal = Vector3.Dot(hit.normal, ray.direction) > 0 ? -hit.normal : hit.normal; point = hit.point + normal * Lift; return true;
 }

 public void ShowReticle(bool show, Vector3 point = default, Vector3 normal = default) {
  if (reticle == null) return; reticle.SetActive(show); if (!show) return;
  reticle.transform.SetPositionAndRotation(point, Quaternion.FromToRotation(Vector3.up, normal));
 }

 public int Count => (planes ? planes.trackables.count : 0) + (meshes && meshes.meshes != null ? meshes.meshes.Count : 0) + (boxes ? boxes.trackables.count : 0);
 void OnDestroy() { if (reticle) Destroy(reticle); }
}

// Keeps a BoxCollider matching its ARBoundingBox (pose = box centre).
public class BoxColliderSync : MonoBehaviour {
 ARBoundingBox box; BoxCollider col;
 void Awake() { box = GetComponent<ARBoundingBox>(); col = GetComponent<BoxCollider>(); }
 void Update() { if (box && col) { col.center = Vector3.zero; col.size = box.size; } }
}
}
