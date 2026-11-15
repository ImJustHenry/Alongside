#if UNITY_ANDROID
using System.IO;
using System.Linq;
using System.Xml.Linq;
using UnityEditor.Android;

namespace Alongside.EditorTools
{
    /// Meta Horizon Store / release-channel packaging rules (VRC.Quest.Packaging):
    /// launch activity excludeFromRecents=true and installLocation=auto.
    public sealed class StoreManifestFix : IPostGenerateGradleAndroidProject
    {
        public int callbackOrder => 30;

        public void OnPostGenerateGradleAndroidProject(string path)
        {
            XNamespace android = "http://schemas.android.com/apk/res/android";
            foreach (var file in new[] { Path.Combine(path, "src", "main", "AndroidManifest.xml"), Path.Combine(path, "..", "launcher", "src", "main", "AndroidManifest.xml") })
            {
                if (!File.Exists(file)) continue;
                var doc = XDocument.Load(file);
                var root = doc.Root;
                if (root == null) continue;
                if (root.Attribute(android + "installLocation") != null) root.SetAttributeValue(android + "installLocation", "auto");
                foreach (var activity in root.Descendants("activity"))
                {
                    bool launcher = activity.Descendants("action").Any(a => (string)a.Attribute(android + "name") == "android.intent.action.MAIN");
                    if (launcher) activity.SetAttributeValue(android + "excludeFromRecents", "true");
                }
                doc.Save(file);
            }
        }
    }
}
#endif
