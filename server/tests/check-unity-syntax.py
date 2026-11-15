from pathlib import Path
from tree_sitter import Language,Parser
import tree_sitter_c_sharp
root=Path(__file__).resolve().parents[2]/'StanfordXR/Assets/Alongside'
parser=Parser(Language(tree_sitter_c_sharp.language()))
failed=[]
for p in root.rglob('*.cs'):
 tree=parser.parse(p.read_bytes())
 if tree.root_node.has_error:
  def walk(n):
   if n.type=='ERROR' or n.is_missing:failed.append((str(p.relative_to(root)),n.start_point,n.type))
   for child in n.children:walk(child)
  walk(tree.root_node)
if failed:
 for x in failed:print(x)
 raise SystemExit(1)
print('PASS: C# syntax parsed for',len(list(root.rglob('*.cs'))),'Alongside files. NOT Unity compilation, package resolution, or hardware testing.')
