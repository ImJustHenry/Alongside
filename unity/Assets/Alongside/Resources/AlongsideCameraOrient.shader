Shader "Alongside/CameraOrient" {
 Properties { _MainTex ("Camera",2D)="white" {} _Quarter("Quarter turns",Float)=0 _MirrorY("Mirror Y",Float)=0 }
 SubShader { Cull Off ZWrite Off ZTest Always
  Pass { CGPROGRAM
   #pragma vertex vert_img
   #pragma fragment frag
   #include "UnityCG.cginc"
   sampler2D _MainTex;float _Quarter,_MirrorY;
   fixed4 frag(v2f_img i):SV_Target { float2 uv=i.uv;
    if(_Quarter>2.5)uv=float2(1-uv.y,uv.x);else if(_Quarter>1.5)uv=1-uv;else if(_Quarter>.5)uv=float2(uv.y,1-uv.x);
    if(_MirrorY>.5)uv.y=1-uv.y;return tex2D(_MainTex,uv);
   }
   ENDCG
  }
 }
}
