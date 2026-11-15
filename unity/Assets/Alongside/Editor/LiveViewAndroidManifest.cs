#if UNITY_ANDROID
using System.IO;
using System.Xml.Linq;
using UnityEditor.Android;
namespace Alongside.EditorTools {
// Modify the generated manifest instead of replacing Unity's activity/application declarations.
public sealed class LiveViewAndroidManifest:IPostGenerateGradleAndroidProject {
 public int callbackOrder=>20;
 public void OnPostGenerateGradleAndroidProject(string path){var file=Path.Combine(path,"src","main","AndroidManifest.xml");var doc=XDocument.Load(file);XNamespace android="http://schemas.android.com/apk/res/android";var root=doc.Root;foreach(var permission in new[]{"android.permission.INTERNET","android.permission.CAMERA","horizonos.permission.HEADSET_CAMERA","com.oculus.permission.USE_SCENE","com.oculus.permission.HAND_TRACKING"}){bool exists=false;foreach(var p in root.Elements("uses-permission"))if((string)p.Attribute(android+"name")==permission)exists=true;if(!exists)root.Add(new XElement("uses-permission",new XAttribute(android+"name",permission)));}doc.Save(file);}
}
}
#endif
