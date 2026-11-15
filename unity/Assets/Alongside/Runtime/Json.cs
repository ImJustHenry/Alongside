// Alongside - minimal JSON parser/serializer (no external deps)
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Alongside
{
    public static class Json
    {
        public static object Parse(string s)
        {
            int i = 0;
            var v = ParseValue(s, ref i);
            SkipWs(s, ref i);
            if (i != s.Length) throw new FormatException("Trailing characters at " + i);
            return v;
        }

        static void SkipWs(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }

        static char Peek(string s, int i)
        {
            if (i >= s.Length) throw new FormatException("Unexpected end of JSON");
            return s[i];
        }

        static object ParseValue(string s, ref int i)
        {
            SkipWs(s, ref i);
            char c = Peek(s, i);
            if (c == '{')
            {
                i++;
                var d = new Dictionary<string, object>();
                SkipWs(s, ref i);
                if (Peek(s, i) == '}') { i++; return d; }
                while (true)
                {
                    SkipWs(s, ref i);
                    string k = ParseString(s, ref i);
                    SkipWs(s, ref i);
                    if (Peek(s, i) != ':') throw new FormatException("Expected ':' at " + i);
                    i++;
                    d[k] = ParseValue(s, ref i);
                    SkipWs(s, ref i);
                    char n = Peek(s, i);
                    if (n == ',') { i++; continue; }
                    if (n == '}') { i++; return d; }
                    throw new FormatException("Expected ',' or '}' at " + i);
                }
            }
            if (c == '[')
            {
                i++;
                var l = new List<object>();
                SkipWs(s, ref i);
                if (Peek(s, i) == ']') { i++; return l; }
                while (true)
                {
                    l.Add(ParseValue(s, ref i));
                    SkipWs(s, ref i);
                    char n = Peek(s, i);
                    if (n == ',') { i++; continue; }
                    if (n == ']') { i++; return l; }
                    throw new FormatException("Expected ',' or ']' at " + i);
                }
            }
            if (c == '"') return ParseString(s, ref i);
            if (Match(s, i, "true")) { i += 4; return true; }
            if (Match(s, i, "false")) { i += 5; return false; }
            if (Match(s, i, "null")) { i += 4; return null; }
            int start = i;
            bool isFloat = false;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0)
            {
                if (s[i] == '.' || s[i] == 'e' || s[i] == 'E') isFloat = true;
                i++;
            }
            if (i == start) throw new FormatException("Unexpected character '" + c + "' at " + i);
            string num = s.Substring(start, i - start);
            if (!isFloat && long.TryParse(num, NumberStyles.Integer, CultureInfo.InvariantCulture, out long lv)) return lv;
            return double.Parse(num, NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        static bool Match(string s, int i, string word)
        {
            return i + word.Length <= s.Length && string.CompareOrdinal(s, i, word, 0, word.Length) == 0;
        }

        static string ParseString(string s, ref int i)
        {
            if (Peek(s, i) != '"') throw new FormatException("Expected string at " + i);
            i++;
            var sb = new StringBuilder();
            while (true)
            {
                char c = Peek(s, i++);
                if (c == '"') break;
                if (c == '\\')
                {
                    char e = Peek(s, i++);
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 > s.Length) throw new FormatException("Bad \\u escape");
                            sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16));
                            i += 4;
                            break;
                        default: throw new FormatException("Bad escape \\" + e);
                    }
                }
                else sb.Append(c);
            }
            return sb.ToString();
        }

        public static string Serialize(object o, bool pretty = true)
        {
            var sb = new StringBuilder();
            Write(sb, o, pretty, 0);
            return sb.ToString();
        }

        static void Indent(StringBuilder sb, bool pretty, int depth)
        {
            if (!pretty) return;
            sb.Append('\n');
            sb.Append(' ', depth * 2);
        }

        static void Write(StringBuilder sb, object o, bool pretty, int depth)
        {
            switch (o)
            {
                case null: sb.Append("null"); return;
                case string str: WriteString(sb, str); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case float f: WriteDouble(sb, f); return;
                case double d: WriteDouble(sb, d); return;
                case decimal m: sb.Append(m.ToString(CultureInfo.InvariantCulture)); return;
                case int _: case long _: case short _: case byte _: case uint _: case ulong _: case ushort _: case sbyte _:
                    sb.Append(Convert.ToString(o, CultureInfo.InvariantCulture)); return;
                case IDictionary dict:
                {
                    sb.Append('{');
                    bool first = true;
                    foreach (DictionaryEntry kv in dict)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        Indent(sb, pretty, depth + 1);
                        WriteString(sb, kv.Key.ToString());
                        sb.Append(pretty ? ": " : ":");
                        Write(sb, kv.Value, pretty, depth + 1);
                    }
                    if (!first) Indent(sb, pretty, depth);
                    sb.Append('}');
                    return;
                }
                case IEnumerable list:
                {
                    sb.Append('[');
                    bool first = true;
                    foreach (var item in list)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        Indent(sb, pretty, depth + 1);
                        Write(sb, item, pretty, depth + 1);
                    }
                    if (!first) Indent(sb, pretty, depth);
                    sb.Append(']');
                    return;
                }
                default: WriteString(sb, o.ToString()); return;
            }
        }

        static void WriteDouble(StringBuilder sb, double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
            sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
