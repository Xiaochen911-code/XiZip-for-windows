using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json.Serialization;

namespace XiZip.Services;

public sealed class ArchiveEntry
{
    [JsonPropertyName("path")] public string Path { get; init; } = "";
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("is_dir")] public bool IsDir { get; init; }
    [JsonPropertyName("size")] public long Size { get; set; }
    [JsonPropertyName("packed")] public long Packed { get; init; }
    [JsonPropertyName("mtime")] public string Mtime { get; init; } = "";
    [JsonPropertyName("crc")] public string Crc { get; init; } = "";
    [JsonPropertyName("ext")] public string Ext { get; init; } = "";
}

public sealed record SevenZipResult(int ExitCode, string StdOut, string StdErr);

/// <summary>7-Zip 内核封装：调用、列表解析、预览读取。</summary>
public static class SevenZip
{
    public static string ExePath => System.IO.Path.Combine(AppContext.BaseDirectory, "7z", "7z.exe");

    public static ProcessStartInfo StartInfo(IEnumerable<string> args, string? cwd = null)
    {
        if (!File.Exists(ExePath))
        {
            throw new FileNotFoundException($"未找到 7-Zip 内核：{ExePath}");
        }

        var info = new ProcessStartInfo(ExePath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        if (!string.IsNullOrEmpty(cwd))
        {
            info.WorkingDirectory = cwd;
        }
        foreach (var arg in args)
        {
            info.ArgumentList.Add(arg);
        }
        return info;
    }

    public static SevenZipResult Run(IEnumerable<string> args, string? cwd = null, int timeoutMs = 180_000)
    {
        using var process = Process.Start(StartInfo(args, cwd))
            ?? throw new InvalidOperationException("无法启动 7-Zip");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(timeoutMs))
        {
            try { process.Kill(true); } catch { /* ignore */ }
            throw new TimeoutException("7-Zip 执行超时");
        }
        return new SevenZipResult(process.ExitCode, stdout.GetAwaiter().GetResult(), stderr.GetAwaiter().GetResult());
    }

    public static string KernelVersion()
    {
        try
        {
            var result = Run(Array.Empty<string>(), timeoutMs: 30_000);
            var text = result.StdOut + result.StdErr;
            var match = System.Text.RegularExpressions.Regex.Match(text, @"7-Zip\s+(\d+\.\d+)");
            return match.Success ? match.Groups[1].Value : "未知";
        }
        catch
        {
            return "未知";
        }
    }

    public static List<ArchiveEntry> List(string archive)
    {
        var result = Run(new[] { "l", "-slt", "-ba", "-sccUTF-8", archive });
        if (result.ExitCode is not (0 or 1))
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StdErr) ? result.StdOut : result.StdErr);
        }

        var rows = new List<ArchiveEntry>();
        var text = result.StdOut.Replace("\r\n", "\n").Replace('\r', '\n');
        foreach (var block in text.Split("\n\n", StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in block.Split('\n'))
            {
                var index = line.IndexOf(" = ", StringComparison.Ordinal);
                if (index <= 0)
                {
                    continue;
                }
                kv[line[..index].Trim()] = line[(index + 3)..].Trim();
            }

            if (!kv.TryGetValue("Path", out var rawPath) || string.IsNullOrWhiteSpace(rawPath))
            {
                continue;
            }
            if (kv.TryGetValue("Type", out var type) && !string.IsNullOrWhiteSpace(type))
            {
                continue; // 归档文件自身的元数据块
            }

            var path = rawPath.Replace('\\', '/').Trim('/');
            if (string.IsNullOrEmpty(path) || path is "." or "/")
            {
                continue;
            }

            var isDir = kv.TryGetValue("Folder", out var folder) && folder == "+"
                || rawPath.EndsWith('/') || rawPath.EndsWith('\\')
                || (kv.TryGetValue("Attributes", out var attr) && attr.StartsWith('D'));
            var name = path.Contains('/') ? path[(path.LastIndexOf('/') + 1)..] : path;
            var ext = !isDir && name.Contains('.') ? name[(name.LastIndexOf('.') + 1)..].ToLowerInvariant() : "";

            rows.Add(new ArchiveEntry
            {
                Path = path,
                Name = name,
                IsDir = isDir,
                Size = isDir ? 0 : ToLong(kv.GetValueOrDefault("Size")),
                Packed = isDir ? 0 : ToLong(kv.GetValueOrDefault("Packed Size")),
                Mtime = kv.GetValueOrDefault("Modified", ""),
                Crc = kv.GetValueOrDefault("CRC", ""),
                Ext = ext,
            });
        }

        // 补齐父级目录
        var known = rows.Where(row => row.IsDir).Select(row => row.Path).ToHashSet(StringComparer.Ordinal);
        foreach (var row in rows.ToList())
        {
            if (row.IsDir)
            {
                continue;
            }
            var parts = row.Path.Split('/');
            var acc = "";
            for (var i = 0; i < parts.Length - 1; i++)
            {
                acc = acc.Length == 0 ? parts[i] : $"{acc}/{parts[i]}";
                if (known.Add(acc))
                {
                    rows.Add(new ArchiveEntry
                    {
                        Path = acc,
                        Name = parts[i],
                        IsDir = true,
                        Size = 0,
                        Packed = 0,
                        Mtime = "",
                        Crc = "",
                        Ext = "",
                    });
                }
            }
        }

        // 目录大小 = 内部文件之和
        var dirSizes = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            if (row.IsDir)
            {
                continue;
            }
            var parts = row.Path.Split('/');
            var acc = "";
            for (var i = 0; i < parts.Length - 1; i++)
            {
                acc = acc.Length == 0 ? parts[i] : $"{acc}/{parts[i]}";
                dirSizes[acc] = dirSizes.GetValueOrDefault(acc) + row.Size;
            }
        }
        foreach (var row in rows)
        {
            if (row.IsDir)
            {
                row.Size = dirSizes.GetValueOrDefault(row.Path);
            }
        }

        return rows
            .OrderBy(row => row.IsDir ? 0 : 1)
            .ThenBy(row => row.Path, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static (int Code, byte[] Data) ExtractToMemory(string archive, string entryPath)
    {
        using var process = Process.Start(StartInfo(new[] { "e", "-so", "-bd", "-y", archive, entryPath }))
            ?? throw new InvalidOperationException("无法启动 7-Zip");
        var stderr = process.StandardError.ReadToEndAsync();
        using var buffer = new MemoryStream();
        process.StandardOutput.BaseStream.CopyTo(buffer);
        process.WaitForExit();
        _ = stderr.GetAwaiter().GetResult();
        return (process.ExitCode, buffer.ToArray());
    }

    public static long ToLong(string? value)
    {
        return long.TryParse((value ?? "0").Trim(), out var number) ? number : 0;
    }
}
